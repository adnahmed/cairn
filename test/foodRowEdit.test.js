// v2 wave 2, stream A — a logged meal is editable by its rows.
//
// The meal card fixes a meal in place: change one row's grams, add a row, drop a
// row. The note's totals must follow from the rows in ONE PUT with no agent turn
// (per-gram scaling off each row's own estimate, rules in src/foodCapture.ts
// recomputeFoodIngredients), and a person's edit must win over a late enrichment
// pass — queued or already running.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, repo, resetTables } from "./_seed.js";
import { nutritionRouter } from "../dist/routes/nutrition.js";
import { registerNutritionTools } from "../dist/surfaces/mcp/nutrition.js";
import { parseFoodQuantity, recomputeFoodIngredients } from "../dist/foodCapture.js";
import { applyFoodEstimate, applyFoodPhoto, processFoodPhotoJob } from "../dist/enrich.js";
import { foodNoteEditedByPerson, setFoodNoteEnrichStatus, updateFoodNoteParsed } from "../dist/repo/nutrition.js";

beforeEach(() => {
  resetTables("food_notes", "chat_turns", "chat_messages");
  // Offline: no real CLI may be probed by the photo path.
  repo.setSettings({ disabled_agents: ["claude", "codex", "antigravity", "grok", "stub"] });
});

function restHandler(method, path) {
  for (const layer of nutritionRouter.stack) {
    const r = layer.route;
    if (r && r.path === path && r.methods[method]) return r.stack[r.stack.length - 1].handle;
  }
  throw new Error(`no ${method.toUpperCase()} ${path} route`);
}

const putFoodNote = (id, body) =>
  new Promise((resolve) => {
    let status = 200;
    restHandler("put", "/food-notes/:id")(
      { params: { id: String(id) }, body },
      {
        status(s) {
          status = s;
          return this;
        },
        json(payload) {
          resolve([status, payload]);
        },
      }
    );
  });

function mcpTool(name) {
  const tools = new Map();
  registerNutritionTools({ tool: (n, _d, schema, handler) => tools.set(n, { schema, handler }) });
  return tools.get(name);
}

// A meal with an itemized estimate whose total equals its rows.
function seedMeal(extra = {}) {
  return repo.addFoodNote("lunch", "", {
    summary: "Chicken and rice",
    kcal: 525,
    protein_g: 66,
    carbs_g: 42,
    fat_g: 8,
    ingredients: [
      { item: "chicken breast", amount: "200 g", kcal: 330, protein_g: 62, carbs_g: 0, fat_g: 7 },
      { item: "white rice", amount: "150 g", kcal: 195, protein_g: 4, carbs_g: 42, fat_g: 1 },
    ],
    confidence: "medium",
    basis: "estimated_from_foods",
    ...extra,
  });
}

const chatCount = () => Number(db.prepare(`SELECT COUNT(*) AS n FROM chat_messages`).get().n);

test("editing one row's grams recomputes the totals in one PUT, with no chat message", async () => {
  const note = seedMeal();
  const before = chatCount();
  const [status, updated] = await putFoodNote(note.id, {
    ingredients: [
      { item: "chicken breast", amount: "200 g", kcal: 330, protein_g: 62, carbs_g: 0, fat_g: 7, grams: 250 },
      { item: "white rice", amount: "150 g", kcal: 195, protein_g: 4, carbs_g: 42, fat_g: 1 },
    ],
  });
  assert.equal(status, 200);
  const chicken = updated.parsed.ingredients[0];
  assert.equal(chicken.amount, "250 g");
  assert.equal(chicken.kcal, 412.5, "330 kcal × 250/200");
  assert.equal(chicken.protein_g, 77.5);
  assert.equal(chicken.basis, "user_report", "the quantity is now the person's own");
  assert.equal(updated.parsed.kcal, 608, "412.5 + 195, rounded at the meal");
  assert.equal(updated.parsed.protein_g, 82);
  assert.deepEqual(updated.parsed.items, ["chicken breast (250 g)", "white rice (150 g)"]);
  assert.equal(updated.enrichment_status, "done");
  assert.ok(updated.person_edited_at, "the edit locks the note");
  assert.equal(chatCount(), before, "no chat turn and no follow-up message");

  const day = repo.getDayIntake(updated.date);
  const entry = day.entries.find((e) => e.id === note.id);
  assert.equal(entry.kcal, 608);
  assert.equal(entry.person_edited, true);
  assert.equal(entry.ingredients.length, 2);
});

test("a stale echoed amount does not double-scale: the stored twin is the reference", async () => {
  const note = seedMeal();
  // The client already rewrote `amount` but kept the old macros, and sent grams too.
  const [, updated] = await putFoodNote(note.id, {
    ingredients: [
      { item: "Chicken breast", amount: "100 g", kcal: 330, protein_g: 62, grams: 100 },
      { item: "white rice" },
    ],
  });
  assert.equal(updated.parsed.ingredients[0].kcal, 165, "330 × 100/200 from the stored 200 g");
  assert.equal(updated.parsed.ingredients[1].kcal, 195, "an echoed row with no fields keeps its stored estimate");
  assert.equal(updated.parsed.kcal, 360);
});

test("removing a row drops it from the totals; adding a row with no nutrition is flagged low and totals what is known", async () => {
  const note = seedMeal();
  const [, removed] = await putFoodNote(note.id, {
    ingredients: [{ item: "chicken breast", amount: "200 g", kcal: 330, protein_g: 62, carbs_g: 0, fat_g: 7 }],
  });
  assert.equal(removed.parsed.kcal, 330);
  assert.equal(removed.parsed.carbs_g, 0, "the removed row's carbs leave the total");
  assert.equal(removed.parsed.ingredients.length, 1);

  const [, added] = await putFoodNote(note.id, {
    ingredients: [...removed.parsed.ingredients, { item: "hot sauce", amount: "1 tbsp" }],
  });
  const sauce = added.parsed.ingredients[1];
  assert.equal(sauce.item, "hot sauce");
  assert.equal(sauce.kcal, undefined, "no invented estimate — Cairn has no food table to look it up in");
  assert.equal(sauce.confidence, "low");
  assert.equal(added.parsed.kcal, 330, "the known rows still total");
  assert.equal(added.parsed.confidence, "low", "a row without an estimate makes the meal total a floor");
});

test("a meal-level estimate beyond the rows is kept as the unitemized remainder", async () => {
  // The agent counted 75 kcal of cooking oil at meal level only.
  const note = seedMeal({ kcal: 600 });
  const [, updated] = await putFoodNote(note.id, {
    ingredients: [
      { item: "chicken breast", grams: 100 },
      { item: "white rice", amount: "150 g" },
    ],
  });
  assert.equal(updated.parsed.kcal, 75 + 165 + 195);
});

test("count units scale too, typed macros win, and a same-call meal total wins over the sum", async () => {
  const note = repo.addFoodNote("breakfast", "", {
    summary: "Eggs and toast",
    kcal: 300,
    protein_g: 16,
    ingredients: [
      { item: "eggs", amount: "2 eggs", kcal: 150, protein_g: 12 },
      { item: "toast", amount: "1 slice", kcal: 150, protein_g: 4 },
    ],
  });
  const [, scaled] = await putFoodNote(note.id, {
    ingredients: [
      { item: "eggs", amount: "3 eggs" },
      { item: "toast", amount: "1 slice", kcal: 110, protein_g: 4 }, // read off the label
    ],
  });
  assert.equal(scaled.parsed.ingredients[0].kcal, 225, "150 × 3/2");
  assert.equal(scaled.parsed.ingredients[1].kcal, 110, "typed macros are taken as stated");
  assert.equal(scaled.parsed.ingredients[1].basis, "user_report");
  assert.equal(scaled.parsed.kcal, 335);

  const [, stated] = await putFoodNote(note.id, { ingredients: scaled.parsed.ingredients, kcal: 400 });
  assert.equal(stated.parsed.kcal, 400, "a stated total always wins");
});

test("a quantity that cannot be compared keeps the old macros and reads low confidence", () => {
  const out = recomputeFoodIngredients({ kcal: 150, ingredients: [{ item: "eggs", amount: "2 eggs", kcal: 150 }] }, [
    { item: "eggs", grams: 120 },
  ]);
  assert.equal(out.ingredients[0].amount, "120 g");
  assert.equal(out.ingredients[0].kcal, 150);
  assert.equal(out.ingredients[0].confidence, "low");
  assert.deepEqual(parseFoodQuantity("~1.5 kg"), { value: 1500, unit: "g" });
  assert.deepEqual(parseFoodQuantity("3 eggs"), { value: 3, unit: "egg" });
  assert.equal(parseFoodQuantity("a handful"), null);
});

test("MCP update_food_note mirrors the row edit", async () => {
  const note = seedMeal();
  const tool = mcpTool("update_food_note");
  const out = JSON.parse(
    (
      await tool.handler({
        id: note.id,
        ingredients: [
          { item: "chicken breast", grams: 300 },
          { item: "white rice", amount: "150 g" },
        ],
      })
    ).content[0].text
  );
  assert.equal(out.parsed.ingredients[0].kcal, 495);
  assert.equal(out.parsed.kcal, 690);
  assert.ok(out.person_edited_at);
});

// ---- a person's edit wins over enrichment ----

test("a late text-enrichment estimate never overwrites a person's edit (the race)", async () => {
  const note = seedMeal();
  // The enricher picked the note up and is mid-flight…
  db.prepare(`UPDATE food_notes SET enrichment_status = 'in_progress' WHERE id = ?`).run(note.id);
  // …the person fixes the chicken…
  const [, edited] = await putFoodNote(note.id, { ingredients: [{ item: "chicken breast", grams: 150 }] });
  assert.equal(edited.parsed.kcal, 248);
  // …and then the agent's answer lands.
  const wrote = applyFoodEstimate(note.id, {
    summary: "Chicken and rice (agent)",
    kcal: 900,
    protein_g: 70,
    ingredients: [{ item: "chicken breast", amount: "200 g", kcal: 330 }],
  });
  assert.equal(wrote, false);
  setFoodNoteEnrichStatus(note.id, "failed"); // whatever the pass reports afterwards
  const row = repo.getFoodNote(note.id);
  assert.equal(row.parsed.kcal, 248, "the person's number stands");
  assert.equal(row.parsed.summary, "Chicken and rice");
  assert.equal(row.parsed.ingredients[0].amount, "150 g");
  assert.equal(row.enrichment_status, "done", "an edited note stays settled");
});

test("the photo path and the raw enrichment writer both refuse an edited note; an untouched note still enriches", async () => {
  const edited = seedMeal();
  await putFoodNote(edited.id, { meal: "dinner" });
  assert.equal(foodNoteEditedByPerson(edited.id), true);
  assert.equal(applyFoodPhoto(edited.id, { kcal: 999, protein_g: 10 }), false);
  assert.equal(updateFoodNoteParsed(edited.id, { kcal: 1 }), null);
  assert.equal(repo.getFoodNote(edited.id).parsed.kcal, 525);

  // processFoodPhotoJob returns before any agent and leaves the settled status alone.
  db.prepare(`UPDATE food_notes SET image_path = '/tmp/plate.jpg' WHERE id = ?`).run(edited.id);
  await processFoodPhotoJob(edited.id);
  assert.equal(repo.getFoodNote(edited.id).enrichment_status, "done");

  const untouched = seedMeal();
  assert.equal(foodNoteEditedByPerson(untouched.id), false);
  assert.equal(applyFoodEstimate(untouched.id, { kcal: 700, protein_g: 60 }), true);
  assert.equal(repo.getFoodNote(untouched.id).parsed.kcal, 700);
});
