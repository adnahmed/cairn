// Demonstrated capacity is the floor under the race build, and the peak is a new high.
//
// The live case (owner ruling 2026-09-29, "plan on pushing me forward, new peaks, new
// milestones"): a hybrid athlete running Tue easy / Thu quality / Sun long ran a 32.5 km
// week, then a lighter one — and the race ladder, walking only off last week, peaked at
// 24.4 km five weeks out. The terrain chart drew his logged weeks above the planned peak.
//
//   • the best closed week of the last eight run WITHOUT harm evidence
//     (`harmEvidenceOnDay`, the one law) is the floor: the ramp aims one step past it
//     and a lighter week resumes toward it inside the engine's own ACWR ceiling;
//   • the long-run peak meets or passes the longest run taken well;
//   • a week the body paid for is set aside and the floor falls back;
//   • harm on a trip day is the trip, not the running — it never lowers the floor;
//   • the taper and race week are untouched: peak → taper → race.
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { repo, resetTables } from "./_seed.js";
import { harmEvidenceOnDay } from "../dist/repo/brain/read-adherence.js";
import { projectRaceBuildWeeks, raceBuild } from "../dist/repo/race-build.js";
import { closedWeekRunHarm, demonstratedRunCapacity } from "../dist/repo/run-capacity.js";
import { RUN_CAPACITY_RESUME_VARIANTS } from "../dist/repo/run-progression.js";
import {
  capacityResumeKm,
  longPeakTargetKm,
  NEW_PEAK_STEP,
  PEAK_TARGET_CEILING_OF_DEMAND,
  peakTargetKm,
  peakWeeklyKm,
  raceRamp,
} from "../dist/repo/run-ramp.js";

const RACE = "2031-11-02"; // a Sunday, five weeks out
const HALF = 21.1;
const TODAY = "2031-09-30"; // Tuesday of the week being planned
const SUNDAY_BEFORE = "2031-09-28";
const BIG_WEEK = "2031-09-15";
const BIG_LONG = "2031-09-21"; // the big week's Sunday long run
const goal = { is_race: true, date: RACE, distance_km: HALF, target: "sub-2:00 target; 1:50 stretch" };

beforeEach(() => {
  resetTables(
    "activities",
    "garmin_activities",
    "garmin_daily_metrics",
    "garmin_sources",
    "context_events",
    "sessions",
    "plan_items",
    "plan_days",
    "program_blocks",
    "app_state",
    "profile"
  );
});

const run = (date, distance) =>
  repo.addActivity({ type: "run", duration_min: Math.round(distance * 6), distance_km: distance, date });

// Tue easy / Thu quality / Sun long, a supporting runner with a dated half. Weeks
// (Mondays): 9/1 20.5 · 9/8 23.4 · 9/15 32.5 (the big week) · 9/22 17.0 (lighter).
function seedAthlete() {
  repo.setProfile({
    age: 40,
    sex: "male",
    primary_discipline: "hybrid",
    endurance_sport: "running",
    training_intent: {
      priorities: ["longevity", "muscle", "strength", "leanness", "endurance"],
      endurance_role: "supporting",
    },
    endurance_goal: { mode: "race", event: "City Half", date: RACE, distance_km: HALF, target: goal.target },
    endurance_schedule: {
      days: [
        { dow: 0, kind: "long" },
        { dow: 2, kind: "easy" },
        { dow: 4, kind: "quality" },
      ],
      source: "athlete",
    },
  });
  for (const [date, km] of [
    ["2031-09-02", 5.0],
    ["2031-09-04", 5.5],
    ["2031-09-07", 10.0],
    ["2031-09-09", 4.5],
    ["2031-09-11", 6.0],
    ["2031-09-14", 12.9],
    ["2031-09-16", 4.9],
    ["2031-09-18", 9.9],
    [BIG_LONG, 17.7],
    ["2031-09-23", 4.0],
    ["2031-09-25", 5.0],
    ["2031-09-28", 8.0],
  ])
    run(date, km);
}

const peakOf = (weeks) => weeks.find((w) => w.kind === "peak");

// ── the pure arithmetic ─────────────────────────────────────────────────────────

test("the peak target is the race's demand or one step past the best harm-free week", () => {
  const demand = peakWeeklyKm(HALF);
  assert.equal(peakTargetKm(HALF, null), demand);
  // Under the demand, the demand stands.
  assert.equal(peakTargetKm(HALF, 32.5), demand);
  // Past it, one ordinary step past what was run well…
  assert.equal(peakTargetKm(HALF, 40), Math.round(40 * NEW_PEAK_STEP * 10) / 10);
  // …capped as a multiple of the demand, and never under the week itself.
  assert.equal(peakTargetKm(HALF, 60), Math.round(demand * PEAK_TARGET_CEILING_OF_DEMAND * 10) / 10);
  assert.equal(peakTargetKm(HALF, 70), 70);
});

test("the long-run peak meets or passes the longest run taken well", () => {
  assert.equal(longPeakTargetKm(HALF, null), 17.9);
  assert.equal(longPeakTargetKm(HALF, 17.7), 19.5); // a step past it
  assert.equal(longPeakTargetKm(HALF, 19.5), 20); // capped at 20 km…
  assert.equal(longPeakTargetKm(HALF, 22), 22); // …but never under what was run
  const r = raceRamp(goal, "2031-10-13", 33, 17.7, null, { long_km: 17.7 });
  assert.ok(r.peak_long_km >= 17.7, `${r.peak_long_km}`);
});

test("a lighter week resumes toward the floor, inside the ACWR ceiling", () => {
  // Chronic mean 23.35 → ceiling 32.7: the floor itself is reachable.
  assert.equal(capacityResumeKm(17, 32.5, [20.5, 23.4, 32.5, 17], 8), 32.5);
  // A thinner month holds the resume at its ceiling, never past it.
  assert.equal(capacityResumeKm(12, 32.5, [14, 16, 20, 12], 8), 21.7);
  // No chronic base to read (weeks off): no resume, the reactive anchor stands.
  assert.equal(capacityResumeKm(6, 32.5, [0, 0, 20, 6], 8), 6);
  // Already at or above the floor: untouched.
  assert.equal(capacityResumeKm(34, 32.5, [20.5, 23.4, 32.5, 34], 8), 34);
});

// ── the live shape ──────────────────────────────────────────────────────────────

test("a 32.5 km week run without harm two weeks ago: the ladder peaks past it", () => {
  seedAthlete();
  const shown = demonstratedRunCapacity(SUNDAY_BEFORE);
  assert.equal(shown.floor_km, 32.5);
  assert.equal(shown.floor_week_start, BIG_WEEK);
  assert.deepEqual(shown.set_aside, []);
  assert.equal(shown.long_km, 17.7);

  const build = raceBuild(TODAY);
  const peak = peakOf(build.weeks);
  assert.ok(peak.km > 32.5, `peak rung ${peak.km} km`);
  assert.ok(peak.long_km >= 17.7, `peak long ${peak.long_km} km`);
  // It is said as a milestone, in words — never a number or a score.
  assert.equal(peak.new_high, true);
  assert.equal(peak.focus_short, "A new weekly high");
  assert.match(peak.focus, /^A new weekly high/);
  // No rung before the taper plans below the demonstrated floor.
  for (const w of build.weeks.filter((x) => x.kind === "build" || x.kind === "peak")) {
    assert.ok(w.km >= 32.5 - 0.05, `${w.week_start} ${w.kind} at ${w.km}`);
  }
  // The arrival shape is untouched: peak → taper → race.
  assert.deepEqual(
    build.weeks.slice(-3).map((w) => w.kind),
    ["peak", "taper", "race"]
  );

  // The engine itself resumes from the week run well, and says so.
  const plan = repo.weeklyRunPlan(TODAY, { adjustToday: false });
  const resume = RUN_CAPACITY_RESUME_VARIANTS.map((say) => say(33).slice(0, 20));
  assert.ok(
    plan.rationale.some((line) => resume.some((head) => line.startsWith(head))),
    plan.rationale.join(" | ")
  );
});

test("walked week by week, the engine delivers the new high without tripping its own brake", () => {
  seedAthlete();
  const ladder = raceBuild(TODAY).weeks;
  const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
  const km = (plan) => Math.round(plan.runs.reduce((sum, r) => sum + (Number(r.target_distance_km) || 0), 0) * 10) / 10;
  for (const rung of ladder) {
    const asked = rung.current ? TODAY : rung.week_start;
    const plan = repo.weeklyRunPlan(asked, { adjustToday: false });
    assert.notEqual(
      repo.getProgramState(asked).endurance?.status,
      "spiking",
      `${rung.week_start} opens reading as a spike`
    );
    if (rung.kind === "build" || rung.kind === "peak") {
      assert.ok(Math.abs(km(plan) - rung.km) <= 1.5, `${rung.week_start}: ladder ${rung.km} km, engine ${km(plan)} km`);
    }
    // Run the week as written, the way the athlete following the plan would.
    for (const r of plan.runs) {
      const date = addDays(plan.week_start, Number(r.day_number) - 1);
      if (date >= (rung.current ? TODAY : rung.week_start)) run(date, Number(r.target_distance_km));
    }
  }
});

test("the big week carried harm: the floor falls back to the best week it did not", () => {
  seedAthlete();
  const clean = peakOf(raceBuild(TODAY).weeks).km;
  resetTables("activities", "garmin_daily_metrics");
  seedAthlete();
  // The morning after the big week's long run read rest-grade.
  repo.upsertGarminDailyMetric({ date: "2031-09-22", training_readiness: 1 });

  const shown = demonstratedRunCapacity(SUNDAY_BEFORE);
  assert.equal(shown.floor_km, 23.4);
  assert.equal(shown.set_aside[0]?.km, 32.5);
  assert.equal(shown.set_aside[0]?.harm.kind, "readiness_rest_grade");
  // The long run the body paid for is not the long run taken well.
  assert.equal(shown.long_km, 12.9);

  const peak = peakOf(raceBuild(TODAY).weeks);
  assert.ok(peak.km < clean, `harmed peak ${peak.km} vs clean ${clean}`);
});

test("harm on the week just closed: no resume through it", () => {
  seedAthlete();
  // The morning after the lighter week's long run read rest-grade.
  repo.upsertGarminDailyMetric({ date: "2031-09-29", training_readiness: 1 });
  assert.equal(closedWeekRunHarm(SUNDAY_BEFORE)?.kind, "readiness_rest_grade");
  const plan = repo.weeklyRunPlan(TODAY, { adjustToday: false });
  const resume = RUN_CAPACITY_RESUME_VARIANTS.map((say) => say(33).slice(0, 20));
  assert.ok(!plan.rationale.some((line) => resume.some((head) => line.startsWith(head))), plan.rationale.join(" | "));
});

test("harm read on a trip is the trip: it never lowers the floor", () => {
  seedAthlete();
  repo.addContextEvent({ kind: "trip", title: "Work trip", start_date: "2031-09-20", end_date: "2031-09-23" });
  repo.upsertGarminDailyMetric({ date: "2031-09-22", training_readiness: 1 });
  const shown = demonstratedRunCapacity(SUNDAY_BEFORE);
  assert.equal(shown.floor_km, 32.5, "the morning the trip spoke for is not charged to the running");
  assert.deepEqual(shown.set_aside, []);
});

test("the build's own milestone long run is its dose, not harm", () => {
  seedAthlete();
  // One step past the 17.7 km taken well, on the stated long day: the dose.
  run("2031-10-05", 19.4);
  assert.equal(harmEvidenceOnDay("2031-10-05"), null);
  // Past the 20 km ceiling the milestone never reaches: still news about the body.
  run("2031-10-12", 22);
  assert.equal(harmEvidenceOnDay("2031-10-12")?.kind, "longest_run");
});

test("harm already in this week: the ladder does not resume next week through it", () => {
  const walk = (currentWeekHarmed) =>
    projectRaceBuildWeeks(goal, TODAY, 17, 8, { km: 17, long_km: 8 }, null, {
      priorWeekKm: 17,
      closedWeeksKm: [20.5, 23.4, 32.5, 17],
      demonstratedLongKm: 17.7,
      demonstratedWeekKm: 32.5,
      bestWeekKm: 32.5,
      currentWeekHarmed,
    });
  const clean = walk(false);
  const harmed = walk(true);
  // Clean, next week resumes toward the 32.5 km already run well (as far as the ACWR
  // ceiling of the month before it allows: 1.4 × 22.5 = 31.5)…
  assert.equal(clean[1].km, 31.5);
  // …with harm already in this week, it takes an ordinary step off this week instead.
  assert.ok(harmed[1].km <= Math.round(17 * 1.12 * 10) / 10 + 0.05, `${harmed[1].km}`);
  // Only that one rung: the floor itself still stands for the weeks after.
  assert.equal(harmed.at(-1).kind, "race");
});

test("the engine's race-feasibility sentence reads the ladder's own peak — one walk, one number", () => {
  // The live disagreement: the ladder resumed toward the demonstrated floor and peaked
  // high, while the engine's sentence walked raceRamp's own path off the lighter week
  // and said the build lands far lower. Both now read raceLadderFor.
  seedAthlete();
  const peak = peakOf(raceBuild(TODAY).weeks);
  const plan = repo.weeklyRunPlan(TODAY, { adjustToday: false });
  assert.equal(plan.goal_feasibility.constrained_peak_km, peak.km);
  const ramp = raceRamp(goal, "2031-09-29", 17, 12.9, null, { week_km: 32.5, long_km: 17.7 });
  assert.notEqual(
    Math.round(ramp.constrained_peak_km),
    Math.round(peak.km),
    "raceRamp's own walk would have said another number"
  );
  const landing = plan.rationale.find((line) =>
    /by race day|come race day|race day arrives|lands near|shaping up|heads toward|tracking close|Not far off/.test(
      line
    )
  );
  if (plan.goal_feasibility.status !== "fits") {
    assert.ok(landing, plan.rationale.join(" | "));
    assert.match(landing, new RegExp(`\\b${Math.round(peak.km)}\\b`));
  } else {
    assert.equal(landing, undefined, "a build that reaches the demand needs no sentence");
  }
});
