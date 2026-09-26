// LAZY APP-SHELL BUNDLES.
//
// index.html loads only the Today / You / Fuel shell; Train, Horizon, Ask,
// Settings and Me/Health are injected on first navigation (and warmed on idle). Everything that can go wrong here
// is invisible until a user taps a tab: two <script> tags for one bundle, a
// failed fetch that permanently wedges the destination, or a token/query string
// on the url that would miss the service worker's precache entry offline.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function fakeDom() {
  const scripts = [];
  function makeScript() {
    const listeners = new Map();
    const node = {
      dataset: {},
      src: "",
      attached: false,
      addEventListener: (type, fn) => listeners.set(type, fn),
      remove() {
        node.attached = false;
        const at = scripts.indexOf(node);
        if (at >= 0) scripts.splice(at, 1);
      },
      fire: (type) => listeners.get(type)?.(),
    };
    return node;
  }
  const document = {
    createElement: () => makeScript(),
    head: {
      appendChild(node) {
        node.attached = true;
        scripts.push(node);
        return node;
      },
    },
    querySelector(selector) {
      const name = /data-cairn-bundle="([^"]+)"/.exec(selector)?.[1];
      const wantLoaded = selector.includes('data-cairn-bundle-loaded="1"');
      return (
        scripts.find((s) => s.dataset.cairnBundle === name && (!wantLoaded || s.dataset.cairnBundleLoaded === "1")) ||
        null
      );
    },
  };
  return { document, scripts };
}

function loadLoader(extra = {}) {
  const source = readFileSync(new URL("../public/js/app-lazy-bundles.js", import.meta.url), "utf8");
  const dom = fakeDom();
  const context = {
    document: dom.document,
    window: {},
    globalThis: null,
    ...extra,
  };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: "app-lazy-bundles.js" });
  return { context, ...dom };
}

const byName = (scripts, name) => scripts.find((s) => s.dataset.cairnBundle === name);

test("a bundle is injected once, with a precache-matching url", async () => {
  const env = loadLoader();
  assert.equal(typeof env.context.ensureBundle, "function");
  assert.equal(typeof env.context.window.ensureBundle, "function");

  const first = env.context.ensureBundle("ask");
  const second = env.context.ensureBundle("ask");
  assert.equal(env.scripts.length, 1, "concurrent callers share one <script>");

  const script = env.scripts[0];
  // No query string, ever: Cache Storage keys on the full url, so `?token=` would
  // miss the worker's precached CORE_ASSETS entry and break the offline first open.
  assert.equal(script.src, "/js/bundle-10-ask.js");
  assert.equal(script.dataset.cairnBundle, "ask");
  assert.equal(env.context.bundleLoaded("ask"), false);

  script.fire("load");
  await Promise.all([first, second]);

  assert.equal(env.context.bundleLoaded("ask"), true);
  await env.context.ensureBundle("ask");
  assert.equal(env.scripts.length, 1, "a loaded bundle is never re-injected");
});

test("every lazy bundle maps to its own precached url", () => {
  const env = loadLoader();
  assert.deepEqual({ ...env.context.LAZY_BUNDLE_SRC }, {
    "me-health": "/js/bundle-05-me-health.js",
    train: "/js/bundle-08-train.js",
    horizon: "/js/bundle-09-horizon.js",
    ask: "/js/bundle-10-ask.js",
    settings: "/js/bundle-11-settings.js",
  });
});

test("a bundle resolves only once its dependencies have executed too", async () => {
  const env = loadLoader();
  // Health reuses train's body-metrics figure and DEXA read.
  let done = false;
  const pending = env.context.ensureBundle("me-health").then(() => {
    done = true;
  });
  assert.deepEqual(env.scripts.map((s) => s.src).sort(), ["/js/bundle-05-me-health.js", "/js/bundle-08-train.js"]);
  byName(env.scripts, "me-health").fire("load");
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(done, false, "me-health alone is not enough");
  assert.equal(env.context.bundleLoaded("me-health"), false);
  byName(env.scripts, "train").fire("load");
  await pending;
  assert.equal(env.context.bundleLoaded("me-health"), true);
  assert.equal(env.context.bundleLoaded("train"), true);
  // Horizon shares the already-loaded train bundle: only its own tag is added.
  const horizon = env.context.ensureBundle("horizon");
  assert.equal(env.scripts.filter((s) => s.dataset.cairnBundle === "train").length, 1);
  byName(env.scripts, "horizon").fire("load");
  await horizon;
});

test("a failed load rejects and stays retryable", async () => {
  const env = loadLoader();
  const attempt = env.context.ensureBundle("settings");
  env.scripts[0].fire("error");
  await assert.rejects(attempt, /failed to load \/js\/bundle-11-settings\.js/);
  assert.equal(env.scripts.length, 0, "the dead tag is removed");

  const retry = env.context.ensureBundle("settings");
  assert.equal(env.scripts.length, 1, "a later navigation may retry");
  env.scripts[0].fire("load");
  await retry;
  assert.equal(env.context.bundleLoaded("settings"), true);
});

test("an unknown bundle name rejects instead of injecting anything", async () => {
  const env = loadLoader();
  await assert.rejects(env.context.ensureBundle("not-a-bundle"), /unknown lazy bundle/);
  await assert.rejects(env.context.ensureBundle("toString"), /unknown lazy bundle/);
  assert.equal(env.scripts.length, 0);
  assert.equal(env.context.bundleLoaded("toString"), false);
});

test("withBundle runs synchronously when warm and after the load when cold", async () => {
  const env = loadLoader();
  const calls = [];
  const cold = env.context.withBundle("train", () => {
    calls.push("cold");
    return "painted";
  });
  assert.deepEqual(calls, [], "a cold destination waits for its bundle");
  assert.equal(typeof cold.then, "function");
  env.scripts[0].fire("load");
  assert.equal(await cold, "painted");

  // Warm: the render runs inside the caller's turn (a view transition's update
  // callback paints real content, not a microtask later).
  const warm = env.context.withBundle("train", () => {
    calls.push("warm");
    return "sync";
  });
  assert.equal(warm, "sync");
  assert.deepEqual(calls, ["cold", "warm"]);
});

test("loading a bundle re-runs the boot registrations it carries", async () => {
  const calls = [];
  const env = loadLoader({
    registerAppJobReconnectors: () => {
      calls.push("register");
      return 1;
    },
    jobReconnect: async () => {
      calls.push("reconnect");
    },
  });
  const pending = env.context.ensureBundle("ask");
  assert.deepEqual(calls, [], "nothing runs before the script executes");
  env.scripts[0].fire("load");
  await pending;
  // The health_review reconnector lives on the Stand screen, so an in-flight
  // review only reattaches once that bundle has landed.
  assert.deepEqual(calls, ["register", "reconnect"]);
});

test("a bundle that registers no new reconnector costs no /agent-jobs sweep", async () => {
  const calls = [];
  const env = loadLoader({
    registerAppJobReconnectors: () => {
      calls.push("register");
      return 0;
    },
    jobReconnect: async () => {
      calls.push("reconnect");
    },
  });
  const pending = env.context.ensureBundle("settings");
  env.scripts[0].fire("load");
  await pending;
  assert.deepEqual(calls, ["register"]);
});

test("the idle warm-up executes every lazy bundle one at a time, once", async () => {
  const idle = [];
  const timers = [];
  const env = loadLoader({
    requestIdleCallback: (cb) => idle.push(cb),
    setTimeout: (cb) => timers.push(cb),
    navigator: {},
  });
  env.context.prefetchLazyBundles();
  env.context.prefetchLazyBundles(); // a second call is a no-op
  assert.equal(timers.length, 1, "the warm-up waits past the first paint");
  timers.shift()();
  const order = [];
  while (idle.length) {
    idle.shift()();
    for (const s of env.scripts) {
      if (s.dataset.cairnBundleLoaded !== "1" && !order.includes(s.dataset.cairnBundle)) {
        order.push(s.dataset.cairnBundle);
        s.fire("load");
      }
    }
    await new Promise((r) => setImmediate(r));
  }
  assert.deepEqual(order, ["train", "ask", "horizon", "me-health", "settings"]);
  assert.equal(env.scripts.length, 5, "one tag per bundle");
});

test("the idle warm-up stands down on Save-Data", () => {
  const timers = [];
  const env = loadLoader({ setTimeout: (cb) => timers.push(cb), navigator: { connection: { saveData: true } } });
  env.context.prefetchLazyBundles();
  assert.equal(timers.length, 0);
  assert.equal(env.scripts.length, 0);
});
