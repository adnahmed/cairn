// ONE TABLE FROM A WRITE TO THE CACHES IT MAKES STALE (src/client/write-invalidation-client.ts).
//
// A chat turn applies its actions server-side, long after the POST that queued it,
// and the PWA used to drop only "plan" when it finished — so a chat-logged meal left
// Fuel, the Brief and Train painting the pre-write day from cache. These tests hold
// the table complete against the server's own action list, hold every target to a
// cache a surface actually reads, and drive the invalidation end to end.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import { CHAT_ACTION_TYPES } from "../dist/chatActions.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function load(extra = {}) {
  const dropped = [];
  let apiCleared = 0;
  const context = {
    Object,
    Set,
    Map,
    Array,
    swrInvalidate: (key) => dropped.push(key),
    apiInvalidate: () => {
      apiCleared += 1;
    },
    state: { brief: { headline: "cached" }, plan: [1] },
    ...extra,
  };
  context.globalThis = context;
  vm.runInNewContext(readFileSync(join(root, "public/js/write-invalidation-client.js"), "utf8"), context);
  return { api: context.CairnWriteInvalidation, dropped, context, apiCleared: () => apiCleared };
}

const CLIENT_SOURCE = readdirSync(join(root, "src/client"), { recursive: true })
  .filter((f) => String(f).endsWith(".ts") && !String(f).includes("write-invalidation"))
  .map((f) => readFileSync(join(root, "src/client", String(f)), "utf8"))
  .join("\n");

test("every chat action type the server can apply has a row, and no row names an unknown type", () => {
  const { api } = load();
  const table = Object.keys(api.CHAT_ACTION_TARGETS).sort();
  assert.deepEqual(table, [...CHAT_ACTION_TYPES].sort());
  for (const type of CHAT_ACTION_TYPES) {
    assert.ok(api.targetsForChatAction(type).length > 0, `${type} invalidates something`);
  }
});

test("every target is a cache some surface actually reads (or a registered snapshot)", () => {
  const { api } = load();
  const targets = new Set([
    ...Object.values(api.CHAT_ACTION_TARGETS).flat(),
    ...Object.values(api.WRITE_TARGETS).flat(),
  ]);
  for (const target of targets) {
    if (target.startsWith("@")) {
      const name = target.slice(1);
      if (name === "brief") continue; // registered by the module itself
      assert.match(CLIENT_SOURCE, new RegExp(`register\\(\\s*"${name}"`), `${target} is registered by a surface`);
      continue;
    }
    // An exact key must appear as a whole literal; a prefix as the start of one.
    const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = target.endsWith(":") ? new RegExp(`["\`]${escaped}`) : new RegExp(`["\`]${escaped}["\`]`);
    assert.match(CLIENT_SOURCE, pattern, `${target} is a key some surface caches under`);
  }
});

test("the reads each write feeds are covered: food, sets, weight, check-ins, plan, runs", () => {
  const { api } = load();
  const has = (type, ...keys) => {
    const t = api.targetsForChatAction(type);
    for (const key of keys) assert.ok(t.includes(key), `${type} drops ${key}`);
  };
  has("log_food", "food:day:", "fuel:band:", "progress:intake", "progress:energy", "today:aggregate:", "@brief");
  has("log_set", "today:session:", "stats", "history:sessions", "progress:volume", "last-set:", "@train");
  has("log_weight", "progress:weight", "stats", "profile", "fuel:band:");
  has("log_checkin", "today:aggregate:", "today:stones:", "@brief");
  has("plan_update", "plan", "plan:", "progress:program", "program:progression:", "@train");
  has("set_run", "horizon:", "@endurance", "today:aggregate:");
  has("log_activity", "@endurance", "stats", "today:session:");
  has("revert_decision", "plan", "meals:plans", "food:day:", "brain:changes");
});

test("a finished chat turn's applied list drops every mapped key once, clears api()'s tier and the Brief", () => {
  const env = load();
  const done = env.api.invalidateChatApplied([
    { type: "log_food", result: { ok: true } },
    { type: "log_weight", error: "read-back failed" },
    { type: "not_a_type" },
    null,
  ]);
  assert.ok(env.dropped.includes("food:day:"));
  assert.ok(env.dropped.includes("progress:weight"));
  assert.equal(new Set(env.dropped).size, env.dropped.length, "each key dropped once");
  assert.equal(env.apiCleared(), 1);
  assert.equal(env.context.state.brief, null);
  assert.ok(done.includes("@brief"));
});

test("nothing applied invalidates nothing", () => {
  const env = load();
  assert.equal(env.api.invalidateChatApplied([]).length, 0);
  assert.equal(env.api.invalidateChatApplied(undefined).length, 0);
  assert.equal(env.apiCleared(), 0);
  assert.deepEqual(env.dropped, []);
});

test("a registered snapshot is cleared by its @target; keep spares a target", () => {
  const env = load();
  let trainCleared = 0;
  env.api.register("train", () => {
    trainCleared += 1;
  });
  env.api.invalidateWrite("session_finish", { keep: ["@brief"] });
  assert.equal(trainCleared, 1);
  assert.deepEqual(env.context.state.brief, { headline: "cached" }, "kept");
  assert.ok(!env.dropped.includes("today:session:"), "the session key the finish just primed survives");
  assert.ok(env.dropped.includes("progress:volume"));
});

test("Undo, proposal apply and meal edits each name their caches", () => {
  const { api } = load();
  assert.ok(api.targetsForWrite("decision_revert").includes("plan"));
  assert.ok(api.targetsForWrite("proposal_apply").includes("plan:"));
  assert.ok(api.targetsForWrite("meal_edit").includes("meals:plans"));
  assert.equal(api.targetsForWrite("nope").length, 0);
});

test("the chat turn, Undo, finish, proposal apply and meal edits all route through the table", () => {
  const read = (f) => readFileSync(join(root, "src/client", f), "utf8");
  assert.match(read("chat-turn-client.ts"), /invalidateChatApplied\(applied\)/);
  assert.match(read("decision-undo-controller.ts"), /invalidateWrite\(\s*"decision_revert"/);
  assert.match(read("today-session-controller.ts"), /invalidateWrite\("session_finish"/);
  assert.match(read("coach-proposal-controller.ts"), /invalidateWrite\("proposal_apply"\)/);
  assert.match(read("chat-message-client.ts"), /invalidateWrite\("proposal_apply"\)/);
  assert.match(read("meal-swap-controller.ts"), /invalidateWrite\("meal_edit"\)/);
});
