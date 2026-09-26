// evidence-wanted (evidence-wanted-{client,controller}.ts) and the Records slot
// (records-slot.ts), docs/V2-PLAN.md wave 3. An overdue recheck or rescan surfaces
// ONCE, as evidence the team would like — one calm line, never a list or a nag — and
// "Not now" holds until the ask itself changes. The packet slot is a named mount point
// stream C registers into, so the screen never has to know the packet builder.
// Synthetic fixtures only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHost, createStorage, loadClientModule, renderHtml } from "./_dom.mjs";

function load() {
  return loadClientModule([
    "html-utils",
    "ui-actions-client",
    "evidence-wanted-client",
    "evidence-wanted-controller",
    "records-slot",
  ]);
}

function checkup(due) {
  return { lede: "", due_now: due, upcoming: [], follow_through: [], prep: {}, has_content: true, frame: "" };
}

const LAB = {
  signal_key: "recheck:synth-a",
  label: "Synthetic Marker A",
  kind: "lab",
  next_due: "2031-02-01",
  when_text: "window is open",
  why: "…",
};
const DEXA = {
  signal_key: "dexa",
  label: "DEXA body composition",
  kind: "dexa",
  next_due: "2031-03-01",
  when_text: null,
  why: "…",
};
const REVIEW = { signal_key: "review:x", label: "A review", kind: "review", next_due: null, when_text: null, why: "…" };

test("one line for the first recheck or rescan whose window is open; reviews are not evidence", () => {
  const win = load();
  const E = win.CairnEvidenceWanted;
  assert.equal(E.model(checkup([REVIEW])), null);
  assert.equal(E.model(null), null);
  const m = E.model(checkup([REVIEW, LAB, DEXA]));
  assert.equal(m.label, "Synthetic Marker A");
  assert.equal(m.key, "recheck:synth-a@2031-02-01");
  const host = renderHtml(E.lineHtml(m, { canOpen: true }), { document: win.document });
  const lines = host.querySelectorAll(".evw");
  assert.equal(lines.length, 1, "a single line, never a list");
  assert.equal(
    host.querySelector(".evw-text").textContent,
    "A fresh Synthetic Marker A reading would sharpen the team's read (window is open)."
  );
  assert.doesNotMatch(host.textContent, /overdue|must|should|urgent|\d+\s*\/\s*\d+/i, "calm words, no nag, no score");
  assert.equal(E.text(E.model(checkup([DEXA]))), "A fresh DEXA body composition scan would sharpen the team's read.");
  assert.equal(E.lineHtml(null), "");
});

test("Not now hides this ask for this viewer until the ask changes", async () => {
  const win = load();
  const storage = createStorage();
  const host = createHost(win.document);
  const opened = [];
  const deps = { checkup: checkup([LAB]), storage, onOpen: () => opened.push(1) };
  win.CairnEvidenceWantedController.mount(host, deps);
  await host.querySelector("[data-evidence-wanted-open]").click();
  assert.equal(opened.length, 1);
  await host.querySelector("[data-evidence-wanted-dismiss]").click();
  assert.equal(host.innerHTML, "", "the slot empties (and collapses)");
  win.CairnEvidenceWantedController.mount(host, deps);
  assert.equal(host.innerHTML, "", "the same ask stays quiet on the next visit");
  win.CairnEvidenceWantedController.mount(host, { ...deps, checkup: checkup([{ ...LAB, next_due: "2031-08-01" }]) });
  assert.ok(host.querySelector(".evw"), "a new due date surfaces once more");
});

test("blocked storage never breaks the line", () => {
  const win = load();
  const host = createHost(win.document);
  const throwing = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
  };
  win.CairnEvidenceWantedController.mount(host, { checkup: checkup([LAB]), storage: throwing });
  assert.ok(host.querySelector(".evw"));
  assert.equal(host.querySelector("[data-evidence-wanted-open]"), null, "no hand-off offered without one");
});

test("the packet slot mounts whatever registered into it, with the screen's deps", () => {
  const win = load();
  const S = win.CairnRecordsSlot;
  const host = createHost(win.document);
  assert.equal(S.has("packet"), false);
  assert.equal(typeof S.mount("packet", host, {}), "function", "nothing registered: a no-op teardown");
  assert.equal(host.innerHTML, "");
  const seen = [];
  let torn = 0;
  S.register("packet", (el, deps) => {
    seen.push(deps.marker);
    el.innerHTML = `<p class="packet">packet</p>`;
    return () => torn++;
  });
  assert.equal(S.has("packet"), true);
  const teardown = S.mount("packet", host, { marker: "deps" });
  assert.deepEqual(seen, ["deps"]);
  assert.ok(host.querySelector(".packet"));
  teardown();
  assert.equal(torn, 1);
  assert.equal(typeof S.mount("packet", null, {}), "function", "a missing host is a no-op");
});

test("a packet mount that throws leaves the slot empty instead of breaking the view", () => {
  const win = load();
  const host = createHost(win.document, { html: "<p>half</p>" });
  win.CairnRecordsSlot.register("packet", () => {
    throw new Error("boom");
  });
  const teardown = win.CairnRecordsSlot.mount("packet", host, {});
  assert.equal(host.innerHTML, "");
  assert.doesNotThrow(teardown);
});
