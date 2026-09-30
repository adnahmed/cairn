// The "challenge me" round (owner, 2026-09-29): eight new bests in a week, and every
// anchor lift on the card read HOLD. Each case below is a live exposure shape, run
// through the real write path (a composed card, logged sets, reconcileDailySession)
// and then the progression engine, so a stored verdict and the read that consumes it
// are exercised together.
//
//   - one set short, every working set past the top of the range  → the step lands
//   - a heavier set at fewer reps than a lighter card               → met, not short
//   - a plan written onto the load the log just lifted              → tested, not untested
//   - reps past the ceiling are reserve                             → not a grind
//   - a surplus buys a bigger (bounded) step
//   - one bodyweight set on a loaded lift never reads as its best   → not "sliding"
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { db, isoDaysAgo, repo } from "./_seed.js";
import { reconcileDailySession } from "../dist/repo/daily-reconciliation.js";
import { nextPrescription } from "../dist/repo/progression.js";
import { getProgramState } from "../dist/repo/program-state.js";
import { cappedShortOfSets, doseChallengeVerdict, setMeetsPrescription } from "../dist/repo/outcome-comparability.js";
import { exposurePerformedPrescription } from "../dist/repo/prescription-authorship.js";

function reset() {
  for (const t of [
    "daily_session_outcomes",
    "daily_session_compositions",
    "logged_sets",
    "plan_items",
    "plan_days",
    "sessions",
    "exercises",
    "program_blocks",
    "plan_proposals",
  ]) {
    try {
      db.prepare(`DELETE FROM ${t}`).run();
    } catch {
      /* table may not exist */
    }
  }
}
beforeEach(reset);

function makeExercise(name, muscle_group) {
  repo.upsertExercise({ name, muscle_group, mode: "reps" });
}

// An established slot (stamped well before the logs) unless a stamp is given.
function planSlot(item, { stampDaysAgo = 120 } = {}) {
  const day = repo.savePlanDay(1, item.focus ?? "Day", item.focus ?? null, [item]);
  db.prepare(`UPDATE plan_items SET prescribed_at = ? WHERE plan_day_id = ?`).run(isoDaysAgo(stampDaysAgo), day.id);
}

function logSets(name, daysAgo, sets) {
  const ex = repo.findExercise(name);
  const session = repo.getOrCreateSession(isoDaysAgo(daysAgo), null);
  sets.forEach(([weight, reps, rir], i) =>
    db
      .prepare(
        `INSERT INTO logged_sets (session_id, exercise_id, set_number, weight, reps, rir) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(session.id, ex.id, i + 1, weight, reps, rir ?? null)
  );
  return session.id;
}

// The day's composed card for one lift, the logged sets under it, the session finished
// and reconciled through the real write path.
function composedSession(name, daysAgo, card, sets) {
  const sessionId = logSets(name, daysAgo, sets);
  const date = isoDaysAgo(daysAgo);
  const items = [{ position: 0, kind: "strength", exercise: name, mode: "reps", ...card }];
  db.prepare(
    `INSERT INTO daily_session_compositions
      (version, session_id, date, source, status, title, items_json, request_fingerprint)
     VALUES (1, ?, ?, 'adaptive_plan', 'active', 'Live fixture', ?, ?)`
  ).run(sessionId, date, JSON.stringify(items), `live-${sessionId}-${Math.random()}`);
  db.prepare(`UPDATE sessions SET finished_at = datetime('now') WHERE id = ?`).run(sessionId);
  const outcome = reconcileDailySession(sessionId);
  assert.ok(outcome, "the session reconciles against its card");
  return outcome;
}

const NO_BRAKES = { autoreg: null, acute: null };

test("pure: a heavier set at fewer reps meets a lighter card; one set short past the top is the load's answer", () => {
  const card = { sets: 2, rep_low: 8, rep_high: 10, target_weight: 164, target_seconds: null };
  assert.equal(
    setMeetsPrescription({ weight: 185, reps: 7, duration_sec: null }, card),
    true,
    "185 × 7 out-lifts 164 × 8"
  );
  assert.equal(
    setMeetsPrescription({ weight: 185, reps: 3, duration_sec: null }, card),
    false,
    "a heavy triple is not the card's work"
  );
  assert.equal(setMeetsPrescription({ weight: 135, reps: 10, duration_sec: null }, card), false, "a back-off is not");
  const achieved = {
    sets: 4,
    top_weight: 185,
    top_reps: 10,
    top_seconds: null,
    sets_detail: [
      { weight: 155, reps: 10, duration_sec: null },
      { weight: 185, reps: 7, duration_sec: null },
      { weight: 185, reps: 5, duration_sec: null },
      { weight: 135, reps: 10, duration_sec: null },
    ],
  };
  assert.equal(doseChallengeVerdict(card, achieved), "exceeded");

  const deadlift = { sets: 3, rep_low: 5, rep_high: 6, target_weight: 225, target_seconds: null };
  const detail = (rows) => ({
    sets: rows.length,
    top_weight: 225,
    top_reps: Math.max(...rows.map((r) => r[1])),
    top_seconds: null,
    sets_detail: rows.map(([weight, reps]) => ({ weight, reps, duration_sec: null })),
  });
  assert.equal(
    cappedShortOfSets(
      deadlift,
      detail([
        [135, 10],
        [225, 6],
        [225, 8],
      ])
    ),
    true
  );
  assert.equal(
    cappedShortOfSets(
      deadlift,
      detail([
        [225, 6],
        [225, 6],
      ])
    ),
    false,
    "capped but no overshoot"
  );
  assert.equal(
    cappedShortOfSets(
      deadlift,
      detail([
        [225, 8],
        [225, 5],
      ])
    ),
    false,
    "a set short of the top"
  );
  assert.equal(
    cappedShortOfSets(
      deadlift,
      detail([
        [135, 10],
        [225, 8],
      ])
    ),
    false,
    "two sets short"
  );
  assert.equal(
    cappedShortOfSets(
      deadlift,
      detail([
        [225, 6],
        [225, 6],
        [225, 8],
      ])
    ),
    false,
    "the whole card is not short"
  );
});

test("pure: a prescription is performed only AT its written load", () => {
  const rx = { weight: 80, rep_low: 8, sets: 3 };
  assert.equal(
    exposurePerformedPrescription(
      [
        { weight: 80, reps: 10 },
        { weight: 80, reps: 10 },
      ],
      rx
    ),
    true
  );
  assert.equal(exposurePerformedPrescription([{ weight: 80, reps: 10 }], rx), false, "one set is not a session");
  assert.equal(
    exposurePerformedPrescription(
      [
        { weight: 85, reps: 10 },
        { weight: 85, reps: 10 },
      ],
      rx
    ),
    false,
    "heavier is a plan written under the log"
  );
  assert.equal(
    exposurePerformedPrescription(
      [
        { weight: 80, reps: 7 },
        { weight: 80, reps: 7 },
      ],
      rx
    ),
    false,
    "under the floor"
  );
});

test("deadlift: 225 × 6, 225 × 8 at RIR 2 against 3 × 5–6 @ 225 steps the load — a missing third set is volume", () => {
  makeExercise("Barbell Deadlift", "hamstrings");
  planSlot({ exercise: "Barbell Deadlift", sets: 3, rep_low: 5, rep_high: 6, target_weight: 225, focus: "Lower B" });
  logSets("Barbell Deadlift", 15, [
    [135, 10, 10],
    [205, 10, 2],
    [205, 10, 2],
  ]);
  logSets("Barbell Deadlift", 8, [
    [135, 10, 10],
    [205, 10, 3],
    [205, 10, 3],
  ]);
  const outcome = composedSession("Barbell Deadlift", 4, { sets: 3, rep_low: 5, rep_high: 6, target_weight: 225 }, [
    [135, 10, 10],
    [225, 6, 2],
    [225, 8, 2],
  ]);
  const dose = outcome.facts.dose_evidence.find((d) => d.exercise === "Barbell Deadlift");
  assert.equal(dose.challenge_verdict, "under_prescribed", "the stored verdict still says the card was one set short");

  const p = nextPrescription("Barbell Deadlift", undefined, NO_BRAKES);
  assert.equal(p.dose_eligibility.reason, "capped_short_set");
  assert.equal(p.action, "overload", p.why);
  // 225 × 8 supports ~237 for six: two notches, on the 5 lb grid.
  assert.equal(p.suggested.weight, 235);
});

test("deadlift: short AND not past the top still holds — the rule needs the overshoot", () => {
  makeExercise("Barbell Deadlift", "hamstrings");
  planSlot({ exercise: "Barbell Deadlift", sets: 3, rep_low: 5, rep_high: 6, target_weight: 225, focus: "Lower B" });
  logSets("Barbell Deadlift", 12, [
    [205, 10, 2],
    [205, 10, 2],
    [205, 10, 2],
  ]);
  composedSession("Barbell Deadlift", 4, { sets: 3, rep_low: 5, rep_high: 6, target_weight: 225 }, [
    [135, 10, 10],
    [225, 6, 2],
    [225, 5, 1],
  ]);
  const p = nextPrescription("Barbell Deadlift", undefined, NO_BRAKES);
  assert.notEqual(p.dose_eligibility.reason, "capped_short_set");
  assert.equal(p.action, "hold");
  assert.equal(p.suggested.weight, 225);
});

test("squat: 185 × 7 at RIR 4 on a 164 × 8–10 card is harder work; the plan written onto 185 is tested by it", () => {
  repo.setSettings({ training_drive: "push" });
  makeExercise("Back Squat", "quads");
  planSlot({ exercise: "Back Squat", sets: 2, rep_low: 8, rep_high: 10, target_weight: 164, focus: "Lower A" });
  logSets("Back Squat", 30, [
    [135, 10, 4],
    [175, 10, 2],
    [175, 10, 2],
  ]);
  logSets("Back Squat", 22, [
    [135, 10, 5],
    [185, 8, 2],
    [205, 5, 2],
  ]);
  const outcome = composedSession("Back Squat", 15, { sets: 2, rep_low: 8, rep_high: 10, target_weight: 164 }, [
    [155, 10, 2],
    [185, 7, 4],
    [185, 5, 5],
    [135, 10, 5],
  ]);
  const dose = outcome.facts.dose_evidence.find((d) => d.exercise === "Back Squat");
  assert.equal(dose.challenge_verdict, "exceeded", "heavier than the card at the card's own estimated floor");

  // The plan is then rewritten onto the load the log lifted — after that session.
  db.prepare(`UPDATE plan_items SET sets = 3, rep_low = 5, rep_high = 7, target_weight = 185, prescribed_at = ?`).run(
    isoDaysAgo(5)
  );
  const p = nextPrescription("Back Squat", undefined, NO_BRAKES);
  assert.ok(!p.untested, "185 for 5–7 is what the log already did");
  assert.equal(p.action, "overload", p.why);
  // 185 × 7 with four in reserve supports ~195 for seven; two notches.
  assert.equal(p.suggested.weight, 195);
});

test("barbell curl: a catch-up onto 80 × 10 × 3 the day after lifting it is not an untested number", () => {
  makeExercise("Barbell Curl", "biceps");
  planSlot(
    { exercise: "Barbell Curl", sets: 3, rep_low: 8, rep_high: 10, target_weight: 80, focus: "Arms" },
    { stampDaysAgo: 4 }
  );
  logSets("Barbell Curl", 12, [
    [70, 10, 4],
    [80, 10, 2],
    [70, 10, 3],
  ]);
  logSets("Barbell Curl", 5, [
    [80, 10, 2],
    [80, 10, 1],
    [80, 10, 0],
  ]);
  const p = nextPrescription("Barbell Curl", undefined, NO_BRAKES);
  assert.ok(!p.untested, "tested by the session it restates");
  assert.notEqual(p.why, undefined);
  assert.ok(p.action === "overload" || p.escalated === "rep_range", `moves on: ${p.action} — ${p.why}`);
});

test("a fresh slot the log has NOT lifted still stands untested", () => {
  makeExercise("Pendlay Row", "back");
  planSlot(
    { exercise: "Pendlay Row", sets: 3, rep_low: 6, rep_high: 8, target_weight: 150, focus: "Pull" },
    { stampDaysAgo: 4 }
  );
  logSets("Pendlay Row", 7, [
    [135, 10, 2],
    [145, 10, 2],
    [145, 10, 2],
  ]);
  const p = nextPrescription("Pendlay Row", undefined, NO_BRAKES);
  assert.equal(p.untested, true);
  assert.equal(p.action, "hold");
  assert.equal(p.suggested.weight, 150);
});

test("reps past the ceiling are reserve: 10 at RIR 0 on a 6–8 card is not a grind", () => {
  makeExercise("Chest-Supported Row", "back");
  planSlot({ exercise: "Chest-Supported Row", sets: 3, rep_low: 6, rep_high: 8, target_weight: 100, focus: "Pull" });
  logSets("Chest-Supported Row", 9, [
    [100, 8, 2],
    [100, 8, 2],
    [100, 8, 1],
  ]);
  logSets("Chest-Supported Row", 2, [
    [100, 10, 0],
    [100, 10, 0],
    [100, 10, 0],
  ]);
  const p = nextPrescription("Chest-Supported Row", undefined, NO_BRAKES);
  assert.equal(p.action, "overload", p.why);
  assert.ok(p.suggested.weight > 100);
});

test("a bodyweight set on a loaded lift never reads as its best — the split squat climbing 60 → 90 is not sliding", () => {
  repo.setProfile({ weight_lb: 168 });
  makeExercise("Bulgarian Split Squat", "quads");
  planSlot({
    exercise: "Bulgarian Split Squat",
    sets: 2,
    rep_low: 8,
    rep_high: 10,
    target_weight: 90,
    focus: "Lower B",
  });
  logSets("Bulgarian Split Squat", 104, [
    [60, 10],
    [60, 10],
  ]);
  logSets("Bulgarian Split Squat", 95, [
    [0, 12],
    [0, 12],
  ]);
  logSets("Bulgarian Split Squat", 89, [
    [60, 10],
    [60, 10],
  ]);
  logSets("Bulgarian Split Squat", 68, [
    [70, 10],
    [70, 10],
  ]);
  logSets("Bulgarian Split Squat", 48, [
    [60, 10],
    [60, 10],
  ]);
  logSets("Bulgarian Split Squat", 6, [[70, 10, 5]]);
  logSets("Bulgarian Split Squat", 4, [
    [90, 10, 2],
    [90, 10],
  ]);
  const points = repo.getProgress("Bulgarian Split Squat").points;
  const zero = points.find((pt) => pt.topWeight === 0);
  assert.ok(!zero || zero.best1rm == null, "the zero-load set carries no est-1RM beside loaded history");
  const state = getProgramState().lifts.find((l) => l.exercise === "Bulgarian Split Squat");
  assert.notEqual(state.status, "regressing", `60 → 70 → 90 is not a slide (${state.trend_per_wk}/wk)`);
  const p = nextPrescription("Bulgarian Split Squat", undefined, NO_BRAKES);
  assert.notEqual(p.action, "deload", p.why);
});
