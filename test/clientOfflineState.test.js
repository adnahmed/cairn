// OUT OF REACH IS NOT EMPTY (src/client/offline-state-client.ts).
//
// A read that failed because the server is out of reach used to fall through the
// same `.catch(() => null)` as a genuinely empty answer, so an offline open of Train
// said "Log a session and this becomes your training map" and Horizon said "No goal
// set yet". CairnOffline tells the two apart: network-first, last-known only when
// unreachable, and an honest unreachable state when nothing is remembered.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

function load({ api, cached = {} } = {}) {
  const stored = new Map(Object.entries(cached));
  const context = {
    Error,
    TypeError,
    Promise,
    Object,
    JSON,
    String,
    navigator: { onLine: true },
    escHtml: (v) => String(v ?? "").replaceAll("<", "&lt;").replaceAll(">", "&gt;"),
    peekCached: (key) => (stored.has(key) ? { data: stored.get(key), fresh: false } : null),
    swrSet: (key, data) => stored.set(key, data),
    api,
  };
  context.globalThis = context;
  // CairnApiError comes from api-cache.ts; load it so the classifier sees the real class.
  vm.runInNewContext(read("public/js/api-cache.js"), context);
  vm.runInNewContext(read("public/js/offline-state-client.js"), context);
  return { offline: context.CairnOffline, context, stored };
}

const apiError = (context, kind, status = null) =>
  new context.CairnApiError({ kind, method: "GET", route: "/x", status });

test("network answers win, and are remembered as the last-known read", async () => {
  const env = load({ api: async () => ({ goal: "half" }), cached: { "horizon:endurance-goal": { goal: "old" } } });
  const r = await env.offline.read("/endurance-goal", "horizon:endurance-goal");
  assert.equal(r.source, "network");
  assert.equal(r.unreachable, false);
  assert.equal(r.data.goal, "half");
  assert.equal(env.stored.get("horizon:endurance-goal").goal, "half");
});

test("unreachable with a last-known read serves it, labelled", async () => {
  let env;
  env = load({
    api: async () => {
      throw apiError(env.context, "network");
    },
    cached: { "horizon:endurance-goal": { goal: "half" } },
  });
  const r = await env.offline.read("/endurance-goal", "horizon:endurance-goal");
  assert.equal(r.source, "last-known");
  assert.equal(r.unreachable, true);
  assert.equal(r.data.goal, "half");
});

test("unreachable with nothing remembered is 'none', never a fake empty answer", async () => {
  let env;
  env = load({
    api: async () => {
      throw apiError(env.context, "timeout");
    },
  });
  const r = await env.offline.read("/endurance-goal", "horizon:endurance-goal");
  assert.deepEqual({ ...r }, { data: null, source: "none", unreachable: true });
});

test("a reachable server's error is not 'offline'", async () => {
  let env;
  env = load({
    api: async () => {
      throw apiError(env.context, "http", 500);
    },
    cached: { k: { stale: true } },
  });
  const r = await env.offline.read("/x", "k");
  assert.equal(r.unreachable, false);
  assert.equal(r.source, "none");
  assert.equal(env.offline.isUnreachable(apiError(env.context, "http", 500)), false);
  assert.equal(env.offline.isUnreachable(apiError(env.context, "network")), true);
  assert.equal(env.offline.isUnreachable(new TypeError("Failed to fetch")), true);
  assert.equal(env.offline.isUnreachable(new Error("swr-offline")), true);
});

test("the unreachable state says so, escapes its copy, and offers a retry", () => {
  const env = load();
  const html = env.offline.unreachableHtml({ title: "<b>x</b>" });
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
  assert.match(html, /data-offline-retry/);
  assert.match(env.offline.unreachableHtml(), /Can't reach Cairn right now\./);
  assert.doesNotMatch(env.offline.unreachableHtml({ retry: false }), /data-offline-retry/);
  assert.match(env.offline.lastKnownHtml(), /Last known/);
});

test("Train, Horizon race, Records and the doctor packet route their failures through CairnOffline", () => {
  const src = (f) => read(`src/client/${f}`);
  const train = src("progress-overview-client.ts");
  assert.match(train, /CairnOffline\.isUnreachable\(error\)/);
  assert.match(train, /paintTrainUnreachable\(\)/);
  assert.match(train, /if \(unreachable\) return known \? tovMarkLastKnown\(\) : paintTrainUnreachable\(\)/, "an unreachable read never lands (or re-saves) the overview");
  assert.match(src("plan-endurance-client.ts"), /CairnOffline\.read<T>/);
  assert.match(src("plan-endurance-client.ts"), /unreachable && !goalKnown/);
  assert.match(src("me-records-health-doc-controller.ts"), /CairnOffline\.isUnreachable\(error\)/);
  assert.match(src("packet-builder-controller.ts"), /CairnOffline\.isUnreachable\(error\)/);
});

test("a read that began before a write never stores its pre-write body as last-known", async () => {
  let stamp = 0;
  let release;
  let env;
  env = load({
    api: () =>
      new Promise((resolve) => {
        release = () => resolve({ goal: "pre-write" });
      }),
  });
  env.context.swrStamp = () => String(stamp);
  const pending = env.offline.read("/endurance-goal", "horizon:endurance-goal");
  // The goal changes while the read is in flight: the write stores its own truth.
  stamp += 1;
  env.stored.set("horizon:endurance-goal", { goal: "post-write" });
  release();
  const r = await pending;
  assert.equal(r.source, "network");
  assert.equal(r.data.goal, "post-write", "hands back the write's truth");
  assert.equal(env.stored.get("horizon:endurance-goal").goal, "post-write", "never overwritten");
});
