// The outbox review and the access-token sheet (api-client.ts) run on the shared
// overlay primitive (CairnUiSheet). These drive the built modules against the DOM
// harness: dialog semantics, escaping, focus in / back out, and the actions.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createFakeTimers, fire, flush, loadClientModule } from "./_dom.mjs";

function loadApi({ fetch } = {}) {
  const timers = createFakeTimers();
  const toasts = [];
  const location = {
    reloaded: 0,
    reload() {
      this.reloaded += 1;
    },
  };
  const win = loadClientModule(["html-utils", "ui-sheet", "api-client"], {
    globals: {
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
      requestAnimationFrame: (fn) => fn(),
      navigator: { onLine: true, locks: { request: (_name, work) => Promise.resolve().then(work) } },
      location,
      fetch: fetch || (async () => ({ status: 200, headers: { get: () => null }, json: async () => ({ ok: true }) })),
      toast: (message) => toasts.push(message),
    },
  });
  // Drain the module's own boot-time paint/flush so only the test's timers remain.
  timers.runPending();
  return { win, doc: win.document, timers, toasts, location };
}

async function seedAttention(env, entries) {
  for (const [kind, path, body] of entries) await env.win.outboxEnqueue(kind, path, body);
  const stored = JSON.parse(env.win.localStorage.getItem("cairn.outbox.v1"));
  for (const item of stored) {
    item.state = "needs_attention";
    item.failure_status = 422;
  }
  env.win.localStorage.setItem("cairn.outbox.v1", JSON.stringify(stored));
}

test("outbox review opens as a labelled dialog, escapes saved text, and closes back to its opener", async () => {
  const env = await (async () => {
    const e = loadApi();
    await seedAttention(e, [["activity", "/activities", { text: "<b>tempo</b> run" }]]);
    return e;
  })();
  const opener = env.doc.createElement("button");
  env.doc.body.appendChild(opener);
  opener.focus();

  env.win.CairnOutbox.openReview();
  env.timers.runPending();
  const overlay = env.doc.querySelector(".outbox-review-ov");
  const dialog = overlay.querySelector(".outbox-review");
  assert.equal(dialog.localName, "section");
  assert.equal(dialog.getAttribute("role"), "dialog");
  assert.equal(dialog.getAttribute("aria-modal"), "true");
  assert.equal(dialog.getAttribute("aria-labelledby"), "outboxReviewTitle");
  assert.equal(dialog.getAttribute("aria-describedby"), "outboxReviewIntro");
  assert.equal(env.doc.activeElement, dialog.querySelector("[data-outbox-close]"), "focus lands on Close");
  assert.equal(dialog.querySelector(".outbox-review-copy b"), null, "saved text is never markup");
  assert.match(dialog.querySelector(".outbox-review-copy p").textContent, /<b>tempo<\/b> run/);
  assert.equal(opener.hasAttribute("inert"), true, "the page behind the sheet is inert");

  await fire(env.doc.activeElement, "keydown", { key: "Escape" });
  assert.equal(env.doc.querySelector(".outbox-review-ov"), null);
  assert.equal(opener.hasAttribute("inert"), false);
  assert.equal(env.doc.activeElement, opener, "focus returns to the opener");
});

test("outbox review rerenders restore focus to a remaining dialog control", async () => {
  const env = loadApi();
  await seedAttention(env, [
    ["activity", "/activities", { text: "run" }],
    ["weight", "/bodyweight", { weight_lb: 180 }],
  ]);
  env.win.CairnOutbox.openReview();
  env.timers.runPending();
  const rows = () => [...env.doc.querySelectorAll(".outbox-review-item")];
  assert.equal(rows().length, 2);

  await rows()[0].querySelector("[data-outbox-discard]").click();
  await flush();
  assert.equal(rows().length, 1, "the discarded log is gone");
  assert.equal(env.doc.activeElement, rows()[0].querySelector("[data-outbox-retry]"), "focus stays inside the dialog");

  await env.doc.querySelector("[data-outbox-close]").click();
  assert.equal(env.doc.querySelector(".outbox-review-ov"), null, "Close closes");
});

test("outbox review closes itself once nothing needs attention", async () => {
  const env = loadApi();
  await seedAttention(env, [["weight", "/bodyweight", { weight_lb: 180 }]]);
  env.win.CairnOutbox.openReview();
  env.timers.runPending();
  await env.doc.querySelector("[data-outbox-retry]").click();
  for (let i = 0; i < 5; i++) await flush();
  assert.equal(env.win.CairnOutbox.count(), 0, "the retried log was delivered");
  assert.equal(env.doc.querySelector(".outbox-review-ov"), null);
});

test("a 401 opens the access-token sheet, which only a token can leave", async () => {
  const env = loadApi({ fetch: async () => ({ status: 401, headers: { get: () => null }, json: async () => ({}) }) });
  void env.win.api("/profile");
  await flush();
  env.timers.runPending();

  const overlay = env.doc.querySelector(".token-sheet-ov");
  const dialog = overlay.querySelector(".token-sheet");
  assert.equal(dialog.getAttribute("role"), "dialog");
  assert.equal(dialog.getAttribute("aria-labelledby"), "tokenSheetTitle");
  const input = dialog.querySelector(".token-sheet-in");
  assert.equal(env.doc.activeElement, input);

  await fire(input, "keydown", { key: "Escape" });
  await overlay.click();
  assert.ok(env.doc.querySelector(".token-sheet-ov"), "Escape and the backdrop leave it open");

  await dialog.querySelector("[data-token-save]").click();
  assert.equal(dialog.querySelector(".token-sheet-err").hidden, false, "an empty token asks again");
  assert.equal(env.location.reloaded, 0);

  input.value = "  owner-token  ";
  await fire(input, "keydown", { key: "Enter" });
  assert.equal(env.win.localStorage.getItem("cairn_token"), "owner-token");
  assert.equal(env.location.reloaded, 1);
});
