// The live week of 2026-09-28 replayed end to end (integration of the intent, load and
// week streams, 2026-10-04). Shape only, no real data: the run history before it is the
// live log's SHAPE (an uneven ~11–32 km run of weeks with a 17.7 km longest), so the
// 35.8 km week is a jump the run engine holds.
//
//   Fri "Hill Sprints" is the planned quality session moved a day — the build's own
//   dose, never harm, so the week is not set aside and capacity's floor is 35.8 km;
//   the next week is the engine's jump HOLD (not a set-aside fallback);
//   the Saturday MTB is the observed cross-training pattern (2 of 6 weeks);
//   Sunday's long run keeps its date on Saturday, with the ride's leg caveat;
//   the whole-week read says it in plain words, with no numbers in its line.
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { repo } from "./_seed.js";
import { harmEvidenceOnDay } from "../dist/repo/brain/read-adherence.js";
import { crossTrainingDays } from "../dist/repo/cross-training-day.js";
import { closedRunIntentOn, weekRunClosures } from "../dist/repo/flexible-training-agenda.js";
import { raceBuild } from "../dist/repo/race-build.js";
import { demonstratedRunCapacity } from "../dist/repo/run-capacity.js";
import { weeklyRunPlan } from "../dist/repo/run-progression.js";
import { weekTrainingLoad } from "../dist/repo/week-training-load.js";
import {
  FRI,
  NEXT_MON,
  SAT,
  SUN,
  TUE,
  WEEK,
  resetLiveWeekTables,
  ride,
  run,
  seedLiveWeek,
  seedProfile,
} from "./_liveWeekFixture.js";

beforeEach(resetLiveWeekTables);

// Five weeks before the live one, shaped like the live log: 27.1, 10.9, 23.5, 32.5 and
// 19.4 km, a 17.7 km longest on 09-20, and one earlier Saturday MTB (09-19).
function seedLiveShapedHistory() {
  for (const [date, km] of [
    ["2026-08-25", 6.8],
    ["2026-08-27", 9.9],
    ["2026-08-30", 10.4],
    ["2026-09-01", 4.5],
    ["2026-09-03", 6.4],
    ["2026-09-08", 6.0],
    ["2026-09-10", 4.5],
    ["2026-09-12", 13.0],
    ["2026-09-15", 4.9],
    ["2026-09-17", 9.8],
    ["2026-09-20", 17.7],
    ["2026-09-22", 4.1],
    ["2026-09-24", 6.7],
    ["2026-09-27", 8.6],
  ])
    run(date, km);
  ride("2026-09-19", 115, { load: 112, te: 3.2 });
}

test("Saturday: the MTB is the observed pattern and Sunday's long run keeps its date", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-03T20:00:00Z") });
  seedProfile();
  seedLiveShapedHistory();
  const ids = seedLiveWeek({ withSunday: false });

  const [day] = crossTrainingDays(SAT);
  assert.equal(day?.weekday, "Saturday");
  assert.equal(day?.sport_family, "ride");
  assert.equal(day?.source, "observed", "read off the log, never asked of the athlete");

  const agenda = repo.flexibleTrainingAgenda(SAT);
  const byKind = Object.fromEntries(agenda.intents.map((i) => [i.kind, i]));
  assert.equal(byKind.easy.completion?.activity_id, ids.tue.id, "Tuesday is the easy run");
  assert.equal(byKind.quality.completion?.activity_id, ids.fri.id, "Friday's Hill Sprints is the quality run");
  assert.equal(byKind.long.status, "open", "Tuesday's 9.7 km never closes Sunday's long run early");
  assert.equal(byKind.long.suggested_date, SUN, "the ride does not strip the long run's date");
  assert.match(byKind.long.rationale, /legs/, "the leg-load caveat rides on the long run");
  assert.ok(
    agenda.extras.some((e) => e.activity_id === ids.wed.id),
    "Wednesday's social run is an extra"
  );

  const read = weekTrainingLoad(SAT);
  assert.equal(read.next_48h.planned[0].run_kind, "long");
  assert.equal(read.next_48h.implication_code, "legs_loaded_before_key_run");
  assert.match(read.next_48h.line, /Sunday's long run/);
  assert.match(read.next_48h.line, /trail MTB/);
  assert.doesNotMatch(read.next_48h.line, /\d/);

  // The stateless closure read (no live prescriptions) agrees with the agenda:
  // Tuesday's easy run is held for its own day, Wednesday stays an extra, and the
  // long run stays open with Sunday still unrun — through Sunday as well.
  const closures = weekRunClosures(WEEK, SAT);
  assert.equal(closures.find((c) => c.activity_id === ids.tue.id)?.closed, "easy");
  assert.equal(closures.find((c) => c.activity_id === ids.wed.id)?.closed, null);
  assert.equal(closures.find((c) => c.activity_id === ids.fri.id)?.closed, "quality");
  assert.equal(closures.some((c) => c.closed === "long"), false);
  assert.deepEqual(closedRunIntentOn(TUE), ["easy"]);
  assert.equal(weekRunClosures(WEEK, SUN).some((c) => c.closed === "long"), false);
});

test("a short watch-hard extra after quality stays an extra and counts as hard cardio", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-03T20:00:00Z") });
  seedProfile();
  seedLiveShapedHistory();
  seedLiveWeek({ withSunday: false, withSaturday: false });
  const extra = run(SAT, 4.5, { min: 22, garmin: { name: "Tempo", te_label: "TEMPO", aerobic_te: 3.6 } });
  assert.deepEqual(closedRunIntentOn(TUE), ["easy"]);
  assert.deepEqual(closedRunIntentOn(SAT), []);
  const closures = weekRunClosures(WEEK, SUN);
  assert.equal(closures.find((c) => c.activity_id === extra.id)?.closed, null);
  assert.equal(closures.some((c) => c.closed === "long"), false);
  assert.equal(harmEvidenceOnDay(SAT, { domain: "running" })?.kind, "hard_cardio");
});

test("Sunday: the moved quality session is the build's dose, the week stands at 35.8 km, and next week holds the jump", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-04T20:00:00Z") });
  seedProfile();
  seedLiveShapedHistory();
  seedLiveWeek();

  assert.deepEqual(closedRunIntentOn(FRI), ["quality"]);
  assert.equal(harmEvidenceOnDay(FRI, { domain: "running" }), null, "the moved quality run is not harm");
  assert.equal(harmEvidenceOnDay(TUE, { domain: "running" }), null);
  assert.equal(harmEvidenceOnDay(SUN, { domain: "running" }), null);

  const capacity = demonstratedRunCapacity(SUN);
  assert.equal(capacity.best_week_km, 35.8);
  assert.ok(!capacity.set_aside.some((w) => w.week_start === WEEK), "the week is not set aside");

  const read = weekTrainingLoad(SUN);
  assert.equal(read.week.run_km, 35.8);
  assert.deepEqual(
    read.week.intents.map((i) => [i.kind, i.status, i.date]),
    [
      ["easy", "completed", TUE],
      ["quality", "completed", FRI],
      ["long", "completed", SUN],
    ]
  );
  assert.equal(read.week.extras_count, 1);
  assert.equal(read.week.cross_minutes_by_family.ride, 142);
  assert.deepEqual(
    read.spacing.hard_back_to_back.map((p) => p.what),
    ["quality run, then trail MTB", "trail MTB, then long run"]
  );
  // Past the agenda's week, the stated run days still name Tuesday's easy run.
  assert.equal(read.next_48h.planned.find((p) => p.date === "2026-10-06")?.run_kind, "easy");
  assert.doesNotMatch(read.next_48h.line, /\d/);

  t.mock.timers.reset();
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-05T07:00:00Z") });
  const build = raceBuild(NEXT_MON);
  assert.equal(build.capacity.floor_km, 35.8);
  assert.equal(build.capacity.note, "", "no set-aside note");
  assert.equal(build.ride?.source, "observed");
  assert.equal(build.ride?.weekday, "Saturday");
  const plan = weeklyRunPlan(NEXT_MON);
  assert.ok(
    plan.rationale.some((line) => /jumped/i.test(line)),
    `the jump is held: ${plan.rationale.join(" | ")}`
  );
  const planKm = plan.runs.reduce((sum, r) => sum + (r.target_distance_km ?? 0), 0);
  assert.ok(Math.abs(build.this_week.km - planKm) < 0.15, "the race build reads the run engine's own week");
  const long = plan.runs.find((r) => r.kind_label === "long");
  assert.ok(long.target_distance_km <= 17.7, "a held week's long run stays under the longest");
});

test("the patterned Saturday MTB is the habitual dose: hard on the watch, never yesterday's harm by intensity alone", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-04T20:00:00Z") });
  const { hardCardioDayIntense } = await import("../dist/repo/training-read.js");
  seedProfile();
  seedLiveShapedHistory();
  seedLiveWeek();
  assert.ok(crossTrainingDays(SUN).some((d) => d.dow === 6), "Saturday is the known cross-training day");
  assert.equal(hardCardioDayIntense(SAT), true, "the watch grades the MTB hard");
  assert.notEqual(harmEvidenceOnDay(SAT)?.kind, "hard_cardio");
});

test("a hard RUN beside the MTB on the cross-training weekday is still harm", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-03T20:00:00Z") });
  const { hardCardioDayIntense } = await import("../dist/repo/training-read.js");
  seedProfile();
  seedLiveShapedHistory();
  seedLiveWeek({ withSunday: false });
  run(SAT, 8, { min: 40, garmin: { name: "Threshold", te_label: "LACTATE_THRESHOLD", aerobic_te: 4.2 } });
  if (!hardCardioDayIntense(SAT)) return t.skip("fixture run does not grade hard");
  assert.equal(harmEvidenceOnDay(SAT)?.kind, "hard_cardio");
});
