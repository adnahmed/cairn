// A meal logged in chat comes back as the meal card (chat-capture-card-client.ts):
// once the capture settles, the review under the chip is the editable card, and a
// grams correction is ONE PUT to the food note — never a follow-up chat message.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHost, fire, flush, loadClientModule } from "./_dom.mjs";

function card() {
  return {
    ingredients: [
      { item: "Chicken", amount: "200 g", kcal: 330, protein_g: 62, basis: "estimated_from_foods" },
      { item: "Rice", amount: "150 g", kcal: 195, protein_g: 4, carbs_g: 43 },
    ],
    kcal: 525,
    protein_g: 66,
    carbs_g: 43,
    fat_g: null,
    fiber_g: null,
    basis: "estimated_from_foods",
    confidence: "medium",
  };
}

function captureAction(overrides = {}) {
  return {
    type: "log_food",
    result: {
      id: 42,
      enrichment_status: "done",
      food: { meal: "lunch", kcal: 525, protein_g: 66, card: card() },
      ...overrides,
    },
  };
}

function savedRow() {
  return {
    id: 42,
    meal: "lunch",
    enrichment_status: "done",
    parsed: {
      ...card(),
      kcal: 690,
      protein_g: 97,
      ingredients: [
        { item: "Chicken", amount: "300 g", kcal: 495, protein_g: 93, basis: "user_report" },
        { item: "Rice", amount: "150 g", kcal: 195, protein_g: 4, carbs_g: 43 },
      ],
    },
  };
}

function setup(globals = {}) {
  const win = loadClientModule(
    [
      "html-utils",
      "ui-actions-client",
      "meal-card-model",
      "meal-card-client",
      "meal-card-controller",
      "chat-client",
      "chat-capture-card-client",
    ],
    { globals }
  );
  const calls = [];
  const deps = {
    api: async (path, init) => {
      calls.push({ path, method: init?.method || "GET", body: JSON.parse(init?.body || "null") });
      return savedRow();
    },
    toast: () => {},
    reducedMotion: () => true,
    onSaved: (note) => win.CairnChatCaptureCard.repaintChips(note),
  };
  // A bubble as chat-message-client.ts renders it: the chip, then the review slot.
  const bubble = createHost(win.document, {
    html: `<div class="bubble-meta"><span class="bubble-tag capture-food" data-capture-note="42">✓ Lunch · 525 kcal</span></div>
      <div class="capture-review" data-capture-review="42"><div class="ing-breakdown">read-only</div></div>`,
  });
  return { win, calls, deps, bubble, review: bubble.querySelector(".capture-review") };
}

test("a settled chat capture renders as the meal card; one grams edit is one PUT and no chat message", async () => {
  const { win, calls, deps, bubble, review } = setup();
  win.CairnChatCaptureCard.mountAll(bubble, [captureAction()], deps);

  assert.equal(review.querySelector(".ing-breakdown"), null, "the read-only review is replaced");
  assert.equal(review.querySelectorAll(".meal-card-row").length, 2);
  assert.equal(review.classList.contains("capture-review-card"), true);
  assert.match(review.querySelector(".meal-card-totals").textContent, /^525 kcal · 66 g protein/);

  const grams = review.querySelector("[data-meal-card-grams]");
  grams.value = "300";
  await fire(grams, "input");
  assert.match(review.querySelector(".meal-card-totals").textContent, /^690 kcal/, "optimistic at once");
  await review.querySelector("[data-meal-card-save]").click();
  await flush();

  assert.deepEqual(
    calls.map((c) => `${c.method} ${c.path}`),
    ["PUT /food-notes/42"],
    "exactly one PUT, and nothing posted to /chat"
  );
  assert.equal(calls[0].body.ingredients[0].grams, 300);
  assert.equal(review.querySelector(".meal-card-status").textContent, "Saved");
  assert.match(bubble.querySelector(".capture-food").textContent, /690 kcal · 97g protein/, "the chip reprints");
});

test("a capture still filling in, or with no rows to edit, keeps the read-only review", () => {
  const { win, deps, bubble, review } = setup();
  win.CairnChatCaptureCard.mountAll(bubble, [captureAction({ enrichment_status: "pending" })], deps);
  assert.equal(review.querySelector(".meal-card"), null);
  win.CairnChatCaptureCard.mountAll(bubble, [captureAction({ food: { meal: "lunch", kcal: 300, card: null } })], deps);
  assert.equal(review.querySelector(".meal-card"), null);
  assert.equal(win.CairnChatCaptureCard.noteFromStamp(42, { card: { ingredients: [] } }), null);
  assert.equal(win.CairnChatCaptureCard.noteFromStamp(42, { card: null }), null);
  assert.equal(win.CairnChatCaptureCard.editable({ id: 42, parsed: { items: ["toast", "jam"] } }), false);
});

test("the live settle mounts the card with the review's settle-in motion, once", async () => {
  const { win, deps } = setup();
  const host = createHost(win.document, {
    html: `<div class="capture-review" data-capture-review="42" hidden></div>`,
  });
  const review = host.querySelector(".capture-review");
  const C = win.CairnChatCaptureCard;
  assert.equal(C.settleFromRow(review, { ...savedRow(), enrichment_status: "in_progress" }, deps), false);
  assert.equal(review.hidden, true);

  const settled = { ...savedRow(), parsed: { ...card() } };
  assert.equal(C.settleFromRow(review, settled, deps), true);
  assert.equal(review.hidden, false);
  assert.equal(review.classList.contains("settling"), true);
  const grams = review.querySelector("[data-meal-card-grams]");
  grams.value = "250";
  await fire(grams, "input");

  // An SSE re-emit of the same settled row: the card owns the review, the edit stays.
  assert.equal(C.settleFromRow(review, settled, deps), true);
  assert.equal(review.querySelector("[data-meal-card-grams]"), grams);
  assert.equal(grams.value, "250");
});

test("the chat deps refresh the intake reads and the chat fuel strip after a save", async () => {
  const invalidated = [];
  const fuel = [];
  const { win } = setup({
    api: async () => savedRow(),
    toast: () => {},
    swrInvalidate: (key) => invalidated.push(key),
    reducedMotion: () => true,
    CairnUiMotion: { expandEl: () => {}, collapseEl: (_el, done) => done() },
    state: { tab: "chat" },
    pollToken: 7,
    loadChatFuel: async (token) => fuel.push(token),
  });
  const deps = win.CairnChatCaptureCard.chatDeps();
  deps.onSaved(savedRow());
  assert.deepEqual(invalidated, ["progress:energy", "progress:intake"]);
  assert.deepEqual(fuel, [7]);
});
