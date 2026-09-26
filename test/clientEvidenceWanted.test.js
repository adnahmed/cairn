// evidence-wanted (evidence-wanted-{client,controller}.ts) and the Records slot
// (records-slot.ts), docs/V2-PLAN.md wave 3. An overdue recheck or rescan surfaces
// ONCE, as evidence the team would like — one calm line, never a list or a nag — and
// "Not now" holds until the ask itself changes. The line is the SERVER's
// (GET /api/health/evidence-wanted): the renderer prints it and composes no words. The
// packet slot is a named mount point stream C registers into, so the screen never has to
// know the packet builder. Synthetic fixtures only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHost, createStorage, flush, loadClientModule, renderHtml } from "./_dom.mjs";

function load() {
  return loadClientModule([
    "html-utils",
    "ui-actions-client",
    "evidence-wanted-client",
    "evidence-wanted-controller",
    "records-slot",
  ]);
}

// The real ClientEvidenceWantedRead shape (src/contracts/health-records.ts), synthetic content.
function read(item) {
  return { as_of: "2031-03-02", item, frame: "Synthetic frame." };
}
const LINE =
  "When it suits you, a recheck of synthetic marker A would help the team — the last one is from Jan 5, 2031.";
const ITEM = { key: "panel:synth", kind: "recheck", label: "Synthetic Marker A", line: LINE, since: "2031-01-05" };

// A controller harness over SWR: `peek` is the warm cache, `answer` what the revalidate returns.
function mountWith(win, { peek = null, answer = read(ITEM), storage = createStorage(), onOpen } = {}) {
  const host = createHost(win.document);
  const reads = [];
  const deps = {
    peekCached: (key) => {
      reads.push(["peek", key]);
      return peek ? { data: peek } : null;
    },
    cachedApi: async (path, opts) => {
      reads.push(["get", path, opts?.key]);
      if (answer instanceof Error) throw answer;
      return answer;
    },
    storage,
    onOpen,
  };
  const teardown = win.CairnEvidenceWantedController.mount(host, deps);
  return { host, reads, deps, teardown };
}

test("the line is the server's own sentence, printed as is — the renderer composes no words", () => {
  const win = load();
  const E = win.CairnEvidenceWanted;
  const m = E.model(read(ITEM));
  assert.equal(m.line, LINE);
  assert.equal(m.key, "panel:synth@2031-01-05", "the ask is the evidence plus the reading it would refresh");
  assert.equal(m.kind, "recheck");
  const host = renderHtml(E.lineHtml(m, { canOpen: true }), { document: win.document });
  assert.equal(host.querySelectorAll(".evw").length, 1, "a single line, never a list");
  assert.equal(host.querySelector(".evw-text").textContent, LINE, "exactly the server's words");
  assert.doesNotMatch(host.textContent, /overdue|must|should|urgent|\d+\s*\/\s*100/i, "calm words, no nag, no score");
  assert.equal(typeof E.text, "undefined", "no client-side wording helper left to drift");
  // Hostile text stays text.
  const hostile = renderHtml(E.lineHtml(E.model(read({ ...ITEM, line: "<b>x</b>" }))), { document: win.document });
  assert.equal(hostile.querySelector("b"), null);
  assert.equal(hostile.querySelector(".evw-text").textContent, "<b>x</b>");
});

test("nothing wanted, or a read that is not the server's, paints nothing", () => {
  const win = load();
  const E = win.CairnEvidenceWanted;
  assert.equal(E.model(read(null)), null);
  assert.equal(E.model(null), null);
  assert.equal(
    E.model({ due_now: [{ kind: "lab", label: "Synthetic" }] }),
    null,
    "the next-checkup read is not this line"
  );
  assert.equal(E.model(read({ ...ITEM, line: "" })), null);
  assert.equal(E.lineHtml(null), "");
});

test("a warm peek paints at once; the read always revalidates and a new answer repaints", async () => {
  const win = load();
  const next = { ...ITEM, key: "rescan:body", kind: "rescan", line: "Synthetic rescan line.", since: null };
  const h = mountWith(win, { peek: read(ITEM), answer: read(next), onOpen: () => {} });
  assert.equal(h.host.querySelector(".evw-text").textContent, LINE, "the warm line, before any network");
  await flush();
  assert.deepEqual(
    h.reads.filter((r) => r[0] === "get"),
    [["get", "/health/evidence-wanted", "health:evidence-wanted"]]
  );
  assert.equal(h.host.querySelector(".evw-text").textContent, "Synthetic rescan line.");
  const cold = mountWith(win, { answer: read(null) });
  await flush();
  assert.equal(cold.host.innerHTML, "", "nothing wanted: the slot collapses");
  const failed = mountWith(win, { answer: new Error("offline") });
  await flush();
  assert.equal(failed.host.innerHTML, "", "a failed read is quiet, never an error line");
});

test("Not now hides this ask for this viewer until the ask changes", async () => {
  const win = load();
  const storage = createStorage();
  const opened = [];
  const first = mountWith(win, { storage, onOpen: () => opened.push(1) });
  await flush();
  await first.host.querySelector("[data-evidence-wanted-open]").click();
  assert.equal(opened.length, 1);
  await first.host.querySelector("[data-evidence-wanted-dismiss]").click();
  assert.equal(first.host.innerHTML, "", "the slot empties (and collapses)");
  const again = mountWith(win, { storage });
  await flush();
  assert.equal(again.host.innerHTML, "", "the same ask stays quiet on the next visit");
  const fresher = mountWith(win, { storage, answer: read({ ...ITEM, since: "2031-02-20" }) });
  await flush();
  assert.ok(fresher.host.querySelector(".evw"), "a fresh reading behind the ask surfaces it once more");
});

test("blocked storage never breaks the line", async () => {
  const win = load();
  const throwing = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
  };
  const h = mountWith(win, { storage: throwing });
  await flush();
  assert.ok(h.host.querySelector(".evw"));
  assert.equal(h.host.querySelector("[data-evidence-wanted-open]"), null, "no hand-off offered without one");
  await h.host.querySelector("[data-evidence-wanted-dismiss]").click();
  assert.equal(h.host.innerHTML, "");
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
