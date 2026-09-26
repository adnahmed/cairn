// v2 wave 2, stream A — ideas on demand replace scheduled meal plans.
//
// GET /api/fuel/ideas is deterministic: three ideas from the athlete's own staples,
// sized to the rest of today inside the observed intake band, protein first. An idea
// never trades protein away to fit the band, is never logged, and never drafts a plan.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, repo, resetTables, localDaysAgo, seedIntake, seedWeight } from "./_seed.js";
import { fuelEnergyBound, fuelIdeas, sizeFuelIdea, todaySoFar } from "../dist/repo/fuel-ideas.js";
import { nutritionRouter } from "../dist/routes/nutrition.js";
import { registerNutritionTools } from "../dist/surfaces/mcp/nutrition.js";

beforeEach(() => {
  resetTables("food_notes", "bodyweight_log", "garmin_daily_metrics", "profile", "meal_plans");
  repo.setProfile({
    age: 35,
    height_cm: 180,
    weight_lb: 180,
    sex: "male",
    activity_factor: 1.5,
    goal_weight_lb: 170,
    goal_date: null,
  });
});

// Staples: each logged on three different days, with a known estimate.
const STAPLES = {
  "Chicken salad": { kcal: 450, protein_g: 50, carbs_g: 20, fat_g: 18 },
  "Greek yogurt bowl": { kcal: 250, protein_g: 30, carbs_g: 25, fat_g: 4 },
  "Toast with jam": { kcal: 300, protein_g: 6, carbs_g: 55, fat_g: 5 },
};

function seedStaples() {
  for (const [summary, macros] of Object.entries(STAPLES)) {
    for (const daysAgo of [50, 51, 52]) {
      repo.addFoodNote("snack", "", { summary, ...macros }, undefined, { date: localDaysAgo(daysAgo) });
    }
  }
}

// Four weeks ending yesterday at ~1,800 kcal/day with the weight drifting down — a band
// whose ceiling is 1,800 kcal.
function seedBand() {
  let weight = 180;
  for (let daysAgo = 28; daysAgo >= 0; daysAgo--) {
    weight -= 1 / 7;
    seedWeight(localDaysAgo(daysAgo), Math.round(weight * 10) / 10);
    if (daysAgo >= 1 && (daysAgo - 1) % 7 < 5) {
      seedIntake(daysAgo, 700, {}, { eatenAt: "08:00" });
      seedIntake(daysAgo, 1100, {}, { eatenAt: "19:00" });
    }
  }
}

const countRows = (table) => Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n);

test("ideas never trade protein away to fit the band", () => {
  seedStaples();
  seedBand();
  // Today so far: 1,500 kcal and almost no protein — 300 kcal of room, lots of protein owed.
  seedIntake(0, 1500, { protein_g: 10 }, { eatenAt: "12:00" });
  const out = fuelIdeas();
  assert.equal(out.kind, "ideas");
  assert.equal(out.band_status, "ok");
  assert.equal(out.room.energy_kcal, 300);
  assert.ok(out.room.protein_g > 50, "protein is owed");
  assert.equal(out.ideas.length, 3);

  // Protein first: the biggest protein contribution leads even though it does not fit.
  assert.equal(out.ideas[0].title, "Chicken salad");
  assert.equal(out.ideas[0].portion, 1, "a half portion would fit, but it would give protein away");
  assert.equal(out.ideas[0].protein_g, 50);
  assert.equal(out.ideas[0].fits_band, false);
  assert.match(out.ideas[0].why, /protein comes first/);
  assert.equal(out.ideas[1].title, "Greek yogurt bowl");
  assert.equal(out.ideas[1].fits_band, true);

  // The invariant, for every idea: a portion below the usual one only when the usual
  // portion's protein was more than the day still owed.
  for (const idea of out.ideas) {
    if (idea.portion < 1) assert.ok(out.room.protein_g <= idea.protein_g, `${idea.title} shrank protein`);
  }
});

test("sizing: a portion shrinks to fit only when no owed protein is lost", () => {
  const staple = {
    key: "k",
    title: "T",
    kcal: 600,
    protein_g: 40,
    carbs_g: null,
    fat_g: null,
    times_logged: 3,
    last_logged: null,
    usual_now: false,
  };
  assert.equal(sizeFuelIdea(staple, 30, 350).portion, 1, "half would give 20 g of the 30 g owed");
  assert.equal(sizeFuelIdea(staple, 15, 350).portion, 0.5, "half still covers the 15 g owed");
  assert.equal(sizeFuelIdea(staple, 0, 350).portion, 0.5, "protein met: size to the band");
  assert.equal(sizeFuelIdea(staple, 100, 2000).portion, 2, "room and protein owed: more of it");
  assert.equal(sizeFuelIdea(staple, 100, null).portion, 1, "no band: the usual portion, no energy claim");
  assert.equal(sizeFuelIdea(staple, 100, null).fits, null);
});

test("with no band the ideas make no energy claim; they are never logged and never a plan", () => {
  seedStaples();
  const notes = countRows("food_notes");
  const out = fuelIdeas();
  assert.equal(out.band_status, "too_few_days");
  assert.equal(out.room.energy_kcal, null);
  assert.ok(out.ideas.length > 0);
  for (const idea of out.ideas) {
    assert.equal(idea.fits_band, null);
    assert.equal(idea.portion, 1);
    assert.ok(idea.prefill.startsWith(idea.title), "Start from this fills the composer");
  }
  assert.equal(out.today_so_far.state, "nothing logged");
  assert.equal(countRows("food_notes"), notes, "an idea is never logged");
  assert.equal(countRows("meal_plans"), 0, "an idea is never a meal plan");
});

test("today's partial day reads in progress, and a food already eaten today is not re-offered", () => {
  seedStaples();
  repo.addFoodNote("breakfast", "", { summary: "Greek yogurt bowl", ...STAPLES["Greek yogurt bowl"] });
  const out = fuelIdeas();
  assert.equal(out.today_so_far.state, "in progress");
  assert.equal(out.today_so_far.protein_g, 30);
  assert.ok(!out.ideas.some((i) => i.title === "Greek yogurt bowl"));
});

test("a meal still being estimated is not a zero: no protein still to go and no energy room off a partial sum", () => {
  seedStaples();
  seedBand();
  repo.addFoodNote("breakfast", "", { summary: "Greek yogurt bowl", ...STAPLES["Greek yogurt bowl"] });
  const known = fuelIdeas();
  assert.equal(known.room.protein_g, known.protein_anchor.protein_g - 30);
  assert.notEqual(known.room.energy_kcal, null, "the band sizes the room while every meal has numbers");

  repo.addFoodNote("lunch", "", { summary: "Something from the cafe" });
  const out = fuelIdeas();
  assert.equal(out.today_so_far.state, "in progress");
  // The sum is marked for what it is: partial, over the estimated meals only.
  assert.equal(out.today_so_far.partial, true);
  assert.equal(out.today_so_far.meals_counted, 1);
  assert.equal(out.today_so_far.meals_unestimated, 1, "the unestimated meal is left out explicitly, not added as zero");
  assert.equal(out.today_so_far.protein_g, 30);
  assert.equal(out.today_so_far.kcal, 250);
  assert.equal(
    out.today_so_far.words,
    "So far today: 30 g protein, 250 kcal and 0 g fiber from 1 meal — in progress, not the day's total. 1 more meal has no numbers yet and isn't counted."
  );
  assert.equal(out.room.protein_g, null);
  assert.equal(out.room.energy_kcal, null);
  assert.ok(out.ideas.length > 0);
  for (const idea of out.ideas) {
    assert.doesNotMatch(idea.why, /still to go|kcal/, "no claim measured off a sum that is only a floor");
    assert.equal(idea.fits_band, null);
    assert.equal(idea.portion, 1, "never sized up into room the unknown meal may have used");
  }
});

test("no staples yet: no ideas, said in words", () => {
  const out = fuelIdeas();
  assert.deepEqual(out.ideas, []);
  assert.match(out.words, /No staples/);
});

test("REST and MCP mirror, and exclude asks for different ideas", async () => {
  seedStaples();
  let handler;
  for (const layer of nutritionRouter.stack) {
    if (layer.route?.path === "/fuel/ideas" && layer.route.methods.get) handler = layer.route.stack.at(-1).handle;
  }
  const rest = await new Promise((resolve) => handler({ query: { hour: "12" } }, { json: resolve }));
  const tools = new Map();
  registerNutritionTools({ tool: (n, _d, _s, h) => tools.set(n, h) });
  const mcp = JSON.parse((await tools.get("get_fuel_ideas")({ hour: 12 })).content[0].text);
  assert.deepEqual(
    mcp.ideas.map((i) => i.key),
    rest.ideas.map((i) => i.key)
  );
  // Both surfaces carry the same marked-partial sum.
  assert.deepEqual(mcp.today_so_far, rest.today_so_far);
  assert.equal(rest.today_so_far.partial, true);
  assert.equal(rest.today_so_far.words, "Nothing logged yet today.");
  const first = rest.ideas[0].key;
  const next = await new Promise((resolve) => handler({ query: { exclude: first } }, { json: resolve }));
  assert.ok(!next.ideas.some((i) => i.key.split("@")[0] === first.split("@")[0]));
});

const okBand = (over = {}) => ({
  status: "ok",
  confidence: "moderate",
  energy_ceiling_kcal: 2300,
  band: { low_kcal: 1900, high_kcal: 2500, low_is_loss_edge: true, high_is_gain_edge: true, mixed: false },
  ...over,
});

test("a loose band sizes nothing: mixed weeks or low confidence make no energy claim", () => {
  const mixed = okBand({ band: { ...okBand().band, mixed: true } });
  assert.deepEqual(fuelEnergyBound(mixed, null), { kcal: null, kind: null, allow_up: false });
  assert.equal(fuelEnergyBound(okBand({ confidence: "low" }), null).kcal, null);
  assert.equal(
    fuelEnergyBound({ status: "too_few_days", band: null, energy_ceiling_kcal: null, confidence: null }, null).kcal,
    null
  );
  // Maintain/gain: the no-gain ceiling, sized up and down.
  assert.deepEqual(fuelEnergyBound(okBand(), { kcal: 2400, mode: "maintain", source: "formula" }), {
    kcal: 2300,
    kind: "observed_ceiling",
    allow_up: true,
  });
});

test("during a cut the room is the athlete's own cut bound, never observed maintenance", () => {
  // The loss edge (the most eaten in a week the weight still came down) holds the room.
  assert.deepEqual(fuelEnergyBound(okBand(), { kcal: 2100, mode: "lose", source: "formula" }), {
    kcal: 1900,
    kind: "loss_edge",
    allow_up: true,
  });
  // A target the athlete accepted, when it is lower, holds it instead; a formula guess never does.
  assert.equal(fuelEnergyBound(okBand(), { kcal: 1800, mode: "lose", source: "accepted" }).kind, "accepted_target");
  assert.equal(fuelEnergyBound(okBand(), { kcal: 1800, mode: "lose", source: "formula" }).kind, "loss_edge");
  // No loss edge and no accepted target: the ceiling bounds fit, but nothing is sized up to fill it.
  const noLossEdge = okBand({ band: { ...okBand().band, low_is_loss_edge: false } });
  assert.deepEqual(fuelEnergyBound(noLossEdge, { kcal: 2100, mode: "lose", source: "formula" }), {
    kcal: 2300,
    kind: "observed_ceiling",
    allow_up: false,
  });
  const staple = {
    key: "k",
    title: "T",
    kcal: 400,
    protein_g: 40,
    carbs_g: null,
    fat_g: null,
    times_logged: 3,
    last_logged: null,
    usual_now: false,
  };
  assert.equal(sizeFuelIdea(staple, 100, 2000, false).portion, 1, "no portion grows toward maintenance");
  assert.equal(sizeFuelIdea(staple, 100, 2000, true).portion, 2);
});

test("the ideas say what the room is measured under", () => {
  seedStaples();
  seedBand(); // every week trended down at ~1,800 kcal, and the profile is a cut
  seedIntake(0, 1500, { protein_g: 10 }, { eatenAt: "12:00" });
  const out = fuelIdeas();
  assert.equal(out.room.energy_bound, "loss_edge");
  const fitting = out.ideas.find((i) => i.fits_band === true);
  assert.match(fitting.why, /came down at/);
});

test("today so far is never read as the whole day: partial until complete, unestimated meals counted apart", () => {
  const meal = (kcal, protein_g, fiber_g = 5) => ({ kcal, protein_g, fiber_g });
  const past = "2020-01-02";
  const complete = todaySoFar({ entries: [meal(900, 60), meal(1100, 80)] }, "complete", past);
  assert.equal(complete.partial, false);
  assert.equal(complete.words, "The day's total: 140 g protein, 2,000 kcal and 10 g fiber.");
  const holey = todaySoFar(
    { entries: [meal(900, 60), { kcal: null, protein_g: null, fiber_g: null }] },
    "complete",
    past
  );
  assert.equal(holey.partial, true, "a meal with no numbers keeps even a complete day's sum partial");
  assert.equal(holey.kcal, 900);
  assert.match(
    holey.words,
    /^Logged that day: 60 g protein, 900 kcal and 5 g fiber from 1 meal — not the whole day\. 1 more meal has no numbers yet/
  );
  const none = todaySoFar(
    {
      entries: [
        { kcal: null, protein_g: null },
        { kcal: null, protein_g: null },
      ],
    },
    "in progress",
    past
  );
  assert.equal(none.meals_counted, 0);
  assert.equal(none.meals_unestimated, 2);
  assert.equal(none.words, "2 meals are logged, with no numbers yet, so there is no sum to show.");
  assert.doesNotMatch(`${complete.words} ${holey.words} ${none.words}`, /\blow\b|score|%/);
});
