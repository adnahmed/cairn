// The race build's strength principle has ONE source (src/repo/race-strength.ts) and it
// reads the athlete's training intent: a strength-led athlete (endurance supporting or
// none) keeps PROGRESSING through the whole build and only the legs are trimmed in the
// taper and race week; an endurance-led athlete keeps the classic arc (maintenance
// loads while sharpening, light and fast in the taper, legs off in race week).
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { repo, resetTables } from "./_seed.js";
import { raceStrengthLead, raceStrengthPrinciple } from "../dist/repo/race-strength.js";
import { liftingLine, projectRaceBuildWeeks, raceBuild } from "../dist/repo/race-build.js";
import { weeklySetTargets } from "../dist/repo/volume-floor.js";

const SUPPORTING = {
  priorities: ["longevity", "muscle", "strength", "leanness", "endurance"],
  endurance_role: "supporting",
  source: "explicit",
};
const PRIMARY = { priorities: ["endurance", "strength"], endurance_role: "primary", source: "explicit" };
const RANKED_BELOW = { priorities: ["strength", "muscle", "endurance"], source: "explicit" };
const DERIVED = { priorities: ["strength", "muscle"], endurance_role: "none", source: "derived" };

const MAINTENANCE = "Maintenance loads (2–3 sets of 3–5, nothing new) — power without soreness.";

beforeEach(() => {
  resetTables(
    "logged_sets",
    "sessions",
    "activities",
    "exercises",
    "plan_items",
    "plan_days",
    "program_blocks",
    "plan_proposals",
    "app_state",
    "profile"
  );
});

test("the lead follows the block chooser's own strength-led test", () => {
  assert.equal(raceStrengthLead(SUPPORTING), "strength_led");
  assert.equal(raceStrengthLead({ ...SUPPORTING, endurance_role: "none" }), "strength_led");
  assert.equal(raceStrengthLead(RANKED_BELOW), "strength_led", "endurance ranked below muscle and strength");
  assert.equal(raceStrengthLead(PRIMARY), "endurance_led");
  assert.equal(raceStrengthLead({ ...PRIMARY, endurance_role: "co_primary" }), "endurance_led");
  assert.equal(raceStrengthLead(DERIVED), "endurance_led", "a never-stated intent keeps the endurance arc");
  assert.equal(raceStrengthLead(null), "endurance_led");
});

test("strength-led: every build phase progresses; the taper trims legs only; race week sits heavy legs out", () => {
  const lead = "strength_led";
  for (const phase of ["base", "build", "sharpen", "taper"]) {
    for (const kind of ["build", "down", "peak"]) {
      const p = raceStrengthPrinciple({ phase, kind, lead });
      assert.equal(p.mode, "progression", `${phase}/${kind}`);
      assert.equal(p.upper_progresses, true);
      assert.match(p.principle, /keep progressing/i);
      assert.match(p.principle, /full sets/i);
      assert.doesNotMatch(p.principle, /maintenance|nothing new/i);
    }
  }
  const taper = raceStrengthPrinciple({ phase: "taper", kind: "taper", lead });
  assert.equal(taper.mode, "taper_legs");
  assert.equal(taper.upper_progresses, true);
  assert.match(taper.principle, /upper body keeps progressing/i);
  assert.match(taper.principle, /fewer sets/i);
  assert.match(taper.principle, /80–90%/);
  assert.match(taper.principle, /7–10 days out/);
  const race = raceStrengthPrinciple({ phase: "taper", kind: "race", lead });
  assert.equal(race.mode, "race_week");
  assert.match(race.principle, /heavy leg lifts sit out/i);
  assert.match(race.principle, /upper body keeps progressing/i);
  for (const p of [taper, race]) assert.doesNotMatch(p.principle, /\b(score|grade|must|failing)\b/i);
});

test("endurance-led keeps today's words exactly, keyed by phase", () => {
  const lead = "endurance_led";
  const sharpen = raceStrengthPrinciple({ phase: "sharpen", kind: "build", lead });
  assert.equal(sharpen.mode, "maintenance");
  assert.equal(sharpen.principle, MAINTENANCE);
  assert.equal(raceStrengthPrinciple({ phase: "sharpen", kind: "peak", lead }).principle, MAINTENANCE);
  assert.match(raceStrengthPrinciple({ phase: "build", kind: "build", lead }).principle, /^Heavy lower once a week/);
  assert.match(raceStrengthPrinciple({ phase: "base", kind: "build", lead }).principle, /^Two lower sessions a week/);
  assert.equal(
    raceStrengthPrinciple({ phase: "taper", kind: "taper", lead }).principle,
    "Light and fast: one short session, ~80% of working loads, last heavy lower ~10 days out."
  );
  assert.equal(
    raceStrengthPrinciple({ phase: "taper", kind: "race", lead }).principle,
    "Legs off. A mobility session at most."
  );
  assert.equal(raceStrengthPrinciple({ phase: "past", kind: "build", lead }).principle, "");
});

test("the ladder's strength_hint reads the lead; absent a lead it is the endurance arc", () => {
  const goal = { is_race: true, date: "2026-11-01", distance_km: 21.1, target: "sub-2:00" };
  const asOf = "2026-09-29";
  const led = projectRaceBuildWeeks(goal, asOf, 22, 12, null, null, { strengthLead: "strength_led" });
  const classic = projectRaceBuildWeeks(goal, asOf, 22, 12);
  assert.equal(led.length, classic.length);
  for (let i = 0; i < led.length; i++) {
    const w = led[i];
    assert.equal(
      w.strength_hint,
      raceStrengthPrinciple({ phase: w.phase, kind: w.kind, lead: "strength_led" }).principle,
      `${w.week_start} ${w.kind}`
    );
    assert.equal(
      classic[i].strength_hint,
      raceStrengthPrinciple({ phase: w.phase, kind: w.kind, lead: "endurance_led" }).principle
    );
  }
  const sharpening = led.filter((w) => w.phase === "sharpen");
  assert.ok(sharpening.length > 0, "the fixture has sharpen weeks");
  for (const w of sharpening) assert.doesNotMatch(w.strength_hint, /maintenance/i);
  assert.ok(classic.some((w) => w.strength_hint === MAINTENANCE));
});

test("the with-lifting line: taper and race week say the upper body keeps progressing for a strength-led athlete", () => {
  const ring = [
    {
      day_number: 1,
      weekday: "Monday",
      run: null,
      strength: { name: "Push", heavy_lower: false },
      ride: false,
      hard: false,
    },
    {
      day_number: 7,
      weekday: "Sunday",
      run: { kind: "long", label: "Long run", km: 12 },
      strength: null,
      ride: false,
      hard: true,
    },
  ];
  assert.match(
    liftingLine({ kind: "taper", phase: "taper" }, ring, "strength_led"),
    /upper-body days keep progressing/
  );
  assert.match(liftingLine({ kind: "race", phase: "taper" }, ring, "strength_led"), /upper-body days keep progressing/);
  assert.match(liftingLine({ kind: "taper", phase: "taper" }, ring), /carry on as usual/);
  assert.match(liftingLine({ kind: "race", phase: "taper" }, ring), /upper-body days carry on\./);
});

function seedRace(intent) {
  repo.setProfile({
    age: 40,
    sex: "male",
    primary_discipline: "hybrid",
    endurance_sport: "running",
    training_intent: intent,
    endurance_goal: {
      mode: "race",
      event: "Riverside Half",
      date: "2026-11-01",
      distance_km: 21.1,
      target: "sub-2:00",
    },
  });
  for (let wk = 0; wk < 4; wk++) {
    const base = new Date(Date.UTC(2026, 8, 27) - wk * 7 * 864e5); // the Sundays back from 2026-09-27
    const day = (n) => new Date(base.getTime() - n * 864e5).toISOString().slice(0, 10);
    repo.addActivity({ type: "run", duration_min: 40, distance_km: 6, date: day(5) });
    repo.addActivity({ type: "run", duration_min: 45, distance_km: 7, date: day(3) });
    repo.addActivity({ type: "run", duration_min: 75, distance_km: 12, date: day(0) });
  }
  repo.replacePlan([
    {
      day_number: 1,
      name: "Push",
      items: [{ exercise: "Barbell Bench Press", sets: 3, rep_low: 5, rep_high: 7, target_weight: 135 }],
    },
    {
      day_number: 3,
      name: "Lower A",
      items: [{ exercise: "Back Squat", sets: 3, rep_low: 5, rep_high: 7, target_weight: 185 }],
    },
  ]);
}

test("raceBuild in the sharpen phase: a supporting runner is told to keep progressing, a primary runner keeps maintenance", () => {
  const asOf = "2026-09-29"; // five weeks out: sharpen
  seedRace(SUPPORTING);
  const led = raceBuild(asOf);
  assert.equal(led.available, true, led.reason);
  assert.equal(led.race.phase, "sharpen");
  assert.match(led.strength.principle, /keep progressing/i);
  assert.doesNotMatch(led.strength.principle, /maintenance/i);
  for (const w of led.weeks.filter((w) => w.kind !== "taper" && w.kind !== "race"))
    assert.match(w.strength_hint, /keep progressing/i, w.week_start);
  assert.match(led.weeks.find((w) => w.kind === "taper").strength_hint, /upper body keeps progressing/i);

  seedRace(PRIMARY);
  const classic = raceBuild(asOf);
  assert.equal(classic.available, true, classic.reason);
  assert.equal(classic.strength.principle, MAINTENANCE);
  assert.ok(classic.weeks.some((w) => w.strength_hint === MAINTENANCE));
});

test("the volume floor in a strength-led taper stands the legs aside and keeps the upper-body floor", () => {
  const ctx = { strength_priority: true, muscle_priority: true, endurance_carried: [], exempt: null };
  const all = weeklySetTargets(ctx).map((t) => t.group);
  const trimmed = weeklySetTargets({ ...ctx, race_trimmed: ["quads", "hamstrings", "glutes", "calves"] }).map(
    (t) => t.group
  );
  for (const g of ["chest", "back", "shoulders", "biceps", "triceps"]) assert.ok(trimmed.includes(g), g);
  for (const g of ["quads", "hamstrings", "glutes", "calves"]) {
    assert.ok(all.includes(g), g);
    assert.ok(!trimmed.includes(g), g);
  }
  assert.deepEqual(weeklySetTargets({ ...ctx, exempt: "race_taper" }), [], "an endurance-led taper stays exempt whole");
});
