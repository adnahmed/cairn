// The meal card (meal-card-model.ts + meal-card-client.ts + meal-card-controller.ts):
// a logged meal as one editable row per item in the foodCapture.ts ingredient shape,
// with optimistic totals and ONE PUT /api/food-notes/:id per save.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHost, fire, flush, loadClientModule, renderHtml } from "./_dom.mjs";

// Objects built inside the sandbox carry its prototypes; compare them as plain data.
const plain = (value) => JSON.parse(JSON.stringify(value));

function load() {
  return loadClientModule([
    "html-utils",
    "ui-actions-client",
    "meal-card-model",
    "meal-card-client",
    "meal-card-controller",
  ]);
}

// A pasted multi-line meal: seven items, most with a weight, one with a count.
function pastedNote(overrides = {}) {
  return {
    id: 42,
    meal: "lunch",
    enrichment_status: "done",
    parsed: {
      summary: "Chicken rice bowl",
      kcal: 900,
      protein_g: 70,
      carbs_g: 95,
      fat_g: 24,
      fiber_g: 9,
      confidence: "medium",
      basis: "estimated_from_foods",
      ingredients: [
        {
          item: "Chicken breast",
          amount: "200 g",
          kcal: 330,
          protein_g: 62,
          carbs_g: 0,
          fat_g: 7,
          fiber_g: 0,
          basis: "label",
        },
        { item: "White rice", amount: "150 g", kcal: 195, protein_g: 4, carbs_g: 43, fat_g: 0.4, fiber_g: 0.6 },
        { item: "Broccoli", amount: "100g", kcal: 34, protein_g: 2.8, carbs_g: 7, fat_g: 0.4, fiber_g: 2.6 },
        { item: "Olive oil", amount: "10 g", kcal: 88, protein_g: 0, carbs_g: 0, fat_g: 10, fiber_g: 0 },
        { item: "Eggs", amount: "2 eggs", kcal: 144, protein_g: 12.6, carbs_g: 0.7, fat_g: 9.5, fiber_g: 0 },
        { item: "Black beans", amount: "0.1 kg", kcal: 132, protein_g: 8.9, carbs_g: 23.7, fat_g: 0.5, fiber_g: 8.7 },
        { item: "Salsa", amount: "30 g", kcal: 10, protein_g: 0.5, carbs_g: 2, fat_g: 0, fiber_g: 0.5 },
      ],
      ...overrides,
    },
  };
}

function recorder(respond) {
  const calls = [];
  const toasts = [];
  const motion = { expanded: [], collapsed: [] };
  const totals = [];
  const saved = [];
  const deps = {
    api: async (path, init) => {
      calls.push({ path, method: init?.method, body: JSON.parse(init?.body || "null") });
      return respond ? respond(path, init) : null;
    },
    toast: (message) => toasts.push(message),
    expandEl: (el) => motion.expanded.push(el),
    collapseEl: (el, done) => {
      motion.collapsed.push(el);
      done();
    },
    reducedMotion: () => false,
    onTotals: (value, meta) => totals.push({ value: { ...value }, meta }),
    onSaved: (note) => saved.push(note),
  };
  return { calls, toasts, motion, totals, saved, deps };
}

function mount(win, note, deps) {
  const host = createHost(win.document);
  const teardown = win.CairnMealCardController.mount(host, { note, ...deps });
  return { host, teardown };
}

async function typeGrams(host, index, value) {
  const input = host.querySelectorAll("[data-meal-card-grams]")[index];
  input.value = value;
  await fire(input, "input");
  return input;
}

test("a pasted 7-item meal renders one row per item, grams as decimal fields, provenance in words", () => {
  const win = load();
  const model = win.CairnMealCardModel.mealCardModel(pastedNote());
  const host = renderHtml(win.CairnMealCard.mealCardHtml(model), { document: win.document });
  const rows = host.querySelectorAll(".meal-card-row");
  assert.equal(rows.length, 7);
  const grams = host.querySelectorAll("[data-meal-card-grams]");
  assert.equal(grams.length, 7);
  for (const input of grams) {
    assert.equal(input.getAttribute("inputmode"), "decimal");
    assert.match(input.getAttribute("aria-label"), /^Grams of /);
  }
  assert.deepEqual(
    [...grams].map((input) => input.value),
    ["200", "150", "100", "10", "", "100", "30"],
    "weights parse from g / kg; a count leaves the field empty"
  );
  assert.equal(rows[4].querySelector(".meal-card-amount").textContent, "2 eggs", "a count stays visible");
  assert.equal(host.querySelector(".meal-card-prov").textContent, "Estimated from usual servings · medium confidence");
  assert.equal(
    rows[0].querySelector(".meal-card-basis").textContent,
    "read off the label",
    "a row's own basis shows when it differs"
  );
  assert.equal(rows[1].querySelector(".meal-card-basis"), null);
  assert.equal(
    host.querySelector(".meal-card-totals").textContent,
    "900 kcal · 70 g protein · 9 g fiber · 95 g carbs · 24 g fat"
  );
  assert.equal(host.querySelector("[data-meal-card-save]").disabled, true, "nothing to save yet");
  assert.equal(host.querySelectorAll("button[data-meal-card-remove]").length, 7);
  assert.equal(host.querySelector("[data-meal-card-add]").getAttribute("type"), "button");
});

test("hostile item text is escaped, never markup", () => {
  const win = load();
  const note = pastedNote({ ingredients: [{ item: `<b>x</b>"`, amount: "<i>2</i>", kcal: 10 }] });
  const host = renderHtml(win.CairnMealCard.mealCardHtml(win.CairnMealCardModel.mealCardModel(note)), {
    document: win.document,
  });
  assert.equal(host.querySelector("b"), null);
  assert.equal(host.querySelector("i"), null);
  assert.equal(host.querySelector(".meal-card-item").textContent, `<b>x</b>"`);
  assert.equal(host.querySelector("[data-meal-card-remove]").getAttribute("aria-label"), `Remove <b>x</b>"`);
});

test("model: weights parse, rows rescale, and unsaved totals move the stored total by the edit", () => {
  const win = load();
  const M = win.CairnMealCardModel;
  assert.equal(M.gramsFromAmount("205 g"), 205);
  assert.equal(M.gramsFromAmount("1,5 kg"), 1500);
  assert.equal(M.gramsFromAmount("6 oz"), 170.1);
  assert.equal(M.gramsFromAmount("2 eggs"), null);
  assert.equal(M.parseGramsInput("12,5"), 12.5);
  assert.equal(M.parseGramsInput("abc"), null);
  assert.equal(M.parseGramsInput("0"), null);

  const note = pastedNote();
  const original = M.mealCardRows(note);
  const rows = M.mealCardRows(note);
  rows[0].grams = 300;
  rows[0].edited = true;
  assert.equal(M.rowMacros(rows[0]).kcal, 495);
  // Stored 900 kcal; the chicken went 330 -> 495.
  assert.equal(M.optimisticTotals(M.storedTotals(note), original, rows).kcal, 1065);
  assert.equal(M.optimisticTotals(M.storedTotals(note), original, rows).protein_g, 101);
  assert.deepEqual(plain(M.rowBody(rows[0])), {
    item: "Chicken breast",
    amount: "300 g",
    kcal: 495,
    protein_g: 93,
    carbs_g: 0,
    fat_g: 10.5,
    fiber_g: 0,
    basis: "user_report",
  });
  // A count takes grams but cannot be rescaled: no per-gram figure exists.
  rows[4].grams = 120;
  rows[4].edited = true;
  assert.equal(M.rowMacros(rows[4]).kcal, 144);
  assert.equal(M.rowBody(rows[4]).amount, "120 g");
  assert.equal(M.rowBody(rows[4]).basis, null);
  assert.equal(M.rowsChanged(original, M.mealCardRows(note)), false);
  assert.equal(M.rowsChanged(original, rows), true);
});

test("editing one row's grams moves the totals at once and saves with exactly one PUT", async () => {
  const win = load();
  const server = pastedNote({ kcal: 1070, protein_g: 102 });
  server.parsed.ingredients[0] = { ...server.parsed.ingredients[0], amount: "300 g", kcal: 495, protein_g: 93 };
  const { calls, totals, saved, deps } = recorder(() => server);
  const { host } = mount(win, pastedNote(), deps);

  await typeGrams(host, 0, "300");
  const line = host.querySelector(".meal-card-totals");
  assert.match(line.textContent, /^1065 kcal · 101 g protein/, "optimistic, before any request");
  assert.equal(line.classList.contains("is-unsaved"), true);
  assert.match(
    host.querySelector('[data-meal-card-row="r0"] .meal-card-nutri').textContent,
    /~495 kcal · 93 g protein/
  );
  assert.equal(calls.length, 0, "typing never writes");
  assert.equal(totals.at(-1).meta.unsaved, true);

  const save = host.querySelector("[data-meal-card-save]");
  assert.equal(save.disabled, false);
  const tap = save.click();
  await save.click();
  await tap;
  await flush();

  assert.equal(calls.length, 1, "one PUT");
  assert.equal(calls[0].path, "/food-notes/42");
  assert.equal(calls[0].method, "PUT");
  assert.deepEqual(Object.keys(calls[0].body), ["ingredients"], "row-shaped body only; the server owns the totals");
  assert.equal(calls[0].body.ingredients.length, 7);
  assert.deepEqual(calls[0].body.ingredients[0], {
    item: "Chicken breast",
    amount: "300 g",
    kcal: 495,
    protein_g: 93,
    carbs_g: 0,
    fat_g: 10.5,
    fiber_g: 0,
    basis: "user_report",
  });
  assert.equal(calls[0].body.ingredients[1].amount, "150 g", "untouched rows go back as logged");

  const after = host.querySelector(".meal-card-totals");
  assert.match(after.textContent, /^1070 kcal · 102 g protein/, "the server's numbers win");
  assert.equal(after.classList.contains("is-unsaved"), false);
  assert.equal(after.classList.contains("is-settled"), true);
  assert.equal(host.querySelector(".meal-card-status").textContent, "Saved");
  assert.equal(host.querySelector("[data-meal-card-save]").disabled, true);
  assert.equal(host.querySelectorAll("[data-meal-card-grams]")[0].value, "300");
  assert.equal(saved.length, 1);
  assert.deepEqual(plain(totals.at(-1)), {
    value: { kcal: 1070, protein_g: 102, carbs_g: 95, fat_g: 24, fiber_g: 9 },
    meta: { saved: true, unsaved: false },
  });
  assert.equal(host.querySelector(".meal-card-status").getAttribute("role"), "status");
});

test("a failed save keeps every edit and says so; the next save still goes", async () => {
  const win = load();
  let fail = true;
  const { calls, toasts, deps } = recorder(() => {
    if (fail) throw new Error("offline");
    return pastedNote({ kcal: 1065 });
  });
  const { host } = mount(win, pastedNote(), deps);
  await typeGrams(host, 0, "300");
  await host.querySelector("[data-meal-card-save]").click();
  await flush();
  assert.equal(calls.length, 1);
  assert.equal(host.querySelector(".meal-card-status").textContent, "Not saved — your changes are still here.");
  assert.equal(host.querySelectorAll("[data-meal-card-grams]")[0].value, "300");
  assert.match(host.querySelector(".meal-card-totals").textContent, /^1065 kcal/);
  assert.deepEqual(toasts, ["Couldn't save that meal"]);
  const save = host.querySelector("[data-meal-card-save]");
  assert.equal(save.disabled, false);
  assert.equal(save.getAttribute("aria-busy"), null);

  fail = false;
  await save.click();
  await flush();
  assert.equal(calls.length, 2);
  assert.equal(host.querySelector(".meal-card-status").textContent, "Saved");
});

test("a calm refusal prints the server's sentence in place", async () => {
  const win = load();
  const { deps } = recorder(() => ({ ok: false, error: "That meal was removed." }));
  const { host } = mount(win, pastedNote(), deps);
  await typeGrams(host, 1, "200");
  await host.querySelector("[data-meal-card-save]").click();
  await flush();
  assert.equal(host.querySelector(".meal-card-status").textContent, "That meal was removed.");
  assert.equal(host.querySelectorAll("[data-meal-card-grams]")[1].value, "200");
});

test("add a row and remove a row, through expandEl and collapseEl", async () => {
  const win = load();
  const { calls, motion, deps } = recorder((_path, init) => {
    const body = JSON.parse(init.body);
    return pastedNote({ ingredients: body.ingredients });
  });
  const { host } = mount(win, pastedNote(), deps);

  await host.querySelector("[data-meal-card-add]").click();
  const rows = host.querySelectorAll(".meal-card-row");
  assert.equal(rows.length, 8);
  const added = rows[7];
  assert.equal(motion.expanded[0], added);
  const name = added.querySelector("[data-meal-card-name]");
  assert.equal(win.document.activeElement, name, "the new row takes focus");
  assert.equal(host.querySelector("[data-meal-card-save]").disabled, true, "a nameless row is not a change");
  name.value = "Avocado";
  await fire(name, "input");
  const grams = added.querySelector("[data-meal-card-grams]");
  grams.value = "50";
  await fire(grams, "input");
  assert.match(added.querySelector(".meal-card-nutri").textContent, /not estimated/);

  await host.querySelectorAll("[data-meal-card-remove]")[3].click();
  assert.equal(motion.collapsed.length, 1);
  assert.equal(host.querySelectorAll(".meal-card-row").length, 7);
  assert.equal(host.querySelector('[data-meal-card-row="r3"]'), null);
  // Stored 900, minus the removed olive oil (88).
  assert.match(host.querySelector(".meal-card-totals").textContent, /^812 kcal/);

  await fire(grams, "keydown", { key: "Enter" });
  await flush();
  assert.equal(calls.length, 1, "Enter saves");
  const sent = calls[0].body.ingredients;
  assert.equal(sent.length, 7);
  assert.equal(
    sent.some((row) => row.item === "Olive oil"),
    false
  );
  assert.deepEqual(sent.at(-1), {
    item: "Avocado",
    amount: "50 g",
    kcal: null,
    protein_g: null,
    carbs_g: null,
    fat_g: null,
    fiber_g: null,
    basis: "user_report",
  });
});

test("the last row cannot be removed", async () => {
  const win = load();
  const { deps } = recorder();
  const note = pastedNote({ ingredients: [{ item: "Apple", amount: "180 g", kcal: 94 }] });
  const { host } = mount(win, note, deps);
  assert.equal(host.querySelector(".meal-card-rows").classList.contains("is-single"), true);
  await host.querySelector("[data-meal-card-remove]").click();
  assert.equal(host.querySelectorAll(".meal-card-row").length, 1);
});

test("clearing a grams field reads as logged; nonsense is flagged and ignored", async () => {
  const win = load();
  const { deps } = recorder();
  const { host } = mount(win, pastedNote(), deps);
  await typeGrams(host, 0, "300");
  const input = await typeGrams(host, 0, "abc");
  assert.equal(input.hasAttribute("aria-invalid"), true);
  assert.match(host.querySelector(".meal-card-totals").textContent, /^1065 kcal/);
  await typeGrams(host, 0, "");
  assert.equal(input.hasAttribute("aria-invalid"), false);
  assert.match(host.querySelector(".meal-card-totals").textContent, /^900 kcal/);
  assert.equal(host.querySelector("[data-meal-card-save]").disabled, true);
});

test("mounting twice on one host still saves once per tap; teardown removes the listeners", async () => {
  const win = load();
  const { calls, deps } = recorder(() => pastedNote());
  const host = createHost(win.document);
  win.CairnMealCardController.mount(host, { note: pastedNote(), ...deps });
  const teardown = win.CairnMealCardController.mount(host, { note: pastedNote(), ...deps });
  await typeGrams(host, 0, "250");
  await host.querySelector("[data-meal-card-save]").click();
  await flush();
  assert.equal(calls.length, 1);

  teardown();
  await typeGrams(host, 0, "260");
  assert.equal(host.querySelector("[data-meal-card-save]").disabled, true, "no listener after teardown");
});

test("edits made while a save is in flight are kept, and measured from what was saved", async () => {
  const win = load();
  let release;
  const { calls, deps } = recorder(
    () =>
      new Promise((resolve) => {
        release = () => {
          const note = pastedNote({ kcal: 1065 });
          note.parsed.ingredients[0] = { ...note.parsed.ingredients[0], amount: "300 g", kcal: 495, protein_g: 93 };
          resolve(note);
        };
      })
  );
  const { host } = mount(win, pastedNote(), deps);
  await typeGrams(host, 0, "300");
  const pending = host.querySelector("[data-meal-card-save]").click();
  await flush();
  await typeGrams(host, 1, "300");
  release();
  await pending;
  await flush();
  assert.equal(calls.length, 1);
  assert.equal(host.querySelectorAll("[data-meal-card-grams]")[1].value, "300", "the newer edit survives");
  // Saved 1065, plus rice 195 -> 390.
  assert.match(host.querySelector(".meal-card-totals").textContent, /^1260 kcal/);
  assert.equal(host.querySelector("[data-meal-card-save]").disabled, false);
});

test("a save that lands after the person left writes nothing", async () => {
  const win = load();
  let release;
  const { deps, saved } = recorder(() => new Promise((resolve) => (release = () => resolve(pastedNote()))));
  const { host } = mount(win, pastedNote(), deps);
  await typeGrams(host, 0, "300");
  const pending = host.querySelector("[data-meal-card-save]").click();
  await flush();
  host.remove();
  release();
  await pending;
  await flush();
  assert.equal(saved.length, 0);
  assert.equal(host.querySelector(".meal-card-status").textContent, "Saving…");
});
