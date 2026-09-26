// The decision-undo component (decision-undo-client.ts + decision-undo-controller.ts):
// one button, one server revert path, one busy state and one calm refusal for
// every Undo / Hold (the affected exercise, the Today rail, the meal plan, a toast).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHost, flush, loadClientModule, renderHtml } from "./_dom.mjs";

function load() {
  return loadClientModule(["html-utils", "ui-actions-client", "decision-undo-client", "decision-undo-controller"]);
}

const COPY = {
  reason: "one-tap undo from the affected exercise",
  success: "Put back the previous plan",
  stale: "This change can no longer be undone.",
  failed: "Could not undo that change",
};

function recorder(respond = () => ({ ok: true })) {
  const calls = [];
  const toasts = [];
  return {
    calls,
    toasts,
    deps: {
      api: async (path, init) => {
        calls.push({ path, method: init?.method, body: JSON.parse(init?.body || "null") });
        return respond(path);
      },
      toast: (message, options) => toasts.push(options ? [message, options.action] : message),
    },
  };
}

test("the button carries the decision id, escaped, and prints the server's label", () => {
  const win = load();
  const html = win.CairnDecisionUndo.buttonHtml({ id: `7"><b>x`, label: "Restore previous <bench> target" });
  const host = renderHtml(html, { document: win.document });
  const button = host.querySelector("button");
  assert.equal(button.getAttribute("type"), "button");
  assert.equal(button.className, "linkbtn-quiet");
  assert.equal(button.dataset.decisionUndo, `7"><b>x`);
  assert.equal(button.textContent, "Restore previous <bench> target");
  assert.equal(host.querySelector("b"), null);
  assert.equal(
    win.CairnDecisionUndo.buttonHtml({ id: 7 }),
    `<button class="linkbtn-quiet" type="button" data-decision-undo="7">Undo</button>`,
    "no server label yet reads Undo"
  );
  assert.match(
    win.CairnDecisionUndo.buttonHtml({ id: 3, label: "Hold", attr: "meal-decision-hold" }),
    /data-meal-decision-hold="3">Hold</
  );
  assert.equal(win.CairnDecisionUndo.buttonHtml({ id: null }), "");
});

test("a tap posts the revert once, confirms, and repaints", async () => {
  const win = load();
  const host = createHost(win.document, { html: win.CairnDecisionUndo.buttonHtml({ id: 42 }) });
  const { calls, toasts, deps } = recorder();
  let repainted = 0;
  win.CairnDecisionUndoController.mount(host, deps, { "decision-undo": { ...COPY, after: () => repainted++ } });
  // Mounting again on the same host replaces the listener: one tap, one revert.
  win.CairnDecisionUndoController.mount(host, deps, { "decision-undo": { ...COPY, after: () => repainted++ } });
  const button = host.querySelector("[data-decision-undo]");
  const tap = button.click();
  await button.click();
  await tap;
  await flush();
  assert.deepEqual(calls, [
    { path: "/brain/decisions/42/revert", method: "POST", body: { reason: "one-tap undo from the affected exercise" } },
  ]);
  assert.deepEqual(toasts, ["Put back the previous plan"]);
  assert.equal(repainted, 1);
  assert.equal(button.getAttribute("aria-busy"), "true", "the tapped button stays busy until the repaint replaces it");
});

test("a refused revert says why and releases the button", async () => {
  const win = load();
  const host = createHost(win.document, { html: win.CairnDecisionUndo.buttonHtml({ id: 5 }) });
  const { toasts, deps } = recorder(() => ({ ok: false, error: "That plan has moved on." }));
  win.CairnDecisionUndoController.mount(host, deps, { "decision-undo": COPY });
  const button = host.querySelector("[data-decision-undo]");
  await button.click();
  await flush();
  assert.deepEqual(toasts, ["That plan has moved on."]);
  assert.equal(button.dataset.busy, "");
  assert.equal(button.hasAttribute("aria-busy"), false);

  const silent = recorder(() => ({ ok: false }));
  win.CairnDecisionUndoController.mount(host, silent.deps, { "decision-undo": COPY });
  await button.click();
  await flush();
  assert.deepEqual(silent.toasts, ["This change can no longer be undone."]);
});

test("an id that is not a decision never posts", async () => {
  const win = load();
  const { calls, deps } = recorder();
  for (const id of ["", "abc", "0", "-3", null]) {
    assert.equal(await win.CairnDecisionUndoController.revert(null, id, deps, COPY), false);
  }
  assert.equal(calls.length, 0);
});

test("the teardown removes the listener", async () => {
  const win = load();
  const host = createHost(win.document, { html: win.CairnDecisionUndo.buttonHtml({ id: 9 }) });
  const { calls, deps } = recorder();
  const teardown = win.CairnDecisionUndoController.mount(host, deps, { "decision-undo": COPY });
  teardown();
  await host.querySelector("[data-decision-undo]").click();
  await flush();
  assert.equal(calls.length, 0);
});

test("a toast can carry the server-labelled Undo, and a second revert of the same change waits", async () => {
  const win = load();
  let release;
  const { calls, toasts, deps } = recorder(() => new Promise((resolve) => (release = () => resolve({ ok: true }))));
  win.CairnDecisionUndoController.offer("Moved bench to 185", 11, "Restore previous bench target", deps, COPY);
  assert.deepEqual(toasts, [["Moved bench to 185", "Restore previous bench target"]]);

  const pending = win.CairnDecisionUndoController.revert(null, 11, deps, COPY);
  assert.equal(
    await win.CairnDecisionUndoController.revert(null, 11, deps, COPY),
    false,
    "the same change is already being reverted"
  );
  release();
  assert.equal(await pending, true);
  assert.equal(calls.length, 1);

  win.CairnDecisionUndoController.offer("Nothing to undo", null, "Undo", deps, COPY);
  assert.equal(toasts.at(-1), "Nothing to undo");
});
