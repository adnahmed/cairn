// Fuel — the day's logged meals (fuel-meals-client/-controller.ts, docs/V2-PLAN.md
// wave 2). Each logged meal is a quiet row that opens into the meal card (stream B's
// component): a row's grams are corrected in place with one PUT and the head follows
// the card's totals. A re-read reconciles by id, so a card open mid-edit keeps its
// node; a still-estimating meal is watched until it settles; Remove takes two taps.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHost, fire, flush, loadClientModule, renderHtml } from "./_dom.mjs";

const TODAY = "2026-04-25";

function load() {
  return loadClientModule(
    [
      "html-utils",
      "ui-actions-client",
      "meal-card-model",
      "meal-card-client",
      "meal-card-controller",
      "fuel-today-model",
      "fuel-today-controller",
      "fuel-meals-client",
      "fuel-meals-controller",
    ],
    { globals: { art: () => "<svg></svg>" } }
  );
}

function bowl(overrides = {}) {
  return {
    id: 42,
    meal: "lunch",
    summary: "Chicken rice bowl",
    kcal: 525,
    protein_g: 66,
    carbs_g: 43,
    fat_g: 7.4,
    fiber_g: 0.6,
    confidence: "medium",
    basis: "estimated_from_foods",
    ingredients: [
      { item: "Chicken breast", amount: "200 g", kcal: 330, protein_g: 62, carbs_g: 0, fat_g: 7, fiber_g: 0 },
      { item: "White rice", amount: "150 g", kcal: 195, protein_g: 4, carbs_g: 43, fat_g: 0.4, fiber_g: 0.6 },
    ],
    raw: "chicken 200g, rice 150g",
    enrichment_status: "done",
    eaten_at: null,
    logged_at: "8:40 AM",
    ...overrides,
  };
}

function day(entries) {
  return { date: TODAY, count: entries.length, entries, totals: {}, known: {} };
}

// ---------- renderer ----------

test("a meal is a quiet row: what it was, when it was said, protein first", () => {
  const win = load();
  const meals = win.CairnFuelTodayModel.mealModels(
    day([
      bowl({ eaten_at: "13:00", logged_at: "1:00 PM" }),
      bowl({ id: 43, meal: "snack", summary: "Apple", ingredients: [], kcal: 95, protein_g: null }),
    ])
  );
  const host = renderHtml(win.CairnFuelMeals.listHtml(meals), { document: win.document });
  const rows = host.querySelectorAll(".fuel-meal");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].querySelector(".fuel-meal-name").textContent, "Chicken rice bowl");
  assert.equal(rows[0].querySelector(".fuel-meal-meta").textContent, "Lunch · 1:00 PM");
  assert.equal(rows[0].querySelector(".fuel-meal-nums").textContent, "66 g protein · ~525 kcal");
  // An unstated time never shows the write-time clock.
  assert.equal(rows[1].querySelector(".fuel-meal-meta").textContent, "Snack");
  const head = rows[0].querySelector("[data-fuel-meals-toggle]");
  assert.equal(head.getAttribute("type"), "button");
  assert.equal(head.getAttribute("aria-expanded"), "false");
  assert.equal(head.getAttribute("aria-controls"), rows[0].querySelector(".fuel-meal-panel").id);
  assert.ok(rows[0].querySelector("[data-fuel-meal-card]"), "an itemized meal opens into the meal card");
  assert.equal(rows[1].querySelector("[data-fuel-meal-card]"), null, "a whole-meal entry has nothing to itemize");
  assert.match(rows[1].querySelector(".fuel-meal-note").textContent, /one whole meal/);
});

test("a meal still being estimated says so, and never shows a zero", () => {
  const win = load();
  const meals = win.CairnFuelTodayModel.mealModels(
    day([bowl({ enrichment_status: "pending", kcal: null, protein_g: null })])
  );
  const host = renderHtml(win.CairnFuelMeals.listHtml(meals), { document: win.document });
  assert.equal(host.querySelector(".fuel-meal-nums").textContent, "estimating…");
  assert.equal(host.querySelector("[data-fuel-meal-card]"), null);
  assert.match(host.querySelector(".fuel-meal-note").textContent, /Still being estimated/);
});

test("hostile text comes back as text", () => {
  const win = load();
  const meals = win.CairnFuelTodayModel.mealModels(
    day([bowl({ summary: "<b>x</b>", raw: "<img src=x>", meal: "<i>m</i>" })])
  );
  const host = renderHtml(win.CairnFuelMeals.listHtml(meals), { document: win.document });
  assert.equal(host.querySelector("b"), null);
  assert.equal(host.querySelector("img"), null);
  assert.equal(host.querySelector("i"), null);
  assert.equal(host.querySelector(".fuel-meal-name").textContent, "<b>x</b>");
});

test("an empty today collapses; an empty past day says so plainly", () => {
  const win = load();
  assert.equal(win.CairnFuelMeals.listHtml([], { isToday: true }), "");
  const past = renderHtml(win.CairnFuelMeals.listHtml([], { isToday: false }), { document: win.document });
  assert.equal(past.textContent.trim(), "No meals were logged that day.");
});

// ---------- controller ----------

function harness({ entries = [bowl()], respond = null, reduced = true } = {}) {
  const win = load();
  const store = new Map();
  let current = day(entries);
  const calls = [];
  const toasts = [];
  const changed = [];
  const watchers = [];
  const deps = {
    date: TODAY,
    today: TODAY,
    peekCached: (key) => store.get(key) ?? null,
    cachedApi: async (_path, options) => {
      store.set(options.key, { data: current, fresh: true });
      return current;
    },
    swrInvalidate: (key) => store.delete(key),
    reducedMotion: () => reduced,
    api: async (path, init) => {
      calls.push({ path, method: init?.method, body: JSON.parse(init?.body || "null") });
      return respond ? respond(path, init) : { ok: true };
    },
    toast: (message) => toasts.push(message),
    armDelete: (btn, onConfirm) => {
      if (btn.dataset.armed) return onConfirm();
      btn.dataset.armed = "1";
    },
    watchEnrichment: (id, settled) => watchers.push({ id, settled }),
    onChanged: () => changed.push(true),
  };
  const host = createHost(win.document);
  const handle = win.CairnFuelMealsController.mount(host, deps);
  return {
    win,
    host,
    handle,
    calls,
    toasts,
    changed,
    watchers,
    setDay: (next) => {
      current = day(next);
    },
  };
}

test("opening a meal mounts the meal card; a grams edit is one PUT and the head follows", async () => {
  const saved = bowl({
    kcal: 690,
    protein_g: 97,
    ingredients: [
      { item: "Chicken breast", amount: "300 g", kcal: 495, protein_g: 93, carbs_g: 0, fat_g: 10.5, fiber_g: 0 },
      bowl().ingredients[1],
    ],
  });
  const h = harness({ respond: () => ({ id: 42, parsed: { ...saved } }) });
  await flush();
  const row = h.host.querySelector('[data-fuel-meal="42"]');
  const head = row.querySelector("[data-fuel-meals-toggle]");
  await head.click();
  assert.equal(head.getAttribute("aria-expanded"), "true");
  assert.ok(row.classList.contains("is-open"));
  const input = row.querySelector("[data-meal-card-grams]");
  assert.ok(input, "the meal card's rows are there");
  assert.equal(input.getAttribute("inputmode"), "decimal");
  input.value = "300";
  await fire(input, "input");
  assert.match(
    row.querySelector(".fuel-meal-nums").textContent,
    /^97 g protein · ~690 kcal$/,
    "the head previews the card"
  );
  await row.querySelector("[data-meal-card-save]").click();
  await flush();
  const puts = h.calls.filter((c) => c.method === "PUT");
  assert.equal(puts.length, 1);
  assert.equal(puts[0].path, "/food-notes/42");
  assert.deepEqual(Object.keys(puts[0].body), ["ingredients"]);
  assert.equal(h.changed.length, 1, "the surface is told so today's totals re-read");
  assert.equal(h.calls.filter((c) => c.path === "/chat").length, 0, "no chat message needed to correct it");
});

test("a re-read keeps an open card's node; a new meal settles in; a gone meal leaves", async () => {
  const h = harness({ reduced: false, entries: [bowl(), bowl({ id: 50, summary: "Toast", ingredients: [] })] });
  await flush();
  const open = h.host.querySelector('[data-fuel-meal="42"]');
  await open.querySelector("[data-fuel-meals-toggle]").click();
  const input = open.querySelector("[data-meal-card-grams]");
  input.value = "250";
  await fire(input, "input");

  h.setDay([bowl({ kcal: 600 }), bowl({ id: 51, summary: "Yogurt", ingredients: [] })]);
  await h.handle.refresh();
  await flush();

  assert.equal(h.host.querySelector('[data-fuel-meal="42"]'), open, "the open row kept its node");
  assert.equal(open.querySelector("[data-meal-card-grams]").value, "250", "and its unsaved grams");
  assert.equal(h.host.querySelector('[data-fuel-meal="50"]'), null, "Toast left");
  const added = h.host.querySelector('[data-fuel-meal="51"]');
  assert.ok(added.classList.contains("settle-in"), "the new meal settles in");
  assert.deepEqual(
    h.host.querySelectorAll("[data-fuel-meal]").map((el) => el.getAttribute("data-fuel-meal")),
    ["42", "51"]
  );
});

test("a still-estimating meal is watched once and re-read when it settles", async () => {
  const h = harness({ entries: [bowl({ enrichment_status: "pending", kcal: null, protein_g: null })] });
  await flush();
  assert.equal(h.watchers.length, 1);
  await h.handle.refresh();
  await flush();
  assert.equal(h.watchers.length, 1, "one watcher per note, however often it repaints");
  h.setDay([bowl()]);
  h.watchers[0].settled();
  await flush();
  assert.equal(h.host.querySelector(".fuel-meal-nums").textContent, "66 g protein · ~525 kcal");
  assert.equal(h.changed.length, 1);
});

test("an open estimating meal gets its card the moment it settles", async () => {
  const h = harness({ entries: [bowl({ enrichment_status: "pending", kcal: null, protein_g: null })] });
  await flush();
  const row = h.host.querySelector('[data-fuel-meal="42"]');
  await row.querySelector("[data-fuel-meals-toggle]").click();
  assert.equal(row.querySelector("[data-meal-card-grams]"), null);
  h.setDay([bowl()]);
  await h.handle.refresh();
  await flush();
  assert.equal(h.host.querySelector('[data-fuel-meal="42"]'), row);
  assert.ok(row.querySelector("[data-meal-card-grams]"), "the card mounted in place");
});

test("Remove takes a second tap, deletes once, and the row leaves", async () => {
  const h = harness();
  await flush();
  const row = h.host.querySelector('[data-fuel-meal="42"]');
  await row.querySelector("[data-fuel-meals-toggle]").click();
  const remove = row.querySelector("[data-fuel-meals-remove]");
  await remove.click();
  assert.equal(h.calls.length, 0, "the first tap only arms");
  await remove.click();
  await flush();
  assert.deepEqual(
    h.calls.map((c) => [c.method, c.path]),
    [["DELETE", "/food-notes/42"]]
  );
  assert.equal(h.host.querySelector('[data-fuel-meal="42"]'), null);
  assert.deepEqual(h.toasts, ["Removed"]);
  assert.equal(h.changed.length, 1);
});

test("a refused delete keeps the meal and says so", async () => {
  const h = harness({ respond: () => ({ error: "nope" }) });
  await flush();
  const row = h.host.querySelector('[data-fuel-meal="42"]');
  const remove = row.querySelector("[data-fuel-meals-remove]");
  await remove.click();
  await remove.click();
  await flush();
  assert.ok(h.host.querySelector('[data-fuel-meal="42"]'));
  assert.deepEqual(h.toasts, ["Couldn't remove that meal"]);
  assert.equal(h.changed.length, 0);
});
