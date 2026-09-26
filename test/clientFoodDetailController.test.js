// The food detail sheet (food-detail-controller.ts): hero, macro bars, removal, and
// the meal card mounted over the note's ingredient rows (a correction is one PUT, no
// chat message). Runs the built modules on the shared DOM harness.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHost, fire, flush, loadClientModule } from "./_dom.mjs";

function loadController() {
  const win = loadClientModule([
    "html-utils",
    "ui-actions-client",
    "meal-card-model",
    "meal-card-client",
    "meal-card-controller",
    "food-detail-controller",
  ]);
  return { context: win, document: win.document };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function foodDeps(document, overrides = {}) {
  const requests = [];
  const toasts = [];
  const countUps = [];
  const invalidated = [];
  let mounted = null;
  let closed = 0;
  let wired = 0;
  const deps = {
    state: { _goal: null },
    api: async (path, opts) => {
      requests.push({ path, opts });
      if (overrides.api) return overrides.api(path, opts);
      if (path === "/goal") return { recommended: { target_intake_kcal: 2000 } };
      if (path === "/food-notes/42") return { ok: true };
      return {};
    },
    art: () => "<svg></svg>",
    artEnabled: () => true,
    artImg: (_kind, query) => `<img alt="${escapeHtml(query)}">`,
    closeDetail: () => {
      closed += 1;
    },
    escapeHtml,
    foodNote: {
      foodIngredients: (parsed) => parsed?.ingredients || [],
      ingredientLabel: (ingredient) => `${ingredient.amount || ""} ${ingredient.item || ""}`.trim(),
      foodItemsText: () => "",
      foodMacroText: (row) => `${row.kcal || 0} cal`,
      foodTitleFromIngredients: () => "Ingredient meal",
      parsedNote: (row) => row.parsed || null,
      noteEntryInner: (note) => `<span class="fn-macros">${escapeHtml(note.parsed?.kcal)} kcal</span>`,
    },
    foodNum: (value) => {
      const number = Number(value);
      return Number.isFinite(number) ? number : null;
    },
    formatFoodNum: (value) => String(value),
    mountDetail: (html, photoSrc) => {
      mounted = createHost(document, { html });
      mounted.photoSrc = photoSrc;
      return mounted;
    },
    openDetailFrom: (_fromEl, build) => build(),
    runCountUps: (el) => countUps.push(el),
    toast: (message) => toasts.push(message),
    wireDetailCommon: () => {
      wired += 1;
    },
    withToken: (path) => `/token${path}`,
    expandEl: () => {},
    collapseEl: (_el, done) => done(),
    reducedMotion: () => true,
    swrInvalidate: (key) => invalidated.push(key),
  };
  return {
    deps,
    requests,
    toasts,
    countUps,
    invalidated,
    get mounted() {
      return mounted;
    },
    get closed() {
      return closed;
    },
    get wired() {
      return wired;
    },
  };
}

function logEntry(document, id = "42") {
  return createHost(document, { html: `<div class="fnent" data-noteid="${id}">old</div>` }).querySelector(".fnent");
}

test("food detail controller renders macros, goal context, and removes the note", async () => {
  const { context, document } = loadController();
  logEntry(document);
  const harness = foodDeps(document);

  await context.CairnFoodDetailController.openFoodDetail(
    {
      id: 42,
      raw: "2 eggs <toast>",
      created_at: "2026-06-30T12:30:00Z",
      parsed: {
        summary: "Eggs <toast>",
        kcal: 500,
        protein_g: 32,
        carbs_g: 30,
        fat_g: 18,
        ingredients: [{ item: "Eggs <large>", amount: "2", kcal: 180 }],
        notes: "estimated <photo>",
      },
    },
    null,
    harness.deps
  );

  const el = harness.mounted;
  assert.equal(harness.requests[0].path, "/goal");
  assert.equal(el.querySelector(".detail-title").textContent, "Eggs <toast>");
  assert.equal(el.querySelector(".detail-ctx").textContent, "25% of the day · 12:30");
  assert.equal(el.querySelector(".meal-card-item").textContent, "Eggs <large>", "the items are the meal card");
  assert.equal(el.querySelector("b, large, toast"), null);
  assert.equal(el.querySelector(".fdet-note").textContent, "estimated <photo>");
  assert.match(el.photoSrc, /\/token\/api\/art\?kind=food/);
  assert.equal(harness.countUps[0], el);
  assert.equal(harness.wired, 1);

  await el.querySelector("[data-remove]").click();
  assert.equal(harness.requests.at(-1).path, "/food-notes/42");
  assert.equal(harness.requests.at(-1).opts.method, "DELETE");
  assert.equal(document.querySelector('.fnent[data-noteid="42"]'), null);
  assert.equal(harness.closed, 1);
  assert.equal(harness.toasts.at(-1), "Removed");
});

test("food detail macro bars are sized by energy contribution, not raw grams", async () => {
  const { context, document } = loadController();
  const harness = foodDeps(document);

  // Fat 20g (180 kcal) outweighs carbs 30g (120 kcal) energy-wise despite fewer grams —
  // a gram-based bar would render carbs wider; an energy-based bar must render fat wider.
  await context.CairnFoodDetailController.openFoodDetail(
    {
      id: 42,
      raw: "chicken and rice",
      created_at: "2026-06-30T12:30:00Z",
      parsed: { summary: "Chicken and rice", kcal: 500, protein_g: 25, carbs_g: 30, fat_g: 20, fiber_g: 5 },
    },
    null,
    harness.deps
  );

  const bars = harness.mounted.querySelectorAll(".macrobar").map((bar) => ({
    label: bar.querySelector(".lbl").textContent,
    val: bar.querySelector(".macrobar-val").textContent,
    width: Number(/width:(\d+)%/.exec(bar.querySelector(".macrobar-fill").getAttribute("style"))[1]),
  }));
  assert.deepEqual(
    bars.map((b) => b.label),
    ["Protein", "Carbs", "Fat", "Fiber"]
  );

  const carbs = bars.find((b) => b.label === "Carbs");
  const fat = bars.find((b) => b.label === "Fat");
  assert.equal(carbs.val, "30g");
  assert.equal(fat.val, "20g");
  assert.ok(fat.width > carbs.width, `expected fat bar (${fat.width}%) wider than carbs bar (${carbs.width}%)`);

  // Fat is the top energy contributor (180 kcal of protein 100 / carbs 120 / fat 180 / fiber 10), so it fills 100%.
  assert.equal(fat.width, 100);
  assert.equal(carbs.width, Math.round((120 / 180) * 100));
  assert.equal(harness.mounted.querySelector("[data-fdet-meal]"), null, "no ingredient rows, no meal card");
});

test("a note with only an items list keeps its read-only line", async () => {
  const { context, document } = loadController();
  const harness = foodDeps(document);
  harness.deps.foodNote.foodItemsText = () => "toast, jam";
  await context.CairnFoodDetailController.openFoodDetail(
    {
      id: 42,
      raw: "toast",
      parsed: { summary: "Toast", kcal: 250, items: ["toast", "jam"] },
    },
    null,
    harness.deps
  );
  assert.equal(harness.mounted.querySelector(".detail-items").textContent, "toast, jam");
  assert.equal(harness.mounted.querySelector(".meal-card"), null);
});

test("correcting grams in the sheet: the hero follows at once, one PUT, then the server's totals", async () => {
  const { context, document } = loadController();
  const entry = logEntry(document);
  const saved = {
    id: 42,
    parsed: {
      kcal: 700,
      protein_g: 70,
      carbs_g: 40,
      fat_g: 20,
      ingredients: [
        { item: "Chicken", amount: "300 g", kcal: 495, protein_g: 93 },
        { item: "Rice", amount: "150 g", kcal: 195, protein_g: 4, carbs_g: 43 },
      ],
    },
  };
  const harness = foodDeps(document, {
    api: (path, opts) =>
      path === "/goal" ? { recommended: { target_intake_kcal: 2000 } } : opts?.method === "PUT" ? saved : {},
  });
  await context.CairnFoodDetailController.openFoodDetail(
    {
      id: 42,
      raw: "chicken and rice",
      created_at: "2026-06-30T12:30:00Z",
      parsed: {
        summary: "Chicken and rice",
        kcal: 525,
        protein_g: 66,
        carbs_g: 43,
        fat_g: 8,
        ingredients: [
          { item: "Chicken", amount: "200 g", kcal: 330, protein_g: 62 },
          { item: "Rice", amount: "150 g", kcal: 195, protein_g: 4, carbs_g: 43 },
        ],
      },
    },
    null,
    harness.deps
  );

  const el = harness.mounted;
  assert.equal(el.querySelectorAll(".meal-card-row").length, 2);
  assert.equal(el.querySelector(".meal-card-totals"), null, "the sheet's hero carries the totals");
  assert.equal(el.querySelector(".detail-items"), null, "the card replaces the comma list");

  const grams = el.querySelector("[data-meal-card-grams]");
  grams.value = "300";
  await fire(grams, "input");
  assert.equal(el.querySelector(".detail-num").textContent, "690", "optimistic: 525 + 165");
  assert.equal(el.querySelector(".detail-ctx").textContent, "35% of the day · 12:30");
  const puts = () => harness.requests.filter((r) => r.opts?.method === "PUT");
  assert.equal(puts().length, 0);

  await el.querySelector("[data-meal-card-save]").click();
  await flush();
  assert.equal(puts().length, 1);
  assert.equal(puts()[0].path, "/food-notes/42");
  assert.equal(JSON.parse(puts()[0].opts.body).ingredients[0].amount, "300 g");
  assert.equal(el.querySelector(".detail-num").textContent, "700", "the server's total");
  assert.equal(
    el
      .querySelectorAll(".macrobar-val")
      .map((v) => v.textContent)
      .join(" "),
    "70g 40g 20g",
    "the bars reprint from the saved totals"
  );
  assert.equal(entry.querySelector(".fn-macros").textContent, "700 kcal", "the log card reprints");
  assert.deepEqual([...harness.invalidated], ["progress:energy", "progress:intake"]);
  assert.equal(harness.toasts.length, 0);
});
