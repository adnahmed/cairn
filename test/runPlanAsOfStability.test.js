// One week, one prescription (2026-10-04, "intent" stream).
//
// get_run_plan and get_race_build disagreed about the same week by the as-of date alone:
// read on Monday 10-05 the week was "Short threshold", 4 km, a held week; read on
// Thursday 10-08 it was the whole threshold session and a ~10% build. Both surfaces read
// weeklyRunPlan(asOf), so the disagreement was an as-of-dependent INPUT, and it was the
// spike brake: `spiking` is the endurance status's trailing-7-day ratio with no week
// boundary. On the week's Monday its window IS the closed week (a jump to 35.8 km), so the
// week was held; by Tuesday the window had slid off last week's runs, the status read
// "building"/"maintaining", and the same week re-planned itself as a full build with
// nothing logged in between. The closed week's own spike now holds the whole week from
// every morning (the live read stays as the downward-only brake for a block run inside
// the week).
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { repo } from "./_seed.js";
import { raceBuild } from "../dist/repo/race-build.js";
import { resetLiveWeekTables, ride, run, seedLiveWeek, seedProfile } from "./_liveWeekFixture.js";

const WEEK_DAYS = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10"];

beforeEach(resetLiveWeekTables);

// ~20 km weeks, then the live 35.8 km week: a real jump against the chronic base.
function seedSpikeHistory() {
  for (const [date, km] of [
    ["2026-08-25", 5.0],
    ["2026-08-27", 5.0],
    ["2026-08-30", 9.0],
    ["2026-09-01", 5.0],
    ["2026-09-03", 5.0],
    ["2026-09-06", 9.0],
    ["2026-09-08", 5.0],
    ["2026-09-10", 5.5],
    ["2026-09-13", 9.5],
    ["2026-09-15", 5.5],
    ["2026-09-17", 5.5],
    ["2026-09-20", 10.0],
    ["2026-09-22", 6.0],
    ["2026-09-24", 5.0],
    ["2026-09-27", 10.5],
  ])
    run(date, km, { rpe: 3 });
  ride("2026-09-19", 115, { load: 190, te: 3.6 });
}

function shape(plan) {
  return plan.runs.map((r) => [
    r.kind_label,
    r.day_number,
    r.label,
    r.target_distance_km,
    r.target_duration_min ?? null,
  ]);
}

const weekKm = (plan) =>
  Math.round(plan.runs.reduce((sum, r) => sum + (Number(r.target_distance_km) || 0), 0) * 10) / 10;

test("the week after a spike is held from every morning of it, not only Monday's", (t) => {
  // Every morning of the week already lived: the morning call on today's run is not in
  // play, so what is compared is the WEEK.
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-12T20:00:00Z") });
  seedProfile();
  seedSpikeHistory();
  seedLiveWeek();
  // The root cause, in the open: the live status reads the spike on Monday only.
  assert.equal(repo.getProgramState("2026-10-05").endurance?.status, "spiking");
  assert.notEqual(repo.getProgramState("2026-10-08").endurance?.status, "spiking");

  const monday = repo.weeklyRunPlan("2026-10-05");
  assert.equal(monday.available, true);
  assert.ok(
    monday.rationale.some((line) => /Mileage jumped recently/.test(line)),
    monday.rationale.join(" | ")
  );
  for (const d of WEEK_DAYS) {
    const plan = repo.weeklyRunPlan(d);
    assert.deepEqual(shape(plan), shape(monday), `run plan as of ${d}`);
    const build = raceBuild(d);
    assert.equal(build.this_week.km, weekKm(monday), `race build week km as of ${d}`);
    assert.equal(
      build.this_week.quality?.label ?? null,
      monday.runs.find((r) => r.kind_label === "quality")?.label ?? null,
      `race build quality as of ${d}`
    );
  }
});

test("a held week never hands the long run the easy days' remainder", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-12T20:00:00Z") });
  seedProfile();
  seedSpikeHistory();
  seedLiveWeek();
  const plan = repo.weeklyRunPlan("2026-10-08");
  const long = plan.runs.find((r) => r.kind_label === "long");
  // The demonstrated longest is the live week's 13.54 km: a held week sits a step under it.
  assert.ok(long.target_distance_km <= 13.54, `long run ${long.target_distance_km} km on a held week`);
  for (const r of plan.runs.filter((x) => x.kind_label === "easy"))
    assert.ok(r.target_distance_km <= long.target_distance_km, "the long run stays the week's longest");
});

test("with no spike the week reads the same from every morning too", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-12T20:00:00Z") });
  seedProfile();
  for (const [date, km] of [
    ["2026-08-25", 6.5],
    ["2026-08-27", 6.0],
    ["2026-08-30", 10.0],
    ["2026-09-01", 7.0],
    ["2026-09-03", 6.0],
    ["2026-09-06", 10.0],
    ["2026-09-08", 7.5],
    ["2026-09-10", 6.0],
    ["2026-09-13", 11.0],
    ["2026-09-15", 8.0],
    ["2026-09-17", 6.5],
    ["2026-09-20", 12.0],
    ["2026-09-22", 8.0],
    ["2026-09-24", 7.0],
    ["2026-09-27", 12.9],
  ])
    run(date, km, { rpe: 3 });
  seedLiveWeek();
  const monday = repo.weeklyRunPlan("2026-10-05");
  for (const d of WEEK_DAYS) {
    assert.deepEqual(shape(repo.weeklyRunPlan(d)), shape(monday), `run plan as of ${d}`);
    assert.equal(raceBuild(d).this_week.km, weekKm(monday), `race build as of ${d}`);
  }
});
