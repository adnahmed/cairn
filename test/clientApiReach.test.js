// The request layer's reachability memory (src/client/api-reach.ts, wired in
// api-core.ts): one outage is never paid for twice. A fan-in that could not reach
// Cairn fails the reads it primed without re-requesting each one (they would fail
// too), a path that just failed out of reach fails the same way for a moment, and
// index.html's failed early fetch is a network failure, never a cue to ask again.
// A fan-in answered with an HTTP error still lets each read ask for itself.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runApiClientModules } from "./_apiClientModules.mjs";

function element() {
  const classes = new Set();
  return {
    classList: {
      add: (n) => classes.add(n),
      remove: (n) => classes.delete(n),
      toggle: (n, on) => (on ? classes.add(n) : classes.delete(n)),
      contains: (n) => classes.has(n),
    },
    attrs: {},
    setAttribute(k, v) {
      this.attrs[k] = v;
    },
    removeAttribute(k) {
      delete this.attrs[k];
    },
    getAttribute(k) {
      return this.attrs[k];
    },
    appendChild: (c) => c,
    querySelector: () => null,
    addEventListener() {},
    removeEventListener() {},
    focus() {},
  };
}

function load({ now } = {}) {
  const storage = new Map();
  const calls = [];
  const context = {
    document: {
      body: { classList: element().classList, appendChild: (el) => el },
      head: { appendChild: (el) => el },
      querySelector: () => null,
      getElementById: () => null,
      createElement: () => element(),
    },
    window: { addEventListener() {}, prompt: () => "" },
    navigator: { onLine: true },
    location: { reload() {} },
    localStorage: {
      getItem: (k) => storage.get(k) || null,
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k),
    },
    Intl: { DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone: "UTC" }) }) },
    fetch: async (url) => {
      calls.push(url);
      return { status: 200, json: async () => ({ url }) };
    },
    requestAnimationFrame: (fn) => fn(),
    encodeURIComponent,
    Promise,
  };
  if (now) context.Date = { now: () => now.t };
  runApiClientModules(context);
  return { context, calls };
}

// ---------- the pure memo ----------

test("the reach memo holds a failure for its window and forgets it on clear", () => {
  const { context } = load();
  const clock = { t: 1000 };
  const memo = context.CairnApiReach.createReachMemo({ now: () => clock.t, windowMs: 1500 });
  assert.equal(memo.recent("/settings"), false);
  memo.remember("/settings");
  clock.t += 1499;
  assert.equal(memo.recent("/settings"), true);
  assert.equal(memo.recent("/profile"), false, "per path");
  clock.t += 1;
  assert.equal(memo.recent("/settings"), false, "the window passed");
  memo.remember("/settings");
  memo.clear();
  assert.equal(memo.recent("/settings"), false);
});

test("only a failed fetch() counts as out of reach — never a timeout or an answer", () => {
  const { context } = load();
  const E = context.CairnApiError;
  const { isFetchFailure } = context.CairnApiReach;
  assert.equal(isFetchFailure(new E({ kind: "network", method: "GET", route: "/x" })), true);
  assert.equal(isFetchFailure(new E({ kind: "timeout", method: "GET", route: "/x" })), false);
  assert.equal(isFetchFailure(new E({ kind: "http", method: "GET", route: "/x", status: 500 })), false);
  assert.equal(isFetchFailure({ kind: "network" }), false);
  assert.equal(isFetchFailure(undefined), false);
});

test("a prime whose source failed answers each path hit:false WITH the failure", async () => {
  const { context } = load();
  const c = context.CairnApiCache.createApiCoalescer({});
  const boom = new Error("down");
  c.prime(["/stats", "/journey"], Promise.reject(boom));
  const miss = await c.primed("/stats");
  assert.equal(miss.hit, false);
  assert.equal(miss.error, boom);
  c.prime(["/journey"], Promise.resolve({ "/stats": 1 }));
  const plain = await c.primed("/journey");
  assert.deepEqual({ ...plain }, { hit: false }, "a fan-in that answered without the path carries no error");
});

// ---------- wired into api() ----------

test("a fan-in that could not reach Cairn fails its reads without re-requesting them", async () => {
  const { context, calls } = load();
  context.fetch = async (url) => {
    calls.push(url);
    throw new TypeError("Failed to fetch");
  };
  const source = context.api("/train-home?view=overview");
  context.apiPrime(["/stats", "/journey"], source.then((v) => v.responses));
  await assert.rejects(source, /Could not reach Cairn/);
  await assert.rejects(context.api("/stats"), (e) => e instanceof context.CairnApiError && e.kind === "network");
  await assert.rejects(context.api("/journey"), /Could not reach Cairn/);
  assert.deepEqual(calls, ["/api/train-home?view=overview"], "only the fan-in touched the wire");
});

test("a failed fan-in's unasked reads fail fast only for the reach window, not the prime's", async () => {
  const now = { t: 10_000 };
  const { context, calls } = load({ now });
  let down = true;
  context.fetch = async (url) => {
    calls.push(url);
    if (down) throw new TypeError("Failed to fetch");
    return { status: 200, json: async () => ({ url }) };
  };
  const source = context.api("/train-home?view=overview");
  context.apiPrime(["/stats", "/journey"], source.then((v) => v.responses));
  await assert.rejects(source);
  await assert.rejects(context.api("/stats"), /Could not reach Cairn/);
  assert.equal(calls.length, 1, "inside the window a primed read fails without the wire");
  // The link is back 1.5 s later: a primed read nobody asked for yet asks the wire.
  now.t += 1500;
  down = false;
  assert.deepEqual(await context.api("/journey"), { url: "/api/journey" });
  assert.deepEqual(calls, ["/api/train-home?view=overview", "/api/journey"]);
});

test("a member with a remembered body still serves it when its fan-in is out of reach", async () => {
  const { context, calls } = load();
  await context.api("/journey", { swr: true }); // remembered
  context.fetch = async (url) => {
    calls.push(url);
    throw new TypeError("Failed to fetch");
  };
  const source = context.api("/train-home?view=overview");
  context.apiPrime(["/journey"], source.then((v) => v.responses));
  await source.catch(() => {});
  let refresh = null;
  const served = await context.api("/journey", { swr: { freshMs: 0, onStale: (p) => (refresh = p) } });
  assert.deepEqual(JSON.parse(JSON.stringify(served)), { url: "/api/journey" }, "the last-known body paints");
  assert.equal(await refresh, undefined, "its refresh fails without the wire");
  assert.deepEqual(calls, ["/api/journey", "/api/train-home?view=overview"]);
});

test("a fan-in Cairn answered with an error still lets each read ask for itself", async () => {
  const { context, calls } = load();
  context.fetch = async (url) => {
    calls.push(url);
    if (url.startsWith("/api/train-home")) return { status: 500, json: async () => ({ error: "boom" }) };
    return { status: 200, json: async () => ({ url }) };
  };
  const source = context.api("/train-home?view=overview");
  context.apiPrime(["/stats"], source.then((v) => v.responses));
  await source.catch(() => {});
  assert.deepEqual(await context.api("/stats"), { url: "/api/stats" });
  assert.deepEqual(calls, ["/api/train-home?view=overview", "/api/stats"]);
});

test("the same path out of reach twice in a moment touches the wire once; the window reopens it", async () => {
  const now = { t: 10_000 };
  const { context, calls } = load({ now });
  context.fetch = async (url) => {
    calls.push(url);
    throw new TypeError("Failed to fetch");
  };
  await assert.rejects(context.api("/settings"));
  await assert.rejects(context.api("/settings"), /Could not reach Cairn/);
  assert.equal(calls.length, 1);
  await assert.rejects(context.api("/profile"));
  assert.equal(calls.length, 2, "another path still asks");
  now.t += 1500; // the reach window
  await assert.rejects(context.api("/settings"));
  assert.equal(calls.length, 3, "past the window the path asks again");
  // A caller that brought its own signal is never answered from the memo.
  context.fetch = async (url) => {
    calls.push(url);
    return { status: 200, json: async () => ({ url }) };
  };
  await context.api("/profile", { signal: { addEventListener() {} } });
  assert.equal(calls.length, 4);
});

test("index.html's failed early fetch is a network failure, never a second request", async () => {
  const { context, calls } = load();
  let handed = 0;
  context.CairnTodayPrefetch = {
    // today-prefetch hands a failed early fetch over as a rejection (see its own test).
    takeEarly: (path) =>
      path === "/today?date=2026-09-26" && handed++ === 0 ? Promise.reject(new TypeError("Failed to fetch")) : undefined,
  };
  await assert.rejects(context.api("/today?date=2026-09-26"), /Could not reach Cairn/);
  assert.deepEqual(calls, [], "the early fetch already went out and failed");
  // A path with no early response is a normal fetch.
  assert.deepEqual(await context.api("/today-read?date=2026-09-26"), { url: "/api/today-read?date=2026-09-26" });
  // A live early response is used as-is.
  context.CairnTodayPrefetch = {
    takeEarly: () => Promise.resolve({ status: 200, headers: { get: () => null }, json: async () => ({ early: true }) }),
  };
  assert.deepEqual(await context.api("/daily-session/preview?date=2026-09-26"), { early: true });
  assert.equal(calls.length, 1);
});
