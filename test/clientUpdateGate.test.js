// A NEW SHELL NEVER RELOADS THE PAGE MID-TASK (src/client/app/update-gate.ts).
//
// sw.js skipWaiting()s + clients.claim()s, so `controllerchange` fires on an open
// page the moment a deploy's worker activates — possibly mid-set, with a sheet open
// or a sentence half typed. The gate reloads at once only when nothing is in flight
// (or the page is hidden and nothing is being typed); otherwise it shows ONE quiet
// "Updated — tap to refresh" line and reloads the next time the page is hidden.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const SOURCE = readFileSync(new URL("../public/js/app-update-gate.js", import.meta.url), "utf8");

class FakeElement {
  constructor(tag = "div") {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.attrs = {};
    this.listeners = {};
    this.classes = new Set();
    this.classList = { add: (c) => this.classes.add(c), remove: (c) => this.classes.delete(c) };
    this.isContentEditable = false;
  }
  setAttribute(k, v) {
    this.attrs[k] = v;
  }
  addEventListener(t, fn) {
    this.listeners[t] = fn;
  }
  appendChild(el) {
    this.children.push(el);
  }
}

function load(opts = {}) {
  const docListeners = {};
  const storage = new Map(Object.entries(opts.storage || {}));
  const body = new FakeElement("body");
  const document = {
    visibilityState: opts.hidden ? "hidden" : "visible",
    activeElement: opts.active || body,
    body,
    createElement: (tag) => new FakeElement(tag),
    querySelector: (sel) => {
      if (sel === ".update-line") return body.children.find((c) => c.className === "update-line") || null;
      return opts.sheet ? {} : null;
    },
    addEventListener: (t, fn) => {
      docListeners[t] = fn;
    },
    removeEventListener: (t) => {
      delete docListeners[t];
    },
  };
  const context = {
    HTMLElement: FakeElement,
    JSON,
    Object,
    Number,
    String,
    document,
    localStorage: { getItem: (k) => (storage.has(k) ? storage.get(k) : null) },
    state: { tab: opts.tab || "today" },
    CairnRestTimer: { isActive: () => !!opts.rest },
    outboxCount: () => opts.outbox || 0,
  };
  context.globalThis = context;
  vm.runInNewContext(SOURCE, context);
  let reloads = 0;
  const reload = () => {
    reloads += 1;
  };
  return { gate: context.CairnUpdateGate, document, body, docListeners, reload, reloads: () => reloads };
}

const CALM = {
  hidden: false,
  sessionActive: false,
  sheetOpen: false,
  editing: false,
  typing: false,
  restActive: false,
  draftUnsent: false,
  outboxPending: false,
};

test("the pure rule: visible and idle reloads; any task in flight defers; hidden reloads unless typing", () => {
  const { gate } = load();
  assert.equal(gate.isSafe(CALM), true);
  for (const busy of ["sessionActive", "sheetOpen", "editing", "typing", "restActive", "draftUnsent", "outboxPending"]) {
    assert.equal(gate.isSafe({ ...CALM, [busy]: true }), false, `${busy} defers a visible reload`);
  }
  assert.equal(gate.isSafe({ ...CALM, hidden: true, sessionActive: true, restActive: true, sheetOpen: true }), true);
  assert.equal(gate.isSafe({ ...CALM, hidden: true, typing: true }), false);
});

test("an idle visible page reloads at once, with no line", () => {
  const env = load();
  assert.equal(env.gate.onControllerChange(env.reload), "reloaded");
  assert.equal(env.reloads(), 1);
  assert.equal(env.body.children.length, 0);
});

for (const [label, opts] of [
  ["the Session screen", { tab: "session" }],
  ["an open sheet", { sheet: true }],
  ["a running rest timer", { rest: true }],
  ["an unsent chat draft", { storage: { "cairn.chat.draft": "had oats and" } }],
  ["an unsent food draft", { storage: { "cairn.fuelLogDraft": "2 eggs" } }],
  ["queued offline writes", { outbox: 2 }],
]) {
  test(`${label} defers the reload behind one quiet tap-to-refresh line`, () => {
    const env = load(opts);
    assert.equal(env.gate.onControllerChange(env.reload), "deferred");
    assert.equal(env.reloads(), 0);
    assert.equal(env.body.children.length, 1);
    const line = env.body.children[0];
    assert.equal(line.className, "update-line");
    assert.equal(line.textContent, "Updated — tap to refresh");
    // A second controllerchange never stacks a second line.
    env.gate.onControllerChange(env.reload);
    assert.equal(env.body.children.length, 1);
    // Tap reloads.
    line.listeners.click();
    assert.equal(env.reloads(), 1);
  });
}

test("a deferred update lands by itself once the page is hidden", () => {
  const env = load({ tab: "session" });
  env.gate.onControllerChange(env.reload);
  assert.equal(env.reloads(), 0);
  env.document.visibilityState = "hidden";
  env.docListeners.visibilitychange();
  assert.equal(env.reloads(), 1);
});

test("a hidden page with a half-typed field keeps waiting", () => {
  const input = new FakeElement("input");
  input.type = "text";
  input.value = "felt strong";
  input.defaultValue = "";
  const env = load({ active: input });
  env.gate.onControllerChange(env.reload);
  env.document.visibilityState = "hidden";
  env.docListeners.visibilitychange();
  assert.equal(env.reloads(), 0);
});

test("an empty draft key does not hold the update", () => {
  const env = load({ storage: { "cairn.chat.draft": "   " } });
  assert.equal(env.gate.onControllerChange(env.reload), "reloaded");
});

test("a navigation that needs a lazy bundle takes a deferred update instead of mixing shells", () => {
  const env = load({ tab: "session" });
  assert.equal(env.gate.reloadIfPending(), false, "nothing pending yet");
  assert.equal(env.gate.hasPending(), false);
  env.gate.onControllerChange(env.reload);
  assert.equal(env.reloads(), 0);
  assert.equal(env.gate.reloadIfPending(), true);
  assert.equal(env.reloads(), 1);
  const lazy = readFileSync(new URL("../src/client/app/lazy-bundles.ts", import.meta.url), "utf8");
  assert.match(lazy, /!bundleLoaded\(name\)\) \{/);
  assert.match(lazy, /else if \(gate\?\.reloadIfPending\?\.\(\)\)/);
  // The idle warm-up is not a safe point: it asks and stops, it never reloads.
  assert.match(lazy, /if \(warm\) \{\s*if \(gate\?\.hasPending\?\.\(\)\)/);
  assert.equal(env.gate.hasPending(), true, "a deferred update stays pending until the page reloads");
});
