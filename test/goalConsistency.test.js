// One active goal. Activating a journey phase completes any stale active phase, so
// exactly one is active; and the profile goal (weight/date) and the active phase's
// target/end date can never silently disagree — goalConsistencyRead reports the
// disagreement in words and never overwrites either side.
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { db, repo, resetTables } from "./_seed.js";
import { journeyRouter } from "../dist/routes/journey.js";
import { registerJourneyTools } from "../dist/surfaces/mcp/journey.js";
import { projectCoachContext } from "../dist/prompt/context-projection.js";

beforeEach(() => {
  resetTables("journey_phases", "body_measurements", "bodyweight_log", "garmin_daily_metrics", "profile", "app_state");
});

function seedProfile(extra = {}) {
  return repo.setProfile({
    sex: "male",
    age: 40,
    height_in: 70,
    weight_lb: 180,
    goal_weight_lb: 160,
    goal_date: "2026-12-01",
    goal_mode: "lose",
    activity_factor: 1.5,
    ...extra,
  });
}

function activeIds() {
  return db
    .prepare(`SELECT id FROM journey_phases WHERE status = 'active' ORDER BY id`)
    .all()
    .map((r) => r.id);
}

// A store that already holds a stale active phase (written before the guard existed).
function insertActiveRow(kind, startDate, extra = {}) {
  const info = db
    .prepare(
      `INSERT INTO journey_phases (kind, start_date, end_date, target_weight_lb, status, source)
       VALUES (?, ?, ?, ?, 'active', 'test')`
    )
    .run(kind, startDate, extra.end_date ?? null, extra.target_weight_lb ?? null);
  return Number(info.lastInsertRowid);
}

function withServer(fn) {
  const app = express();
  app.use(express.json());
  app.use("/api", journeyRouter);
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", async () => {
      const base = `http://127.0.0.1:${server.address().port}`;
      try {
        resolve(await fn(base));
      } catch (error) {
        reject(error);
      } finally {
        server.close();
      }
    });
  });
}

function mcpTools() {
  const tools = new Map();
  registerJourneyTools({ tool: (name, _d, _s, handler) => tools.set(name, handler) });
  return async (name, args) => JSON.parse((await tools.get(name)(args)).content[0].text);
}

test("activating a phase leaves exactly one active, completing every stale one", () => {
  seedProfile();
  const staleA = insertActiveRow("cut", "2026-03-01");
  const staleB = insertActiveRow("maintenance", "2026-05-01", { end_date: "2026-05-20" });
  assert.equal(activeIds().length, 2, "precondition: a store already holding two active phases");

  const next = repo.createJourneyPhase({ kind: "cut", start_date: "2026-06-01", source: "test" });
  repo.activateJourneyPhase(next.id);

  assert.deepEqual(activeIds(), [next.id]);
  const a = repo.getJourneyPhase(staleA);
  const b = repo.getJourneyPhase(staleB);
  assert.equal(a.status, "completed");
  assert.equal(a.end_date, "2026-06-01", "an open stale phase ends where the new one starts");
  assert.equal(b.status, "completed");
  assert.equal(b.end_date, "2026-05-20", "an end date the stale phase already carried is kept");
});

test("a phase created already active goes through the same one-active rule", () => {
  seedProfile();
  const first = repo.createJourneyPhase({ kind: "cut", start_date: "2026-06-01", status: "active", source: "test" });
  assert.equal(first.status, "active");
  const second = repo.createJourneyPhase({ kind: "cut", start_date: "2026-07-01", status: "active", source: "test" });
  assert.equal(second.status, "active");

  assert.deepEqual(activeIds(), [second.id], "a create never leaves two phases active");
  assert.equal(repo.getJourneyPhase(first.id).status, "completed");
  assert.equal(repo.getJourneyPhase(first.id).end_date, "2026-07-01");
});

test("a goal that agrees with the active phase reports nothing", () => {
  seedProfile();
  // Target defaults to the profile goal; the end date is stated to match it.
  repo.activateJourneyPhase(repo.createJourneyPhase({ kind: "cut", end_date: "2026-12-01", source: "test" }).id);

  const read = repo.goalConsistencyRead();
  assert.equal(read.consistent, true);
  assert.deepEqual(read.disagreements, []);
  assert.equal(read.summary, null);
  assert.deepEqual(read.goal, { weight_lb: 160, date: "2026-12-01" });
  assert.equal(read.active_phase.kind, "cut");
  assert.equal(read.active_phase.heads_to_goal, true);
  assert.equal(read.active_phase_count, 1);
});

test("nothing to compare is not a disagreement: no phase, an open-ended phase, a goal without a date", () => {
  seedProfile({ goal_date: null });
  assert.equal(repo.goalConsistencyRead().consistent, true, "no active phase");

  repo.activateJourneyPhase(repo.createJourneyPhase({ kind: "cut", end_date: "2026-11-01", source: "test" }).id);
  assert.equal(repo.goalConsistencyRead().consistent, true, "a goal with no date says less, not something else");

  resetTables("journey_phases", "profile");
  seedProfile();
  repo.activateJourneyPhase(repo.createJourneyPhase({ kind: "cut", source: "test" }).id);
  assert.equal(repo.goalConsistencyRead().consistent, true, "an open-ended phase says less, not something else");
});

test("a disagreeing goal is reported in words, and neither side is overwritten", () => {
  seedProfile({ goal_weight_lb: 154, goal_date: "2026-11-01" });
  const phase = repo.activateJourneyPhase(
    repo.createJourneyPhase({ kind: "cut", target_weight_lb: 160, end_date: "2026-11-15", source: "test" }).id
  );

  const read = repo.goalConsistencyRead();
  assert.equal(read.consistent, false);
  const byField = Object.fromEntries(read.disagreements.map((d) => [d.field, d]));
  assert.deepEqual(Object.keys(byField).sort(), ["goal_date", "goal_weight"]);
  assert.equal(byField.goal_weight.profile_value, 154);
  assert.equal(byField.goal_weight.phase_value, 160);
  assert.equal(byField.goal_weight.words, "The profile goal is 154 lb, but the active cut phase is aiming for 160 lb.");
  assert.equal(byField.goal_date.profile_value, "2026-11-01");
  assert.equal(byField.goal_date.phase_value, "2026-11-15");
  assert.equal(
    byField.goal_date.words,
    "The profile goal date is Nov 1, 2026, but the active cut phase ends Nov 15, 2026."
  );
  assert.equal(read.summary, `${byField.goal_weight.words} ${byField.goal_date.words}`);
  assert.doesNotMatch(read.summary, /\b\d+\s*\/\s*100\b|score/i, "words, never a score");

  // A pure read: both sides stand exactly as they were written.
  assert.equal(repo.getProfile().goal_weight_lb, 154);
  assert.equal(repo.getProfile().goal_date, "2026-11-01");
  assert.equal(repo.getJourneyPhase(phase.id).target_weight_lb, 160);
  assert.equal(repo.getJourneyPhase(phase.id).end_date, "2026-11-15");
});

test("a goal date moved on the profile is reported against the phase, not copied onto it", () => {
  seedProfile();
  const phase = repo.activateJourneyPhase(
    repo.createJourneyPhase({ kind: "cut", end_date: "2026-12-01", source: "test" }).id
  );
  assert.equal(repo.goalConsistencyRead().consistent, true);

  repo.setProfile({ goal_date: "2026-10-20" });
  const read = repo.goalConsistencyRead();
  assert.deepEqual(
    read.disagreements.map((d) => d.field),
    ["goal_date"]
  );
  assert.equal(repo.getJourneyPhase(phase.id).end_date, "2026-12-01", "the phase is not silently rewritten");
});

test("a goal edit never settles an existing disagreement: an explicit phase target stands and is reported", () => {
  seedProfile({ goal_weight_lb: 154 });
  const phase = repo.activateJourneyPhase(
    repo.createJourneyPhase({ kind: "cut", target_weight_lb: 160, end_date: "2026-12-01", source: "test" }).id
  );
  assert.deepEqual(
    repo.goalConsistencyRead().disagreements.map((d) => d.field),
    ["goal_weight"]
  );

  repo.setProfile({ goal_weight_lb: 150 });
  assert.equal(repo.getJourneyPhase(phase.id).target_weight_lb, 160, "the phase is not silently rewritten");
  const read = repo.goalConsistencyRead();
  assert.deepEqual(
    read.disagreements.map((d) => [d.field, d.profile_value, d.phase_value]),
    [["goal_weight", 150, 160]]
  );
});

test("a goal edit carries a cut that was following the goal, and never a diet break's holding weight", () => {
  seedProfile({ goal_weight_lb: 154, goal_bodyfat_pct: 15 });
  const following = repo.activateJourneyPhase(
    repo.createJourneyPhase({ kind: "cut", end_date: "2026-12-01", source: "test" }).id
  );
  assert.equal(following.target_weight_lb, 154);
  repo.setProfile({ goal_weight_lb: 150 });
  assert.equal(repo.getJourneyPhase(following.id).target_weight_lb, 150, "a phase following the goal moves with it");
  assert.equal(repo.getJourneyPhase(following.id).target_bodyfat_pct, 15, "an unchanged body-fat goal is left alone");
  assert.equal(repo.goalConsistencyRead().consistent, true);

  const pause = repo.activateJourneyPhase(
    repo.createJourneyPhase({ kind: "diet_break", target_weight_lb: 170, end_date: "2026-10-10", source: "test" }).id
  );
  repo.setProfile({ goal_weight_lb: 148, goal_bodyfat_pct: 12 });
  assert.equal(
    repo.getJourneyPhase(pause.id).target_weight_lb,
    170,
    "a diet break's holding weight is never rewritten"
  );
  assert.equal(repo.getJourneyPhase(pause.id).target_bodyfat_pct, 15);
  assert.equal(repo.goalConsistencyRead().consistent, true, "a stop on the way is not a second goal");
});

test("the report reaches the coach context and the prompt DATA that carries the journey", () => {
  seedProfile({ goal_weight_lb: 154 });
  repo.activateJourneyPhase(repo.createJourneyPhase({ kind: "cut", target_weight_lb: 160, source: "test" }).id);

  const ctx = repo.getCoachContext();
  assert.ok(ctx.journey.goal_consistency.disagreements.length > 0, "getCoachContext().journey carries the report");
  assert.equal(ctx.journey.goal_consistency.disagreements[0].field, "goal_weight");
  for (const site of ["meal_plan", "chat"]) {
    const projected = projectCoachContext(ctx, site);
    assert.deepEqual(
      projected.journey?.goal_consistency?.disagreements?.map((d) => d.field),
      ["goal_weight"],
      `${site} prompt DATA carries journey.goal_consistency`
    );
  }
});

test("re-activating an older phase never ends the completed one before its own start", () => {
  seedProfile();
  const older = repo.createJourneyPhase({ kind: "cut", start_date: "2026-03-01", source: "test" });
  const newer = repo.activateJourneyPhase(
    repo.createJourneyPhase({ kind: "maintenance", start_date: "2026-06-01", source: "test" }).id
  );
  repo.activateJourneyPhase(older.id);
  const done = repo.getJourneyPhase(newer.id);
  assert.equal(done.status, "completed");
  assert.equal(done.end_date, "2026-06-01", "ends no earlier than it started");
  assert.deepEqual(activeIds(), [older.id]);
});

test("half a pound either way is the same goal", () => {
  seedProfile({ goal_weight_lb: 154 });
  repo.activateJourneyPhase(
    repo.createJourneyPhase({ kind: "cut", target_weight_lb: 154.3, end_date: "2026-12-01", source: "test" }).id
  );
  assert.equal(repo.goalConsistencyRead().consistent, true);
});

test("a maintenance or diet-break phase is a stop on the way, not a second goal", () => {
  seedProfile({ goal_weight_lb: 154 });
  repo.activateJourneyPhase(
    repo.createJourneyPhase({ kind: "diet_break", target_weight_lb: 170, end_date: "2026-10-10", source: "test" }).id
  );
  const read = repo.goalConsistencyRead();
  assert.equal(read.consistent, true);
  assert.equal(read.active_phase.heads_to_goal, false);
});

test("two phases marked active at once are reported until an activation heals it", () => {
  seedProfile();
  insertActiveRow("cut", "2026-03-01", { target_weight_lb: 160 });
  const newer = insertActiveRow("cut", "2026-06-01", { target_weight_lb: 160 });

  const read = repo.goalConsistencyRead();
  assert.equal(read.active_phase_count, 2);
  assert.equal(read.active_phase.id, newer, "the most recent active phase is the one being read");
  assert.deepEqual(
    read.disagreements.map((d) => d.field),
    ["active_phases"]
  );
  assert.match(read.summary, /^2 journey phases are marked active at once/);
  assert.deepEqual(activeIds().length, 2, "the read never heals by writing");

  repo.activateJourneyPhase(newer);
  assert.equal(repo.goalConsistencyRead().consistent, true);
});

test("the journey read, its REST route and its MCP tool all carry the same report", async () => {
  seedProfile({ goal_weight_lb: 154 });
  repo.activateJourneyPhase(repo.createJourneyPhase({ kind: "cut", target_weight_lb: 160, source: "test" }).id);
  const direct = repo.goalConsistencyRead();
  assert.equal(direct.consistent, false);

  assert.deepEqual(repo.journeyRead().goal_consistency, direct);

  const rest = await withServer(async (base) => {
    const res = await fetch(`${base}/api/journey/goal-consistency`);
    assert.equal(res.status, 200);
    return res.json();
  });
  assert.deepEqual(rest, direct);

  const call = mcpTools();
  assert.deepEqual(await call("get_journey_goal_consistency", {}), direct);
});
