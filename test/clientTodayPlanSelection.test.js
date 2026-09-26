import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadClient() {
  const context = {
    Array,
    Number,
    Object,
    Promise,
    Set,
    window: null,
    globalThis: null,
  };
  context.window = context;
  context.globalThis = context;
  vm.runInNewContext(readFileSync(join(root, "public/js/today-plan-selection-client.js"), "utf8"), context);
  return context.CairnTodayPlanSelection;
}

const plan = [
  { id: 11, day_number: 1, items: [{ exercise: "Squat" }, { exercise: "Bench" }] },
  { id: 12, day_number: 2, items: [{ exercise: "Deadlift" }, { exercise: "Row" }] },
  { id: 13, day_number: 3, items: [{ exercise: "Run" }] },
];

test("Today plan selection maps sessions by explicit plan day id first", () => {
  const client = loadClient();
  const session = { plan_day_id: "12", sets: [{ exercise: "Bench" }] };

  assert.equal(client.planDayNumberForSession(session, plan), 2);
});

test("Today plan selection falls back to the best exercise-name match", () => {
  const client = loadClient();
  const session = { sets: [{ exercise: "Deadlift" }, { exercise: "Row" }, { exercise: "Bench" }] };

  assert.equal(client.planDayNumberForSession(session, plan), 2);
  assert.equal(client.planDayNumberForSession({ sets: [] }, plan), null);
  assert.equal(client.planDayNumberForSession(null, plan), null);
});

test("Today plan selection falls back to movement character when exercise names differ", () => {
  const client = loadClient();
  const split = [
    { id: 11, day_number: 1, items: [{ exercise: "Lat Pulldown" }, { exercise: "Seated Cable Row" }] },
    { id: 12, day_number: 2, items: [{ exercise: "Bench Press" }, { exercise: "Overhead Press" }] },
  ];
  const session = { sets: [{ exercise: "Pull-Up" }, { exercise: "One-Arm DB Row" }, { exercise: "Hammer Curl" }] };

  assert.equal(client.planDayNumberForSession(session, split), 1);
});

test("Today plan selection wraps to the next ordered day", () => {
  const client = loadClient();
  const unsorted = [plan[2], plan[0], plan[1]];

  assert.equal(client.nextPlanDayNumber(1, unsorted), 2);
  assert.equal(client.nextPlanDayNumber(3, unsorted), 1);
  assert.equal(client.nextPlanDayNumber(99, unsorted), 1);
  assert.equal(client.nextPlanDayNumber(null, []), null);
});

test("Today plan selection uses the server-owned adaptive day unless the athlete picked/logged a day", async () => {
  const client = loadClient();
  const calls = [];
  const deps = {
    state: { logDate: "2026-07-01", plan },
    api: async (path) => {
      calls.push(path);
      return { date: "2026-07-01", plan_day_id: 13, day_number: 3, focus: "Run" };
    },
  };

  assert.equal(await client.suggestedPlanDayNumber({ sets: [{ exercise: "Run" }] }, true, deps), 3);
  assert.deepEqual(calls, []);
  assert.equal(await client.suggestedPlanDayNumber({ sets: [] }, false, deps), 1);
  assert.deepEqual(calls, []);
  assert.equal(await client.suggestedPlanDayNumber({ sets: [] }, true, deps), 3);
  assert.deepEqual(calls, ["/today-plan-day?date=2026-07-01"]);

});

// A tiny in-memory SWR tier standing in for peekCached/swrSet.
function memoryCache() {
  const rows = new Map();
  return {
    rows,
    peekCached: (key) => (rows.has(key) ? { data: rows.get(key), fresh: true } : null),
    storeCached: (key, data) => rows.set(key, data),
  };
}

test("an offline open with nothing remembered selects NO day and asks the athlete to pick — never day 1", async () => {
  const client = loadClient();
  const cache = memoryCache();
  const state = { logDate: "2026-07-01", plan };
  const failingDeps = { state, api: async () => { throw new Error("offline"); }, ...cache };
  assert.equal(await client.suggestedPlanDayNumber({ sets: [] }, true, failingDeps), null);
  assert.equal(state.planDayUnknown, true);
});

test("the server's pick is remembered per date and stands when the next open is offline or times out", async () => {
  const client = loadClient();
  const cache = memoryCache();
  const state = { logDate: "2026-07-01", plan };
  const online = { state, api: async () => ({ day_number: 2, source: "adaptive", candidates: [] }), ...cache };
  assert.equal(await client.suggestedPlanDayNumber({ sets: [] }, true, online), 2);
  assert.equal(state.planDayUnknown, false);
  assert.ok(cache.rows.has("today:plan-day:2026-07-01"), "remembered under today:plan-day:<date>");

  for (const error of [new Error("offline"), Object.assign(new Error("timeout"), { name: "AbortError" })]) {
    const offline = { state, api: async () => { throw error; }, ...cache };
    // The day a queued set is logged against: the server's own pick, not day 1.
    assert.equal(await client.suggestedPlanDayNumber({ sets: [] }, true, offline), 2, error.message);
    assert.equal(state.planDayUnknown, false);
  }

  // Another date has nothing remembered: it asks rather than borrowing yesterday's pick.
  const tomorrow = { logDate: "2026-07-02", plan };
  const offline = { state: tomorrow, api: async () => { throw new Error("offline"); }, ...cache };
  assert.equal(await client.suggestedPlanDayNumber({ sets: [] }, true, offline), null);
  assert.equal(tomorrow.planDayUnknown, true);
});

test("a remembered calendar rest/run day stays a calendar day offline", async () => {
  const client = loadClient();
  const cache = memoryCache();
  const state = { logDate: "2026-07-05", plan };
  const online = { state, api: async () => ({ day_number: null, source: "calendar", calendar: "run", candidates: [] }), ...cache };
  assert.equal(await client.suggestedPlanDayNumber({ sets: [] }, true, online), null);
  const offline = { state, api: async () => { throw new Error("offline"); }, ...cache };
  assert.equal(await client.suggestedPlanDayNumber({ sets: [] }, true, offline), null);
  assert.equal(state.planDayUnknown, false, "a calendar fact, not an unknown");
});

test("Today plan selection rejects a stale server day that is no longer in the loaded plan", async () => {
  const client = loadClient();
  const deps = {
    state: { logDate: "2026-07-01", plan },
    api: async () => ({ date: "2026-07-01", plan_day_id: 999, day_number: 9, focus: "Deleted day" }),
  };
  assert.equal(await client.suggestedPlanDayNumber({ sets: [] }, true, deps), 1);
});

test("a calendar run or rest day selects no lift — never the first plan day by default", async () => {
  const client = loadClient();
  for (const calendar of ["run", "rest"]) {
    const deps = {
      state: { logDate: "2026-07-05", plan },
      api: async () => ({ day_number: null, focus: null, source: "calendar", calendar, reason: null, candidates: [] }),
    };
    assert.equal(await client.suggestedPlanDayNumber({ sets: [] }, true, deps), null, `${calendar} day`);
  }
});
