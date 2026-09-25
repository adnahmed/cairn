// The component mount contract (docs/DESIGN.md "Component architecture", rule 4):
// `CairnUiActions.delegate` + `CairnUiActions.mount`, and the two components that
// adopted it (the Progress block card and the session primer toggle). Runs the
// built modules in a vm context over a small fake DOM that honours the
// `addEventListener` `signal` option and bubbles events from target to root.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

class FakeEl {
  constructor(tag = "div", attrs = {}) {
    this.tagName = tag.toUpperCase();
    this.attrs = new Map(Object.entries(attrs));
    this.children = [];
    this.parentElement = null;
    this.listeners = [];
    this.hidden = false;
    this.value = "";
    this.focused = false;
    const classes = new Set();
    this.classList = {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
      toggle: (c) => {
        if (classes.delete(c)) return false;
        classes.add(c);
        return true;
      },
    };
    this.dataset = new Proxy(
      {},
      {
        get: (_t, key) => this.attrs.get(`data-${String(key).replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`),
      }
    );
  }
  append(...kids) {
    for (const kid of kids) {
      kid.parentElement = this;
      this.children.push(kid);
    }
    return this;
  }
  hasAttribute(name) {
    return this.attrs.has(name);
  }
  getAttribute(name) {
    return this.attrs.has(name) ? this.attrs.get(name) : null;
  }
  setAttribute(name, value) {
    this.attrs.set(name, String(value));
  }
  matches(sel) {
    const attr = /^\[([a-z0-9-]+)\]$/.exec(sel);
    if (attr) return this.hasAttribute(attr[1]);
    const cls = /^\.([a-z0-9-]+)$/.exec(sel);
    if (cls) return this.classList.contains(cls[1]);
    throw new Error(`fake DOM: unsupported selector ${sel}`);
  }
  closest(sel) {
    for (let node = this; node; node = node.parentElement) if (node.matches(sel)) return node;
    return null;
  }
  querySelector(sel) {
    for (const kid of this.children) {
      if (kid.matches(sel)) return kid;
      const deep = kid.querySelector(sel);
      if (deep) return deep;
    }
    return null;
  }
  focus() {
    this.focused = true;
  }
  addEventListener(type, fn, opts = {}) {
    const signal = opts && typeof opts === "object" ? opts.signal : undefined;
    if (signal?.aborted) return;
    const entry = { type, fn };
    this.listeners.push(entry);
    signal?.addEventListener("abort", () => {
      this.listeners = this.listeners.filter((l) => l !== entry);
    });
  }
  removeEventListener(type, fn) {
    this.listeners = this.listeners.filter((l) => !(l.type === type && l.fn === fn));
  }
  listenerCount(type) {
    return this.listeners.filter((l) => l.type === type).length;
  }
}

/** Dispatch `type` at `target` and bubble it to the root, like a real tap. */
function fire(target, type = "click") {
  const event = {
    type,
    target,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  };
  for (let node = target; node; node = node.parentElement) {
    event.currentTarget = node;
    for (const { type: t, fn } of [...node.listeners]) if (t === type) fn(event);
  }
  return event;
}

function loadModules(...files) {
  const context = { AbortController, Error, JSON, Number, Object, String, Map, WeakMap, setTimeout, clearTimeout };
  context.globalThis = context;
  context.window = context;
  vm.runInNewContext(readFileSync(join(root, "public/js/html-utils.js"), "utf8"), context);
  for (const file of files) vm.runInNewContext(readFileSync(join(root, "public/js", file), "utf8"), context);
  return context;
}

// ---------------------------------------------------------------- the helpers

test("delegate runs the innermost action once and ignores taps on nothing", () => {
  const { CairnUiActions } = loadModules("ui-actions-client.js");
  const host = new FakeEl();
  const row = new FakeEl("div", { "data-row-open": "7" });
  const act = new FakeEl("button", { "data-row-act": "undo" });
  const label = new FakeEl("span");
  const plain = new FakeEl("p");
  act.append(label);
  row.append(act);
  host.append(row, plain);
  const calls = [];
  const remove = CairnUiActions.delegate(host, "click", {
    "row-open": (el) => calls.push(["open", el.dataset.rowOpen]),
    "row-act": (el, event) => calls.push(["act", el.dataset.rowAct, event.type]),
  });

  fire(label);
  fire(row);
  fire(plain);
  assert.deepEqual(
    calls,
    [
      ["act", "undo", "click"],
      ["open", "7"],
    ],
    "inner action wins; a plain tap runs nothing"
  );
  assert.equal(host.listenerCount("click"), 1, "one listener per event type on the host");

  remove();
  assert.equal(host.listenerCount("click"), 0, "the returned remover takes the listener off");
  fire(label);
  assert.equal(calls.length, 2);
});

test("delegate resolves a text-node target through its parent element", () => {
  const { CairnUiActions } = loadModules("ui-actions-client.js");
  const host = new FakeEl();
  const button = new FakeEl("button", { "data-go": "" });
  host.append(button);
  let hits = 0;
  CairnUiActions.delegate(host, "click", { go: () => hits++ });
  const text = { nodeType: 3, parentElement: button, listeners: [] };
  host.listeners[0].fn({ type: "click", target: text });
  assert.equal(hits, 1);
});

test("delegate refuses an action key that is not a data-attribute suffix", () => {
  const { CairnUiActions } = loadModules("ui-actions-client.js");
  assert.throws(() => CairnUiActions.delegate(new FakeEl(), "click", { "[data-x]": () => {} }), /bad action key/);
  assert.throws(() => CairnUiActions.delegate(new FakeEl(), "click", { "data-X": () => {} }), /bad action key/);
});

test("mounting twice on the same host and tapping once runs the handler exactly once", () => {
  const { CairnUiActions } = loadModules("ui-actions-client.js");
  const host = new FakeEl();
  const button = new FakeEl("button", { "data-thing-go": "" });
  host.append(button);
  let hits = 0;
  const mountThing = () =>
    CairnUiActions.mount(host, "thing", ({ delegate }) => {
      delegate("click", { "thing-go": () => hits++ });
      delegate("keydown", { "thing-go": () => hits++ });
    });

  const first = mountThing();
  const second = mountThing();
  assert.equal(host.listenerCount("click"), 1, "the re-mount tore down the first mount's listener");
  assert.equal(host.listenerCount("keydown"), 1);
  fire(button);
  assert.equal(hits, 1, "one tap, one handler run");

  first();
  assert.equal(host.listenerCount("click"), 1, "a stale teardown never removes the current mount");

  second();
  assert.equal(host.listeners.length, 0, "teardown leaves no listener on the host");
  second();
  fire(button);
  assert.equal(hits, 1, "a torn-down mount never fires again");
});

test("mounts are keyed by name too, so neighbours on one host stay wired", () => {
  const { CairnUiActions } = loadModules("ui-actions-client.js");
  const host = new FakeEl();
  const a = new FakeEl("button", { "data-a-go": "" });
  const b = new FakeEl("button", { "data-b-go": "" });
  host.append(a, b);
  const calls = [];
  CairnUiActions.mount(host, "a", ({ delegate }) => delegate("click", { "a-go": () => calls.push("a") }));
  const tearB = CairnUiActions.mount(host, "b", ({ delegate }) => delegate("click", { "b-go": () => calls.push("b") }));
  CairnUiActions.mount(host, "a", ({ delegate }) => delegate("click", { "a-go": () => calls.push("a2") }));
  fire(a);
  fire(b);
  assert.deepEqual(calls, ["a2", "b"]);
  tearB();
  fire(b);
  assert.deepEqual(calls, ["a2", "b"]);
  assert.equal(host.listenerCount("click"), 1);
});

test("mount passes its signal to wire and runs wire's cleanup on teardown and re-mount", () => {
  const { CairnUiActions } = loadModules("ui-actions-client.js");
  const host = new FakeEl();
  const log = [];
  let firstSignal = null;
  CairnUiActions.mount(host, "timer", ({ signal, host: got }) => {
    firstSignal = signal;
    assert.equal(got, host);
    return () => log.push("cleanup 1");
  });
  assert.equal(firstSignal.aborted, false);
  const teardown = CairnUiActions.mount(host, "timer", () => () => log.push("cleanup 2"));
  assert.equal(firstSignal.aborted, true, "the re-mount aborted the previous signal");
  assert.deepEqual(log, ["cleanup 1"]);
  teardown();
  teardown();
  assert.deepEqual(log, ["cleanup 1", "cleanup 2"], "cleanup runs once");
});

test("a wire that throws leaves nothing mounted", () => {
  const { CairnUiActions } = loadModules("ui-actions-client.js");
  const host = new FakeEl();
  assert.throws(
    () =>
      CairnUiActions.mount(host, "broken", ({ delegate }) => {
        delegate("click", { go: () => {} });
        throw new Error("boom");
      }),
    /boom/
  );
  assert.equal(host.listeners.length, 0);
});

test("the teardown removes the listener from a native EventTarget too", () => {
  const { CairnUiActions } = loadModules("ui-actions-client.js");
  class Host extends EventTarget {
    parentElement = null;
    hasAttribute(name) {
      return name === "data-native-go";
    }
  }
  const host = new Host();
  let hits = 0;
  CairnUiActions.mount(host, "native", ({ delegate }) => delegate("click", { "native-go": () => hits++ }));
  const teardown = CairnUiActions.mount(host, "native", ({ delegate }) =>
    delegate("click", { "native-go": () => hits++ })
  );
  host.dispatchEvent(new Event("click"));
  assert.equal(hits, 1, "the native signal removed the first mount's listener");
  teardown();
  host.dispatchEvent(new Event("click"));
  assert.equal(hits, 1);
});

// ------------------------------------------------------- Progress block card

function blockCard(id = "42") {
  const slot = new FakeEl();
  const advance = new FakeEl("button", { "data-blockadvance": id });
  const complete = new FakeEl("button", { "data-blockcomplete": id });
  slot.append(new FakeEl("div").append(advance, complete));
  return { slot, advance, complete };
}

function blockDeps(overrides = {}) {
  const calls = { api: [], toast: [], refresh: 0, armed: [] };
  const deps = {
    api: async (path, init) => {
      calls.api.push([path, init?.method, init?.body]);
      return { ok: true, id: 9 };
    },
    toast: (message) => calls.toast.push(message),
    armDelete: (button, onConfirm) => {
      calls.armed.push(button.dataset.blockcomplete);
      onConfirm();
    },
    refresh: () => calls.refresh++,
    ...overrides,
  };
  return { deps, calls };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test("the block card mounted twice advances once per tap", async () => {
  const { CairnProgressProgramBlock } = loadModules("ui-actions-client.js", "progress-program-block-client.js");
  const { slot, advance } = blockCard();
  const { deps, calls } = blockDeps();
  CairnProgressProgramBlock.mountProgramBlock(slot, deps);
  const teardown = CairnProgressProgramBlock.mountProgramBlock(slot, deps);
  assert.equal(slot.listenerCount("click"), 1);

  fire(advance);
  await settle();
  assert.deepEqual(calls.api, [["/program/blocks/42/advance", "POST", "{}"]]);
  assert.deepEqual(calls.toast, ["Moved to the next week"]);
  assert.equal(calls.refresh, 1);

  teardown();
  assert.equal(slot.listeners.length, 0);
  fire(advance);
  await settle();
  assert.equal(calls.api.length, 1);
});

test("the block card completes through the two-tap confirm and says so on a refusal", async () => {
  const { CairnProgressProgramBlock } = loadModules("ui-actions-client.js", "progress-program-block-client.js");
  const { slot, complete } = blockCard("7");
  const { deps, calls } = blockDeps({
    api: async (path) => {
      calls.api.push([path]);
      return { error: "nope" };
    },
  });
  CairnProgressProgramBlock.mountProgramBlock(slot, deps);
  fire(complete);
  await settle();
  assert.deepEqual(calls.armed, ["7"]);
  assert.deepEqual(calls.api, [["/program/blocks/7/complete"]]);
  assert.deepEqual(calls.toast, ["Couldn't update the block"]);
  assert.equal(calls.refresh, 0);
});

test("the start composer opens, then creates a block from its fields", async () => {
  const { CairnProgressProgramBlock } = loadModules("ui-actions-client.js", "progress-program-block-client.js");
  const slot = new FakeEl();
  const start = new FakeEl("button", { "data-blockstart": "" });
  const composer = new FakeEl();
  composer.classList.add("pblock-composer");
  composer.hidden = true;
  const goal = new FakeEl("input");
  goal.classList.add("pblock-goal-in");
  goal.value = "  Build squat  ";
  const focus = new FakeEl("select");
  focus.classList.add("pblock-focus-in");
  focus.value = "peak";
  const weeks = new FakeEl("input");
  weeks.classList.add("pblock-weeks-in");
  weeks.value = "6";
  const create = new FakeEl("button", { "data-blockcreate": "" });
  composer.append(goal, focus, weeks, create);
  slot.append(start, composer);
  const { deps, calls } = blockDeps();
  CairnProgressProgramBlock.mountProgramBlock(slot, deps);

  fire(start);
  assert.equal(composer.hidden, false);
  assert.equal(goal.focused, true);

  fire(create);
  await settle();
  assert.equal(calls.api.length, 1);
  const [path, method, body] = calls.api[0];
  assert.equal(path, "/program/blocks");
  assert.equal(method, "POST");
  assert.deepEqual(JSON.parse(body), { goal: "Build squat", focus: "peak", total_weeks: 6 });
  assert.deepEqual(calls.toast, ["Block started — the coach will periodize toward it"]);
  assert.equal(calls.refresh, 1);
});

// ------------------------------------------------------ session primer toggle

test("the session primer renders a toggle that the mount flips once per tap", () => {
  const ctx = loadModules("ui-actions-client.js", "session-primer-client.js");
  const html = ctx.CairnSessionPrimer.cardHtml(
    { why_today: "Recovered and due.", focus: "Lower body" },
    { collapsed: true }
  );
  assert.match(html, /data-primer\b/);
  assert.match(html, /data-primer-toggle aria-expanded="false"/);

  const slot = new FakeEl();
  const card = new FakeEl("div", { "data-primer": "" });
  card.classList.add("collapsed");
  const head = new FakeEl("button", { "data-primer-toggle": "", "aria-expanded": "false" });
  const chevron = new FakeEl("span");
  head.append(chevron);
  card.append(head);
  slot.append(card);

  ctx.CairnSessionPrimer.mountToggle(slot);
  const teardown = ctx.CairnSessionPrimer.mountToggle(slot);
  assert.equal(slot.listenerCount("click"), 1);

  fire(chevron);
  assert.equal(card.classList.contains("collapsed"), false, "one tap expands (a double listener would re-collapse)");
  assert.equal(head.getAttribute("aria-expanded"), "true");
  fire(head);
  assert.equal(card.classList.contains("collapsed"), true);
  assert.equal(head.getAttribute("aria-expanded"), "false");

  teardown();
  assert.equal(slot.listeners.length, 0);
});

test("the primer toggle is inert without the mount helper", () => {
  const ctx = loadModules("session-primer-client.js");
  const slot = new FakeEl();
  const teardown = ctx.CairnSessionPrimer.mountToggle(slot);
  assert.equal(typeof teardown, "function");
  assert.equal(slot.listeners.length, 0);
  teardown();
});
