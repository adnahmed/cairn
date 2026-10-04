// A moved key run is still the planned run (owner decision 2026-10-04, "intent" stream).
//
// The live week of 2026-09-28 (test/_liveWeekFixture.js): the quality session ran on
// Friday as "Hill Sprints" — moved off Thursday on purpose to leave room before Sunday's
// long run. The harm law already exempts the build's own prescription on the stated
// quality weekday; it read the RAW weekday, so the moved session counted as harm, set the
// 35.8 km week aside, and next week started from the smaller one. Now WHICH run was the
// quality (or long) run is the week's own completion — the agenda's one matcher, read
// cycle-free (weekRunClosures / closedRunIntentOn) — and the weekday is only a fallback.
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { repo } from "./_seed.js";
import { harmEvidenceOnDay } from "../dist/repo/brain/read-adherence.js";
import { demonstratedRunCapacity } from "../dist/repo/run-capacity.js";
import { raceBuild } from "../dist/repo/race-build.js";
import { closedRunIntentOn, weekRunClosures } from "../dist/repo/flexible-training-agenda.js";
import { runWithBrainSnapshot, activeSnapshotMemos } from "../dist/brain/snapshot.js";
import {
  FRI,
  SUN,
  THU,
  TUE,
  WED,
  WEEK,
  NEXT_MON,
  resetLiveWeekTables,
  run,
  seedHistory,
  seedLiveWeek,
  seedProfile,
} from "./_liveWeekFixture.js";

const NOW = new Date("2026-10-04T20:00:00Z");

beforeEach(resetLiveWeekTables);

function seed(opts) {
  seedProfile();
  seedHistory();
  return seedLiveWeek(opts);
}

test("the moved quality session closes quality, and its hard effort is the build's dose, not harm", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  const ids = seed();
  assert.ok(closedRunIntentOn(FRI).includes("quality"), "Friday's Hill Sprints closed the week's quality");
  assert.deepEqual(closedRunIntentOn(THU), [], "nothing ran on Thursday");
  assert.equal(harmEvidenceOnDay(FRI, { domain: "running" }), null);
  // The rest of the week reads as it always did.
  assert.equal(harmEvidenceOnDay(TUE, { domain: "running" }), null, "stated easy");
  assert.equal(harmEvidenceOnDay(SUN, { domain: "running" }), null, "the planned long run");
  const closures = weekRunClosures(WEEK, SUN);
  assert.deepEqual(
    closures.map((c) => [c.activity_id, c.closed]),
    [
      [ids.tue.id, "easy"],
      [ids.wed.id, null],
      [ids.fri.id, "quality"],
      [ids.sun.id, "long"],
    ]
  );
});

test("the week is not set aside for the moved quality session, and the race build says nothing of it", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  seed();
  const shown = demonstratedRunCapacity(SUN);
  assert.ok(
    !shown.set_aside.some((w) => w.week_start === WEEK),
    `week ${WEEK} set aside: ${JSON.stringify(shown.set_aside)}`
  );
  assert.equal(shown.best_week_km, 35.8);
  // No morning has landed for 10-05: the read must not need one.
  const build = raceBuild(NEXT_MON);
  assert.ok(!(build.capacity?.set_aside ?? []).some((w) => w.week_start === WEEK));
  assert.doesNotMatch(build.capacity?.note ?? "", /hard run/i);
});

test("a bigger untitled watch-hard run does not steal quality from the titled session", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  const ids = seed({ wedHard: true });
  assert.ok(closedRunIntentOn(FRI).includes("quality"));
  assert.deepEqual(closedRunIntentOn(WED), [], "Wednesday closed nothing");
  const closures = weekRunClosures(WEEK, SUN);
  assert.equal(closures.find((c) => c.activity_id === ids.wed.id)?.closed, null);

  const agenda = repo.flexibleTrainingAgenda(SUN);
  assert.equal(agenda.available, true);
  assert.ok(
    agenda.extras.some((e) => e.activity_id === ids.wed.id),
    "Wednesday rides out as an extra"
  );
  const byKind = Object.fromEntries(
    agenda.intents.filter((i) => i.completion).map((i) => [i.kind, i.completion.activity_id])
  );
  const closedByKind = Object.fromEntries(closures.filter((c) => c.closed).map((c) => [c.closed, c.activity_id]));
  assert.deepEqual(byKind, closedByKind, "the agenda and the cycle-free read are one matcher");
  assert.equal(byKind.quality, ids.fri.id);

  // The law is intact: an untitled hard EXTRA run with no stated effort is still harm
  // until a next morning absorbs it.
  assert.equal(harmEvidenceOnDay(WED, { domain: "running" })?.kind, "hard_cardio");
  assert.equal(harmEvidenceOnDay(FRI, { domain: "running" }), null);
});

test("a hard run on the stated quality weekday keeps its exemption", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  seedProfile();
  seedHistory();
  run(TUE, 8, { rpe: 3 });
  run(THU, 7, { garmin: { name: "Morning Run", te_label: "THRESHOLD", aerobic_te: 3.4 } });
  assert.ok(closedRunIntentOn(THU).includes("quality"));
  assert.equal(harmEvidenceOnDay(THU, { domain: "running" }), null);
});

test("a hard intervals run in a recovery week is harm, not the build's quality", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-04T20:00:00Z") });
  seedProfile();
  seedHistory();
  const proposal = repo.createProposal("stub", repo.RECOVERY_WEEK_INSTRUCTION, "", {
    summary: "Reduced recovery prescription.",
    days: repo.getPlan(),
  });
  repo.setProposalStatus(proposal.id, "applied");
  repo.setAppState("recovery_week_applied", JSON.stringify({ applied_on: WEEK, proposal_id: proposal.id }));
  run(FRI, 8, { min: 36, garmin: { name: "Intervals", te_label: "INTERVAL", aerobic_te: 3.4 } });
  assert.equal(harmEvidenceOnDay(FRI, { domain: "running" })?.kind, "hard_cardio");
});

test("the cycle-free read never builds the live week", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  seed();
  runWithBrainSnapshot(() => {
    closedRunIntentOn(FRI);
    harmEvidenceOnDay(FRI, { domain: "running" });
    const keys = [...(activeSnapshotMemos()?.keys() ?? [])];
    assert.ok(
      keys.some((k) => k.startsWith("week_run_closures:")),
      "the closure read is memoized"
    );
    for (const forbidden of ["weekly_run_plan:", "flexible_training_agenda:", "demonstrated_run_capacity"]) {
      assert.ok(!keys.some((k) => k.startsWith(forbidden)), `${forbidden} was read: ${keys.join(", ")}`);
    }
  });
});
