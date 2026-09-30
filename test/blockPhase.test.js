// A block's scheduled deload is the calendar's, not the body's. For an athlete who has
// asked to be pushed, the scheduled last-week deload runs as intensification unless the
// loaded-weeks evidence also calls for it (block-phase.ts) — and EVERY surface that
// names the week says the same thing: the coach's block summary, the day read's
// effective phase, the volume floor's deload exemption and the progression math.
// After such a skip, a fresh block must not hide a deload the loaded weeks call for.
import assert from "node:assert/strict";
import { test } from "node:test";
import { db, isoDaysAgo, repo } from "./_seed.js";
import { coachBlockSummary, nextWeekScheduledDeloadRuns, resolvedBlockPhase } from "../dist/repo/block-phase.js";
import { createBlock } from "../dist/repo/program-blocks.js";
import { dayReadPeriodizationContext } from "../dist/repo/day-read.js";
import { lightWeekExemption } from "../dist/repo/volume-floor-context.js";
import { nextPrescription } from "../dist/repo/progression.js";
import { getProgramState } from "../dist/repo/program-state.js";

function logSet(name, date, weight, reps, rir, setNum) {
  const ex = repo.findExercise(name);
  const session = repo.getOrCreateSession(date, null);
  db.prepare(
    `INSERT INTO logged_sets (session_id, exercise_id, set_number, weight, reps, rir) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(session.id, ex.id, setNum, weight, reps, rir);
}

// `weeks` weeks of the same bench work, one session a week, the newest five days ago.
function seedLoadedWeeks(weeks) {
  repo.upsertExercise({ name: "Bench Press", muscle_group: "chest", mode: "reps" });
  repo.savePlanDay(1, "Push", "Push", [
    { exercise: "Bench Press", sets: 3, rep_low: 6, rep_high: 8, target_weight: 185 },
  ]);
  db.prepare(`UPDATE plan_items SET prescribed_at = ?`).run(isoDaysAgo(120));
  for (let w = weeks; w >= 1; w--)
    for (let s = 1; s <= 3; s++) logSet("Bench Press", isoDaysAgo(w * 7 - 2), 185, 8, 2, s);
}

const today = () => isoDaysAgo(0);

test("push, no deload evidence: the scheduled deload runs as intensification on every surface", () => {
  repo.setSettings({ training_drive: "push" });
  seedLoadedWeeks(2);
  createBlock({ goal: "Strength", focus: "strength", total_weeks: 4, week_index: 4 });
  assert.equal(resolvedBlockPhase(today()), "intensification");
  const summary = coachBlockSummary(today());
  assert.equal(summary.phase, "intensification");
  assert.equal(summary.scheduled_deload_skipped, true);
  assert.equal(dayReadPeriodizationContext(today()).program_block.effective_phase, "intensification");
  assert.equal(dayReadPeriodizationContext(today()).program_block.stored_phase, "deload");
  assert.notEqual(lightWeekExemption(today()), "deload_phase", "a building week exempts no volume floor");
  const p = nextPrescription("Bench Press");
  assert.equal(p.block_phase, "intensification");
});

test("steady: the scheduled deload stands as written on every surface", () => {
  repo.setSettings({ training_drive: "steady" });
  seedLoadedWeeks(2);
  createBlock({ goal: "Strength", focus: "strength", total_weeks: 4, week_index: 4 });
  assert.equal(resolvedBlockPhase(today()), "deload");
  const summary = coachBlockSummary(today());
  assert.equal(summary.phase, "deload");
  assert.equal(summary.scheduled_deload_skipped, undefined);
  assert.equal(dayReadPeriodizationContext(today()).program_block.effective_phase, "deload");
  assert.equal(lightWeekExemption(today()), "deload_phase");
  assert.equal(nextPrescription("Bench Press").block_phase, "deload");
});

test("push WITH loaded-weeks evidence: the scheduled deload is earned and holds everywhere", () => {
  repo.setSettings({ training_drive: "push" });
  seedLoadedWeeks(8);
  createBlock({ goal: "Strength", focus: "strength", total_weeks: 4, week_index: 4 });
  assert.equal(getProgramState(today()).mesocycle.deload_evidence, true);
  assert.equal(resolvedBlockPhase(today()), "deload");
  assert.equal(coachBlockSummary(today()).phase, "deload");
  assert.equal(dayReadPeriodizationContext(today()).program_block.effective_phase, "deload");
  assert.equal(nextPrescription("Bench Press").block_phase, "deload");
});

test("the week before a scheduled deload: exempt only when that deload will actually run", () => {
  repo.setSettings({ training_drive: "push" });
  seedLoadedWeeks(2);
  createBlock({ goal: "Strength", focus: "strength", total_weeks: 4, week_index: 3 });
  assert.equal(nextWeekScheduledDeloadRuns(today()), false);
  assert.notEqual(lightWeekExemption(today()), "deload_phase");
  repo.setSettings({ training_drive: "steady" });
  assert.equal(nextWeekScheduledDeloadRuns(today()), true);
});

function skippedDeloadThenFreshBlock() {
  seedLoadedWeeks(8);
  // The previous block ran to its scheduled deload week…
  createBlock({ goal: "Strength", focus: "strength", total_weeks: 4, week_index: 4, started_at: isoDaysAgo(31) });
  // …and a new block started three days ago (the old one is marked completed).
  createBlock({ goal: "Strength 2", focus: "strength", total_weeks: 4, week_index: 1, started_at: isoDaysAgo(3) });
}

test("push: after a skipped scheduled deload, a fresh block does not hide the deload the loaded weeks call for", () => {
  repo.setSettings({ training_drive: "push" });
  skippedDeloadThenFreshBlock();
  const meso = getProgramState(today()).mesocycle;
  assert.equal(meso.deload_evidence, true);
  assert.equal(meso.phase, "deload-due", meso.note);
});

test("steady: a fresh block still reads as the plan (the scheduled deload was run as written)", () => {
  repo.setSettings({ training_drive: "steady" });
  skippedDeloadThenFreshBlock();
  const meso = getProgramState(today()).mesocycle;
  assert.notEqual(meso.phase, "deload-due", meso.note);
});
