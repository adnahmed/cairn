// The agent sign-in modal (agent-login-modal-client.ts) on the shared overlay
// primitive: every way out (Escape, backdrop, ✕, Cancel, Try again) runs the one
// socket/terminal teardown, exactly once.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fire, loadClientModule } from "./_dom.mjs";

function load() {
  const win = loadClientModule(["html-utils", "ui-sheet", "agent-login-model-client", "agent-login-modal-client"], {
    globals: { navigator: { maxTouchPoints: 0 } },
  });
  return { win, doc: win.document, modal: win.CairnAgentLoginModal };
}

function wire(handle) {
  const log = [];
  handle.overlay._ws = { close: () => log.push("ws") };
  handle.overlay._term = { dispose: () => log.push("term") };
  return log;
}

test("the sign-in modal is a labelled dialog with the name escaped", () => {
  const { doc, modal } = load();
  const handle = modal.create(`Claude <Code>`, () => {});
  const dialog = handle.overlay.querySelector(".agent-login");
  assert.equal(handle.overlay.className, "agent-login-ov");
  assert.equal(dialog.getAttribute("role"), "dialog");
  assert.equal(dialog.getAttribute("aria-modal"), "true");
  assert.equal(dialog.getAttribute("aria-label"), "Connect Claude <Code>");
  assert.equal(dialog.querySelector("h2").textContent, "Connect Claude <Code>");
  assert.equal(doc.querySelector(".agent-login-ov"), handle.overlay);
});

for (const [way, act] of [
  ["Escape", (doc) => fire(doc.querySelector(".agent-login-x"), "keydown", { key: "Escape" })],
  ["the backdrop", (doc) => doc.querySelector(".agent-login-ov").click()],
  ["the ✕", (doc) => doc.querySelector(".agent-login-x").click()],
  ["Cancel", (doc) => doc.querySelector(".agent-login-ft [data-close]").click()],
]) {
  test(`${way} closes the modal and tears the session down once`, async () => {
    const { doc, modal } = load();
    const handle = modal.create("codex", () => {});
    const log = wire(handle);
    await act(doc);
    assert.equal(doc.querySelector(".agent-login-ov"), null);
    assert.deepEqual(log, ["ws", "term"]);
    modal.close(handle.overlay);
    assert.deepEqual(log, ["ws", "term"], "closing again is a no-op");
  });
}

test("a failed login offers Try again, which closes this modal before retrying", async () => {
  const { doc, modal } = load();
  const retried = [];
  const handle = modal.create("grok", (name) => retried.push(name));
  const log = wire(handle);
  handle.markFailed("Something went wrong.");
  assert.equal(doc.querySelector(".agent-login-status").textContent, "Something went wrong.");
  await doc.querySelector("[data-retry]").click();
  assert.deepEqual(log, ["ws", "term"]);
  assert.equal(doc.querySelector(".agent-login-ov"), null);
  assert.deepEqual(retried, ["grok"]);
});
