// Running capacity is judged by the RUNNING, and a week the body answered is a week
// carried (owner ruling 2026-09-29: "ground in best practices in coaching and pushing
// towards new peaks").
//
//   • only running-relevant harm sets a week aside: a lifting session rated under par on
//     a run day stays harm for every recovery read, but it never voids a running week;
//   • harm earlier in a week is cleared for capacity when a later key run that week (a
//     stated long or quality day) was taken without harm of its own and its next
//     morning spoke clean — silence never vouches;
//   • when a bigger week is still set aside, the plan says which one and why, in plain
//     words; with nothing set aside it says nothing.
//
// Synthetic fixtures mirroring the live shape (Tue easy / Thu quality / Sun long, a
// supporting runner with a dated half); no real data.
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { repo, resetTables } from "./_seed.js";
import { harmEvidenceOnDay } from "../dist/repo/brain/read-adherence.js";
import { raceBuild } from "../dist/repo/race-build.js";
import {
  capacitySetAsideLine,
  closedWeekRunHarm,
  demonstratedRunCapacity,
  setAsideReason,
} from "../dist/repo/run-capacity.js";
import { violatesReadingGrammar } from "../dist/repo/day-read-grammar.js";

const RACE = "2031-11-02";
const HALF = 21.1;
const TODAY = "2031-09-30"; // Tuesday of the week being planned
const SUNDAY_BEFORE = "2031-09-28";
const BIG_WEEK = "2031-09-15";
const BIG_QUALITY = "2031-09-18"; // Thursday of the big week
const BIG_LONG = "2031-09-21"; // its Sunday long run

beforeEach(() => {
  resetTables(
    "activities",
    "garmin_activities",
    "garmin_daily_metrics",
    "garmin_sources",
    "context_events",
    "sessions",
    "logged_sets",
    "plan_items",
    "plan_days",
    "program_blocks",
    "brain_decisions",
    "app_state",
    "profile"
  );
});

const run = (date, distance) =>
  repo.addActivity({ type: "run", duration_min: Math.round(distance * 6), distance_km: distance, date });

// Weeks (Mondays): 9/1 20.5 · 9/8 23.4 · 9/15 32.5 (the big week) · 9/22 17.0 (lighter).
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
    endurance_goal: { mode: "race", event: "City Half", date: RACE, distance_km: HALF, target: "sub-2:00" },
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
    [BIG_QUALITY, 9.9],
    [BIG_LONG, 17.7],
    ["2031-09-23", 4.0],
    ["2031-09-25", 5.0],
    ["2031-09-28", 8.0],
  ])
    run(date, km);
}

// ── domain-scoped harm ──────────────────────────────────────────────────────────

test("a lifting session rated under par on a run day never voids the running week", () => {
  seedAthlete();
  // A Push day lifted beside the Thursday run, rated under par (performance 2).
  repo.setSessionFeedback(BIG_QUALITY, { performance: 2 });
  // Recovery reads still see it: harm is unchanged for them.
  assert.equal(harmEvidenceOnDay(BIG_QUALITY)?.kind, "rated_poorly");
  // The running read does not.
  const shown = demonstratedRunCapacity(SUNDAY_BEFORE);
  assert.equal(shown.floor_km, 32.5);
  assert.deepEqual(shown.set_aside, []);
});

test("this week's lifting rated under par does not block next week's resume", () => {
  seedAthlete();
  run(TODAY, 5.0); // Tuesday easy, run
  repo.setSessionFeedback(TODAY, { performance: 2 }); // and a lift that went under par
  assert.equal(harmEvidenceOnDay(TODAY)?.kind, "rated_poorly");
  assert.equal(closedWeekRunHarm(TODAY), null, "the running this week carries no harm");
});

// ── the body answered ───────────────────────────────────────────────────────────

test("harm early in a week is cleared by a later long run taken well", () => {
  seedAthlete();
  // The morning after Thursday's quality run read rest-grade…
  repo.upsertGarminDailyMetric({ date: "2031-09-19", training_readiness: 1 });
  // …and the morning after Sunday's long run read clean.
  repo.upsertGarminDailyMetric({ date: "2031-09-22", training_readiness: 70 });
  // The Thursday stays harm for every recovery read.
  assert.equal(harmEvidenceOnDay(BIG_QUALITY)?.kind, "readiness_rest_grade");
  const shown = demonstratedRunCapacity(SUNDAY_BEFORE);
  assert.equal(shown.floor_km, 32.5, "the week the body answered is carried");
  assert.deepEqual(shown.set_aside, []);
  assert.deepEqual(
    shown.answered.map((a) => [a.week_start, a.harm.date, a.by]),
    [[BIG_WEEK, BIG_QUALITY, BIG_LONG]]
  );
});

test("a later long run with no morning after it has not answered yet", () => {
  seedAthlete();
  repo.upsertGarminDailyMetric({ date: "2031-09-19", training_readiness: 1 });
  // Nothing dated the Monday: silence never vouches.
  const shown = demonstratedRunCapacity(SUNDAY_BEFORE);
  assert.equal(shown.floor_km, 23.4);
  assert.equal(shown.set_aside[0]?.km, 32.5);
  assert.equal(shown.set_aside[0]?.harm.kind, "readiness_rest_grade");
});

test("a later long run the body paid for too clears nothing", () => {
  seedAthlete();
  repo.upsertGarminDailyMetric({ date: "2031-09-19", training_readiness: 1 });
  repo.upsertGarminDailyMetric({ date: "2031-09-22", training_readiness: 1 });
  const shown = demonstratedRunCapacity(SUNDAY_BEFORE);
  assert.equal(shown.floor_km, 23.4);
  assert.deepEqual(shown.answered, []);
});

// ── saying why ──────────────────────────────────────────────────────────────────

test("a set-aside week is said in plain words on the race build and the run plan", () => {
  seedAthlete();
  // The morning after the big week's long run read rest-grade: nothing later answers it.
  repo.upsertGarminDailyMetric({ date: "2031-09-22", training_readiness: 1 });
  const build = raceBuild(TODAY);
  assert.equal(build.capacity.floor_km, 23.4);
  assert.deepEqual(
    build.capacity.set_aside.map((w) => [w.week_start, w.km, w.kind]),
    [[BIG_WEEK, 32.5, "readiness_rest_grade"]]
  );
  const note = build.capacity.note;
  assert.match(note, /32\.5 km week/);
  assert.match(note, /23\.4 km week/);
  assert.match(note, /very low readiness morning after it/);
  assert.equal(violatesReadingGrammar(note), null);
  assert.doesNotMatch(note, /harm|score|\/100|rest_grade|physiology/i);

  const plan = repo.weeklyRunPlan(TODAY, { adjustToday: false });
  assert.ok(plan.rationale.includes(capacitySetAsideLine(demonstratedRunCapacity(SUNDAY_BEFORE), plan.week_start)));
});

test("nothing set aside, nothing said", () => {
  seedAthlete();
  const build = raceBuild(TODAY);
  assert.deepEqual(build.capacity.set_aside, []);
  assert.equal(build.capacity.note, "");
  assert.equal(capacitySetAsideLine({ set_aside: [], floor_km: 23.4 }, TODAY), "");
});

test("every reason reads as plain words, and the variants all hold the grammar", () => {
  const kinds = [
    { kind: "physiology_brake", detail: "hrv 34 below own band 41.8 on 2031-09-13" },
    { kind: "physiology_brake", detail: "resting hr 58 above own band 54.1 on 2031-09-13" },
    { kind: "readiness_rest_grade", detail: "readiness 12 on 2031-09-13" },
    { kind: "hard_cardio", detail: "cardio graded hard on intensity" },
    { kind: "longest_run", detail: "12.96 km vs 10.4 km best" },
    { kind: "rated_poorly", detail: "performance 2" },
  ];
  for (const harm of kinds) {
    const why = setAsideReason(harm);
    assert.doesNotMatch(why, /\d/, `${harm.kind}: no numbers from the body`);
    for (let d = 0; d < 6; d++) {
      const date = `2031-09-${String(20 + d).padStart(2, "0")}`;
      for (const floor of [23.4, null]) {
        const line = capacitySetAsideLine(
          {
            set_aside: [
              { week_start: BIG_WEEK, km: 32.5, harm: { date: BIG_LONG, ...harm } },
              { week_start: "2031-08-25", km: 27, harm: { date: "2031-08-27", ...harm } },
            ],
            floor_km: floor,
          },
          date
        );
        assert.equal(violatesReadingGrammar(line), null, line);
        assert.match(line, /32\.5 km/);
        assert.match(line, /One other bigger week is set aside too\.$/);
      }
    }
  }
});
