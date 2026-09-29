// The race build and the plan week sized to the person (src/repo/race-build.ts,
// src/domain/training/plan-week.ts). Four athletes, one read each:
//   (a) lifting-only — no endurance goal, no run days, no runs: `running: "none"`, no
//       ladder, no leg map, no week of runs; the plan week holds lifts only.
//   (b) a runner with no race — `running: "runs"`: the running week and the closed
//       weeks still read (the route asks with `describeRunning`), never a ladder.
//   (c) endurance-only with a race — no strength plan: the ladder with no lifting
//       lines, a leg map with runs and no lift column, and a plan week of runs on the
//       calendar (never an empty strip or a "say which weekdays you lift" nudge).
//   (d) the hybrid with a race — every week says how the lifts and runs fit, in words,
//       and every week carries its one coaching sentence.
// Plus the pure pieces: weekFocus / weekFocusShort and liftingLine.
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { repo, resetTables } from "./_seed.js";
import { liftingLine, qualityWeekFocus, raceBuild, weekFocus, weekFocusShort } from "../dist/repo/race-build.js";
import { planWeek } from "../dist/domain/training/plan-week.js";

const TODAY = "2026-09-16"; // a Wednesday
const RACE = "2026-11-08"; // a Sunday, eight weeks out
const HALF = 21.1;

beforeEach(() => {
  resetTables(
    "logged_sets",
    "sessions",
    "activities",
    "garmin_activities",
    "garmin_daily_metrics",
    "exercises",
    "plan_items",
    "plan_days",
    "program_blocks",
    "app_state",
    "profile"
  );
});

const shift = (iso, n) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * 864e5).toISOString().slice(0, 10);
const SCORE = /\b(score|grade|must|failing|\d+\s*%)\b/i;

function seedRuns() {
  // Five closed weeks of Tue / Thu / Sun running before the as-of's week.
  const monday = "2026-09-14";
  for (let wk = 1; wk <= 5; wk++) {
    const mon = shift(monday, -7 * wk);
    repo.addActivity({ type: "run", duration_min: 40, distance_km: 7, date: shift(mon, 1) });
    repo.addActivity({ type: "run", duration_min: 45, distance_km: 8, date: shift(mon, 3) });
    repo.addActivity({ type: "run", duration_min: 80, distance_km: 13, date: shift(mon, 6) });
  }
  // This week, Monday's easy run is already in.
  repo.addActivity({ type: "run", duration_min: 35, distance_km: 6, date: "2026-09-14" });
}

function seedRunDays() {
  repo.setProfile({
    endurance_schedule: {
      days: [
        { dow: 2, kind: "easy" },
        { dow: 4, kind: "quality" },
        { dow: 0, kind: "long" },
      ],
      source: "athlete",
      updated_at: TODAY,
    },
  });
}

function seedLifting() {
  repo.replacePlan([
    {
      day_number: 1,
      name: "Push",
      items: [{ exercise: "Barbell Bench Press", sets: 3, rep_low: 6, rep_high: 8, target_weight: 185 }],
    },
    {
      day_number: 2,
      name: "Pull",
      items: [{ exercise: "Seated Cable Row", sets: 3, rep_low: 8, rep_high: 12, target_weight: 120 }],
    },
    {
      day_number: 3,
      name: "Lower A",
      items: [{ exercise: "Barbell Back Squat", sets: 4, rep_low: 4, rep_high: 6, target_weight: 225 }],
    },
    {
      day_number: 4,
      name: "Upper",
      items: [{ exercise: "Overhead Press", sets: 3, rep_low: 6, rep_high: 8, target_weight: 95 }],
    },
    {
      day_number: 5,
      name: "Lower B",
      items: [{ exercise: "Romanian Deadlift", sets: 3, rep_low: 6, rep_high: 8, target_weight: 205 }],
    },
  ]);
  repo.setProfile({
    strength_schedule: { days: [1, 2, 3, 4, 5].map((dow) => ({ dow })), source: "athlete", updated_at: TODAY },
  });
}

function seedRace() {
  repo.setProfile({
    age: 40,
    sex: "male",
    primary_discipline: "hybrid",
    endurance_sport: "running",
    endurance_goal: { mode: "race", event: "Harbor Half", date: RACE, distance_km: HALF, target: "sub-2:00" },
  });
}

// ---------------------------------------------------------------------------
// (a) lifting-only
// ---------------------------------------------------------------------------

test("(a) lifting-only: no running at all — no ladder, no leg map, no run week, and the plan week holds lifts only", () => {
  seedLifting();
  const out = raceBuild(TODAY, { describeRunning: true });
  assert.equal(out.available, false);
  assert.equal(out.running, "none");
  assert.deepEqual(out.weeks, []);
  assert.deepEqual(out.leg_map, []);
  assert.equal(out.this_week, null);
  assert.deepEqual(out.review.weeks, [], "no closed weeks to show a lifter");
  assert.equal(out.prediction, null);
  const week = planWeek(TODAY);
  assert.equal(week.days.length, 7);
  assert.ok(
    week.days.every((d) => d.run == null),
    "no run column on a lifter's week"
  );
  assert.ok(week.days.some((d) => d.plan_day?.role === "strength"));
});

// ---------------------------------------------------------------------------
// (b) a runner with no race
// ---------------------------------------------------------------------------

test("(b) a runner with no race: the running week and the closed weeks, never a ladder or an estimate", () => {
  seedRunDays();
  seedRuns();
  const out = raceBuild(TODAY, { describeRunning: true });
  assert.equal(out.available, false);
  assert.equal(out.running, "runs");
  assert.deepEqual(out.weeks, [], "no race, no ladder");
  assert.equal(out.prediction, null, "no race, no finish estimate");
  assert.ok(out.this_week, "the running week still reads");
  assert.ok(out.this_week.km > 0);
  assert.equal(out.this_week.logged_km, 6);
  assert.equal(out.review.weeks.length, 4);
  assert.ok(out.review.weeks.every((w) => w.km > 0));
  assert.match(out.reason, /No dated race/);
  // The internal callers never pay for the run week, or for the read of whether the
  // athlete runs at all: without describeRunning both stay unread.
  const internal = raceBuild(TODAY);
  assert.equal(internal.running, null);
  assert.equal(internal.this_week, null);
  assert.deepEqual(internal.review.weeks, []);
});

test("(b) running is the log too: runs with no stated days and no goal still read as a runner", () => {
  seedRuns();
  assert.equal(raceBuild(TODAY, { describeRunning: true }).running, "runs");
});

// ---------------------------------------------------------------------------
// (c) endurance-only with a race
// ---------------------------------------------------------------------------

test("(c) endurance-only with a race: the ladder with no lifting lines and no lift column in the leg map", () => {
  seedRace();
  seedRunDays();
  seedRuns();
  const out = raceBuild(TODAY, { describeRunning: true });
  assert.equal(out.available, true, out.reason);
  assert.equal(out.running, "race");
  assert.ok(out.weeks.length > 2);
  assert.ok(
    out.weeks.every((w) => w.with_lifting === ""),
    "nothing to fit lifting around"
  );
  assert.ok(
    out.weeks.every((w) => w.focus && w.focus_short),
    "every week still has its focus"
  );
  assert.equal(out.leg_map.length, 7);
  assert.ok(
    out.leg_map.every((d) => d.strength == null),
    "no lift column"
  );
  assert.ok(
    out.leg_map.some((d) => d.run),
    "the runs are on the ring"
  );
});

test("(c) endurance-only: the plan week is the running week on the calendar, never an empty strip", () => {
  seedRace();
  seedRunDays();
  seedRuns();
  const week = planWeek(TODAY);
  assert.equal(week.days.length, 7, "Mon–Sun, the calendar");
  assert.ok(
    week.days.every((d) => d.plan_day == null),
    "no lift scaffold on any day"
  );
  assert.ok(
    week.days.some((d) => d.run),
    "the runs sit on their days"
  );
  assert.equal(week.days[0].date, "2026-09-14");
  assert.equal(week.days[0].run?.status, "completed", "Monday's logged run owns its cell");
  // Never the lifter's nudge to name lifting weekdays.
  assert.doesNotMatch(String(week.summary || ""), /weekdays you lift/);
});

test("(c) an empty profile is still an empty week (nothing planned, nothing run)", () => {
  const week = planWeek(TODAY);
  assert.deepEqual(week.days, []);
});

// ---------------------------------------------------------------------------
// (d) the hybrid with a race
// ---------------------------------------------------------------------------

test("(d) hybrid with a race: every week says how lifts and runs fit, and carries its coaching sentence", () => {
  seedRace();
  seedRunDays();
  seedLifting();
  seedRuns();
  const out = raceBuild(TODAY, { describeRunning: true });
  assert.equal(out.available, true, out.reason);
  assert.equal(out.running, "race");
  assert.ok(out.leg_map.some((d) => d.strength) && out.leg_map.some((d) => d.run));
  for (const week of out.weeks) {
    assert.ok(week.with_lifting.length > 20, `${week.week_start} says how lifting fits`);
    assert.ok(week.focus.length > 20);
    assert.ok(week.focus_short.length > 3);
    for (const line of [week.with_lifting, week.focus, week.focus_short]) assert.doesNotMatch(line, SCORE);
  }
  const taper = out.weeks.find((w) => w.kind === "taper");
  const race = out.weeks.find((w) => w.kind === "race");
  assert.match(taper.with_lifting, /^Taper week: leg work stays on the card with fewer sets/);
  assert.match(race.with_lifting, /^Race week: heavy leg work sits out/);
  assert.match(race.focus, /strides/);
  // Engine vocabulary never reaches the athlete's words.
  for (const week of out.weeks) assert.doesNotMatch(week.focus, /phase|rung|ACWR|km\b/);
});

// ---------------------------------------------------------------------------
// the pure pieces
// ---------------------------------------------------------------------------

test("weekFocus: a turning point speaks by its kind, a build week by its phase", () => {
  assert.match(weekFocus("build", "base"), /easy running to grow the engine/);
  assert.match(weekFocus("build", "build"), /threshold or tempo/);
  assert.match(weekFocus("build", "sharpen"), /race-pace tempo/);
  assert.match(weekFocus("peak", "sharpen"), /biggest week/);
  assert.match(weekFocus("down", "build"), /lighter week on purpose/);
  assert.match(weekFocus("taper", "taper"), /Less volume/);
  assert.match(weekFocus("race", "taper"), /The work is done/);
  assert.equal(weekFocus("build", "past"), "");
  assert.equal(weekFocusShort("peak", "sharpen"), "Longest long run");
  assert.equal(weekFocusShort("build", "sharpen"), "Race-pace work");
});

const day = (n, weekday, run, strength) => ({
  day_number: n,
  weekday,
  run: run ? { kind: run, label: `${run} run`, km: 8 } : null,
  strength: strength ? { name: strength[0], heavy_lower: strength[1] } : null,
  ride: false,
  hard: false,
});

// The athlete's own ring: lifts Mon–Fri (Wed and Fri heavy legs), easy Tue, long Sun.
const ATHLETE_RING = [
  day(1, "Monday", null, ["Push", false]),
  day(2, "Tuesday", "easy", ["Pull", false]),
  day(3, "Wednesday", null, ["Lower A", true]),
  day(4, "Thursday", "easy", ["Upper Body & Arms", false]),
  day(5, "Friday", null, ["Lower B", true]),
  day(6, "Saturday", null, null),
  day(7, "Sunday", "long", null),
];

test("liftingLine: the eve of the long run, named where the stress budget trims it — and only there", () => {
  const sharpen = liftingLine({ kind: "build", phase: "sharpen" }, ATHLETE_RING);
  assert.equal(
    sharpen,
    "Lower B on Friday is the last lift before Sunday's long run: the main lift stands and the leg extras drop a set, so the legs arrive ready."
  );
  // The base phase is outside the stress budget's eve rule: both stay as written.
  assert.match(
    liftingLine({ kind: "build", phase: "base" }, ATHLETE_RING),
    /two days before Sunday's long run; both stay as written/
  );
  assert.match(liftingLine({ kind: "taper", phase: "taper" }, ATHLETE_RING), /^Taper week/);
  assert.match(liftingLine({ kind: "race", phase: "taper" }, ATHLETE_RING), /^Race week/);
});

test("liftingLine: the same day, clear spacing, no heavy legs, and nothing to fit", () => {
  const sameDay = ATHLETE_RING.map((d) => (d.day_number === 7 ? day(7, "Sunday", "long", ["Lower C", true]) : d));
  assert.match(
    liftingLine({ kind: "build", phase: "build" }, sameDay),
    /^Sunday carries both Lower C and the long run/
  );
  const clear = [
    day(1, "Monday", null, ["Lower A", true]),
    day(2, "Tuesday", null, ["Push", false]),
    day(4, "Thursday", "quality", null),
    day(6, "Saturday", "long", null),
  ];
  assert.equal(
    liftingLine({ kind: "build", phase: "build" }, clear),
    "Heavy legs on Monday sit clear of Saturday's long run and Thursday's quality run."
  );
  const light = [day(1, "Monday", null, ["Push", false]), day(7, "Sunday", "long", null)];
  assert.match(
    liftingLine({ kind: "peak", phase: "sharpen" }, light),
    /^No heavy leg day this week, so Sunday's long run gets fresh legs/
  );
  assert.equal(liftingLine({ kind: "build", phase: "build" }, [day(7, "Sunday", "long", null)]), "", "running only");
  assert.equal(
    liftingLine({ kind: "build", phase: "build" }, [day(1, "Monday", null, ["Push", false])]),
    "",
    "lifting only"
  );
  // A Monday key run's eve is the Sunday before it: the ring wraps.
  const wrap = [day(7, "Sunday", null, ["Lower A", true]), day(1, "Monday", "long", null)];
  assert.match(
    liftingLine({ kind: "build", phase: "build" }, wrap),
    /^Lower A on Sunday is the last lift before Monday's long run/
  );
});

test("liftingLine: a heavy lift on a key run's own day is said first, and a heavy eve before the long run still gets its line", () => {
  // The demo's ring: Lower B and the VO2 session share Thursday, Full Body on Friday
  // is the last lift before Sunday's long run.
  const ring = [
    day(1, "Monday", null, ["Upper A", false]),
    day(2, "Tuesday", "easy", ["Lower A", true]),
    day(3, "Wednesday", null, ["Upper B", false]),
    day(4, "Thursday", "quality", ["Lower B", true]),
    day(5, "Friday", null, ["Full Body", true]),
    day(6, "Saturday", null, null),
    day(7, "Sunday", "long", null),
  ];
  const line = liftingLine({ kind: "build", phase: "build" }, ring);
  assert.match(
    line,
    /^Thursday carries both Lower B and the quality run; give them as many hours apart as the day allows\. /
  );
  assert.match(line, /Full Body on Friday is the last lift before Sunday's long run: the main lift stands/);
  // Only the same-day collision: said alone.
  const onlySame = ring.map((d) => (d.day_number === 5 ? day(5, "Friday", null, ["Upper C", false]) : d));
  assert.equal(
    liftingLine({ kind: "build", phase: "build" }, onlySame),
    "Thursday carries both Lower B and the quality run; give them as many hours apart as the day allows."
  );
});

test("qualityWeekFocus: this week's sentence names the session the week holds", () => {
  assert.deepEqual(qualityWeekFocus("build", "build", "VO2 intervals"), {
    focus: "The weeks that make the fitness: VO2 intervals, and a long run that keeps stretching.",
    focus_short: "VO2 intervals and a longer long run",
  });
  assert.match(qualityWeekFocus("build", "base", "Hill repeats").focus, /with hill repeats to keep the legs sharp/);
  assert.match(qualityWeekFocus("build", "sharpen", "Cruise intervals").focus, /threshold work while the volume holds/);
  assert.equal(qualityWeekFocus("build", "build", "Tempo").focus_short, "A tempo run and a longer long run");
  // A turning point's sentence names no session; an unknown label keeps the phase's words.
  assert.equal(qualityWeekFocus("peak", "sharpen", "VO2 intervals"), null);
  assert.equal(qualityWeekFocus("down", "build", "Tempo"), null);
  assert.equal(qualityWeekFocus("build", "build", "Fartlek"), null);
});

test("(d) the current week's focus agrees with the quality run the week holds", () => {
  seedRace();
  seedRunDays();
  seedLifting();
  seedRuns();
  const out = raceBuild(TODAY, { describeRunning: true });
  const current = out.weeks.find((w) => w.current);
  const label = out.this_week?.quality?.label;
  assert.ok(label, "the seeded build week holds a quality run");
  assert.equal(current.kind, "build");
  const named = qualityWeekFocus(current.kind, current.phase, label);
  assert.ok(named, label);
  // This week's prescription is also bigger than any week on record, so the sentence
  // leads with that milestone — the session it names is unchanged.
  const expected = current.new_high
    ? `A new weekly high — ${named.focus[0].toLowerCase()}${named.focus.slice(1)}`
    : named.focus;
  assert.equal(current.focus, expected);
  assert.equal(current.focus_short, named.focus_short);
  // Never the phase's either/or once the week has chosen.
  assert.doesNotMatch(current.focus, /threshold or tempo/);
});
