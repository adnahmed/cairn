// The race page's week, actual first (live shape, 2026-10-04 — a Sunday).
//
// The athlete states Tue easy / Thu quality / Sun long, and this week ran:
//   Tue  9.68 km, 157 bpm, RPE 3        — the watch said LACTATE THRESHOLD
//   Wed  6.63 km, 149 bpm               — the watch said TEMPO, 11 min in its Z4
//   Fri  5.97 km "Hill Sprints", 149 bpm
//   Sat  an MTB ride (not a stated run day)
//   Sun 13.54 km, 151 bpm, RPE 3        — the morning had shortened the 10.7 long run to 8
// 35.8 km against a 19.5 km plan, after closed weeks of 10.9 / 23.4 / 32.5 / 19.5.
//
// The rules held here:
//   1. a run is graded by the athlete's stated effort, then his personal HR model and his
//      own title — the watch only as the fallback (run-intensity.ts);
//   2. a run that closed no intention rides out as an extra, never vanishes;
//   3. the week reads actual first, and a run is never labelled "shorter" when it ran
//      longer than both the plan and the morning's call;
//   4. a week whose running is done closes early on its Sunday, and the ladder reads it
//      today exactly as Monday's engine will — no hold or rule of the ladder's own, and
//      the engine's feasibility peak is the page's peak;
//   5. a server recap (headline + one line), held to the reading grammar — a harmed new
//      high is a big week that asked a lot, never celebrated;
//   6. a peak within ~5% of the biggest week is said as about it, never a new high;
//   7. one adapted sentence when the ladder moved because of this week, naming only
//      rungs the ladder draws.
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { db, repo, resetTables } from "./_seed.js";
import { recordCalibrationEvent } from "../dist/repo/calibration.js";
import {
  adaptedLine,
  markNewHighs,
  projectRaceBuildWeeks,
  raceBuild,
  raceWeekRuns,
  weekRecap,
} from "../dist/repo/race-build.js";
import { flexibleTrainingAgenda, plannedRunLine } from "../dist/repo/flexible-training-agenda.js";
import { weeklyRunPlan } from "../dist/repo/run-progression.js";
import { currentWeekClosedEarly } from "../dist/repo/week-layout-closed.js";
import { violatesReadingGrammar } from "../dist/repo/day-read-grammar.js";

const MONDAY = "2026-09-28";
const TUE = "2026-09-29";
const WED = "2026-09-30";
const THU = "2026-10-01";
const FRI = "2026-10-02";
const SAT = "2026-10-03";
const SUN = "2026-10-04";
const NEXT_MON = "2026-10-05";
const RACE = "2026-11-01";
const HALF = 21.1;

const shift = (iso, days) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 864e5).toISOString().slice(0, 10);

beforeEach(() => {
  resetTables(
    "logged_sets",
    "sessions",
    "activities",
    "garmin_activities",
    "garmin_daily_metrics",
    "garmin_sources",
    "calibration_events",
    "hr_model_state",
    "exercises",
    "plan_items",
    "plan_days",
    "daily_metrics",
    "program_blocks",
    "plan_proposals",
    "app_state",
    "profile",
    "context_events"
  );
});

let seq = 0;
function watch({ date, type = "running", name = "Cambridge Running", km, minutes, avgHr, te = 3, label = null, zones = null, rpe = null }) {
  seq += 1;
  repo.upsertGarminActivity({
    external_id: `awf-${seq}`,
    date,
    type,
    name,
    duration_min: minutes,
    moving_min: minutes,
    distance_km: km,
    avg_hr: avgHr,
    max_hr: 176,
    aerobic_te: te,
    training_effect: te,
    te_label: label,
    training_load: 120,
    hr_zones: zones,
  });
  const id = db
    .prepare(`SELECT a.id FROM activities a JOIN garmin_activities g ON g.activity_id = a.id WHERE g.external_id = ?`)
    .get(`awf-${seq}`).id;
  if (rpe != null) db.prepare(`UPDATE activities SET rpe = ? WHERE id = ?`).run(rpe, id);
  return id;
}

// The owner's model: a field-tested threshold of 167 → easy ceiling 151, steady top
// 157, threshold top 165. Basis runs well back, so none is a "longest run" first.
function fieldTestedModel() {
  for (const days of [60, 70, 80, 90]) watch({ date: shift(SUN, -days), km: 14, minutes: 80, avgHr: 145 });
  recordCalibrationEvent({ kind: "lthr_tt", date: shift(SUN, -30), target_key: "lthr", result: { lthr: 167 }, source: "stated" });
}

function statedRunDays() {
  repo.setProfile({
    endurance_schedule: {
      days: [
        { dow: 2, kind: "easy" },
        { dow: 4, kind: "quality" },
        { dow: 0, kind: "long" },
      ],
      source: "athlete",
      updated_at: SUN,
    },
  });
}

function race() {
  repo.setProfile({
    age: 40,
    sex: "male",
    primary_discipline: "hybrid",
    endurance_sport: "running",
    endurance_goal: { mode: "race", event: "Cambridge Half", date: RACE, distance_km: HALF, target: "sub-2:00" },
  });
}

// The four closed weeks before: 10.9 / 23.4 / 32.5 / 19.5, all easy running.
function priorWeeks() {
  const weeks = [
    ["2026-08-31", [5.4, 5.5]],
    ["2026-09-07", [7, 6.4, 10]],
    ["2026-09-14", [10, 9, 13.5]],
    ["2026-09-21", [5.5, 5.5, 8.5]],
  ];
  for (const [monday, kms] of weeks) {
    const days = [1, 3, 6]; // Tue, Thu, Sun
    kms.forEach((km, i) => watch({ date: shift(monday, days[i]), km, minutes: Math.round(km * 6.3), avgHr: 145 }));
  }
}

const ids = {};
function thisWeek() {
  ids.tue = watch({ date: TUE, km: 9.68, minutes: 53.9, avgHr: 157, te: 4.5, label: "LACTATE_THRESHOLD", rpe: 3 });
  ids.wed = watch({
    date: WED,
    km: 6.63,
    minutes: 39.9,
    avgHr: 149,
    te: 3.6,
    label: "TEMPO",
    // Garmin's own bins: its Z4 floor (158) sits under his threshold top (165).
    zones: [
      { zone: 3, secs: 25 * 60, low_hr: 150 },
      { zone: 4, secs: 11 * 60, low_hr: 158 },
    ],
  });
  ids.fri = watch({ date: FRI, name: "Hill Sprints", km: 5.97, minutes: 39.3, avgHr: 149, te: 3.2 });
  watch({ date: SAT, type: "mountain_biking", name: "Cambridge Mountain Biking", km: 31.2, minutes: 142.3, avgHr: 137, te: 4 });
  ids.sun = watch({ date: SUN, km: 13.54, minutes: 83.8, avgHr: 151, te: 4.3, label: "TEMPO", rpe: 3 });
}

function prescription(day_number, kind, km, label) {
  return {
    day_number,
    label,
    kind_label: kind,
    target_distance_km: km,
    target_duration_min: null,
    target_zone: kind === "quality" ? "Z4 (158–165 bpm)" : "Z2 (143–149 bpm)",
    note: null,
    day_name: label,
    focus: "Endurance",
    interval: null,
  };
}

// The live week: the long run the morning shortened from 10.7 to 8.
function liveWeekPlan() {
  const planned = [
    prescription(2, "easy", 4.8, "Easy run"),
    prescription(4, "quality", 4, "Short threshold"),
    prescription(7, "long", 10.7, "Long run"),
  ];
  return {
    available: true,
    week_start: MONDAY,
    runs: [planned[0], planned[1], { ...planned[2], label: "Long run · shorter", day_name: "Long run · shorter", target_distance_km: 8, planned_kind_label: "long" }],
    planned_runs: planned,
    rationale: [],
    quality_focus: "Short threshold",
    mix_summary: "1 easy + 1 long + 1 short threshold",
    why: "~20 km this week.",
    goal_feasibility: null,
    today_adjustment: {
      date: SUN,
      planned_kind: "long",
      planned_dose: "full",
      locks: [],
      kind: "long",
      dose: "shortened",
      target_distance_km: 8,
      reason_code: "floor:hrv_below_own_band",
      supports: [],
      brakes: ["hrv_below_own_band"],
      floors: ["hrv_below_own_band"],
      athlete_word: null,
      changed: true,
      why: "A shorter, easy long run today.",
    },
  };
}

function seedLive() {
  fieldTestedModel();
  statedRunDays();
  priorWeeks();
  thisWeek();
}

// ── 1 + 2 + 3: the agenda grades by the law, keeps the extra, names the run honestly ──

test("the week is graded by his word and his model: Friday's hill sprints are the quality run, Wednesday is the extra", () => {
  seedLive();
  const agenda = flexibleTrainingAgenda(SUN, { runPlan: liveWeekPlan() });
  const byKind = Object.fromEntries(agenda.intents.map((i) => [i.kind, i]));
  assert.equal(byKind.quality.status, "completed");
  assert.equal(byKind.quality.completion.activity_id, ids.fri, "the titled hill sprints close the quality slot");
  assert.equal(byKind.quality.completion.intensity_word, "hard");
  assert.equal(byKind.quality.completion.intensity_basis, "personal_model");
  assert.equal(byKind.quality.completion.title, "Hill Sprints");
  assert.equal(byKind.easy.completion.activity_id, ids.tue, "Tuesday, stated easy, closes the easy slot");
  assert.equal(byKind.easy.completion.intensity, "easy");
  assert.equal(byKind.easy.completion.intensity_basis, "stated_easy");
  assert.equal(byKind.long.completion.activity_id, ids.sun);
  assert.equal(byKind.long.completion.intensity, "easy", "the watch's TEMPO and training effect 4.3 never grade it");

  // Wednesday closed nothing — and is still the week's running.
  assert.deepEqual(
    agenda.extras.map((e) => e.activity_id),
    [ids.wed]
  );
  const wed = agenda.extras[0];
  assert.equal(wed.intensity, "easy", "149 bpm is under his own easy ceiling, whatever Garmin's Z4 bin says");
  assert.equal(wed.intensity_word, "easy");
  assert.equal(wed.pace_sec_per_km, Math.round((39.9 * 60) / 6.63));
  assert.ok(!wed.signals.some((s) => /watch effort|Z4\+/.test(s)), wed.signals.join(" | "));

  // The long run went past the morning's 8 km AND the week's 10.7: never "shorter".
  assert.equal(byKind.long.label, "Long run");
  assert.equal(byKind.long.planned_label, "Long run");
  assert.equal(byKind.long.planned_distance_km, 10.7);
  assert.equal(plannedRunLine(byKind.long), "Planned long run 10.7 km, shortened to 8 km this morning.");
});

test("a long run kept to the morning's shorter dose keeps the honest label", () => {
  fieldTestedModel();
  statedRunDays();
  watch({ date: SUN, km: 7.9, minutes: 50, avgHr: 145 });
  const agenda = flexibleTrainingAgenda(SUN, { runPlan: liveWeekPlan() });
  const long = agenda.intents.find((i) => i.kind === "long");
  assert.equal(long.status, "completed");
  assert.equal(long.label, "Long run · shorter");
});

test("a stated-easy run is easy with no heart rate at all, whatever the watch's label", () => {
  const id = repo.addActivity({ type: "run", date: TUE, duration_min: 40, distance_km: 7, rpe: 3 }).id;
  const source = db.prepare(`INSERT INTO garmin_sources (provider, label) VALUES ('garmin', 'stated')`).run();
  db.prepare(
    `INSERT INTO garmin_activities (source_id, external_id, activity_id, date, type, te_label, aerobic_te)
     VALUES (?, 'stated-run', ?, ?, 'running', 'TEMPO', 4.4)`
  ).run(source.lastInsertRowid, id, TUE);
  db.prepare(`UPDATE activities SET rpe = 3 WHERE id = ?`).run(id);
  const agenda = flexibleTrainingAgenda(WED, { runPlan: { ...liveWeekPlan(), today_adjustment: null, runs: liveWeekPlan().planned_runs } });
  const quality = agenda.intents.find((i) => i.kind === "quality");
  assert.equal(quality.status, "open", "the athlete's word outranks the watch's TEMPO");
  const easy = agenda.intents.find((i) => i.kind === "easy");
  assert.equal(easy.completion?.intensity_basis, "stated_easy");
});

test("with no usable personal model the watch's signals stay the documented fallback", () => {
  const id = repo.addActivity({ type: "run", date: TUE, duration_min: 40, distance_km: 7 }).id;
  const source = db.prepare(`INSERT INTO garmin_sources (provider, label) VALUES ('garmin', 'fallback')`).run();
  db.prepare(
    `INSERT INTO garmin_activities (source_id, external_id, activity_id, date, type, te_label, aerobic_te, avg_hr)
     VALUES (?, 'fallback-run', ?, ?, 'running', 'TEMPO', 3.2, 162)`
  ).run(source.lastInsertRowid, id, TUE);
  const agenda = flexibleTrainingAgenda(WED, { runPlan: { ...liveWeekPlan(), today_adjustment: null, runs: liveWeekPlan().planned_runs } });
  const quality = agenda.intents.find((i) => i.kind === "quality");
  assert.equal(quality.completion?.intensity_basis, "watch");
  assert.equal(quality.completion?.intensity_word, "hard");
});

test("the race page's week lists every run actual first, the extra included", () => {
  seedLive();
  const agenda = flexibleTrainingAgenda(SUN, { runPlan: liveWeekPlan() });
  const runs = raceWeekRuns(agenda);
  assert.deepEqual(
    runs.map((r) => [r.weekday, r.extra, r.kind, r.intensity_word]),
    [
      ["Tuesday", false, "easy", "easy"],
      ["Wednesday", true, null, "easy"],
      ["Friday", false, "quality", "hard"],
      ["Sunday", false, "long", "easy"],
    ]
  );
  const sun = runs.at(-1);
  assert.equal(sun.actual_line, "13.5 km · 6:11/km · easy");
  assert.equal(sun.plan_line, "Planned long run 10.7 km, shortened to 8 km this morning.");
  assert.deepEqual(sun.planned, { kind: "long", label: "Long run", km: 10.7 });
  assert.equal(sun.adjustment, "shortened to 8 km this morning");
  assert.equal(sun.intensity, "easy");
  assert.equal(runs[2].intensity, "quality");
  assert.equal(runs[1].planned, null);
  assert.equal(sun.stated_easy, true);
  assert.match(runs[1].plan_line, /extra run/i);
  assert.equal(runs[2].title, "Hill Sprints");
});

// ── 4: the week closes early ──

test("the week closes early once no stated run day is left and the last one is run — never mid-week, never without a calendar", () => {
  seedLive();
  assert.deepEqual(currentWeekClosedEarly(SUN), { closed: true, reason: "last_run_day_logged", last_run_day: SUN });
  // Saturday: Sunday's long run is still ahead.
  assert.equal(currentWeekClosedEarly(SAT).closed, false);
  assert.equal(currentWeekClosedEarly(THU).closed, false);
  // No stated calendar: nothing says the running is over.
  repo.setProfile({ endurance_schedule: { days: [], source: "athlete", updated_at: SUN } });
  assert.equal(currentWeekClosedEarly(SUN).closed, false);
});

test("a Tue/Thu week does not close on Thursday: its last run's next morning is not on record yet", () => {
  repo.setProfile({
    endurance_schedule: {
      days: [
        { dow: 2, kind: "easy" },
        { dow: 4, kind: "long" },
      ],
      source: "athlete",
      updated_at: SUN,
    },
  });
  watch({ date: TUE, km: 6, minutes: 38, avgHr: 145 });
  watch({ date: THU, km: 10, minutes: 64, avgHr: 145 });
  // Thursday after the run, then Friday and Saturday: still open — never counted as a
  // closed, harm-free week before the mornings after it exist.
  for (const day of [THU, FRI, SAT]) assert.equal(currentWeekClosedEarly(day).closed, false, day);
  // Sunday: the week's last day, Thursday's next morning long on record.
  assert.deepEqual(currentWeekClosedEarly(SUN), { closed: true, reason: "last_run_day_logged", last_run_day: THU });
});

test("every intention completed closes the week on its last stated day even before that run", () => {
  statedRunDays();
  const agenda = {
    available: true,
    intents: [{ status: "completed" }, { status: "completed" }],
    extras: [],
  };
  // Sunday, nothing logged on it yet, but the week's intentions are all in.
  assert.deepEqual(currentWeekClosedEarly(SUN, { agenda }), { closed: true, reason: "every_intent_done", last_run_day: SUN });
  assert.equal(currentWeekClosedEarly(SUN, { agenda: { ...agenda, intents: [{ status: "open" }] } }).closed, false);
});

// ── 4 + 6: the walk steps off the closed week as run, and the peak is said honestly ──

test("a closed week is stepped off as run: the engine's next week stands, and no rung is held", () => {
  const goal = { is_race: true, date: RACE, distance_km: HALF, target: "sub-2:00" };
  const weeks = projectRaceBuildWeeks(goal, SUN, 35.8, 13.5, { km: 35.8, long_km: 13.5 }, { km: 32.1, long_km: 16.8 }, {
    priorWeekKm: 19.5,
    closedWeeksKm: [10.9, 23.4, 32.5, 19.5],
    demonstratedLongKm: 13.5,
    demonstratedWeekKm: 32.5,
    bestWeekKm: 32.5,
  });
  assert.equal(weeks[0].km, 35.8, "the current rung is the week as run");
  assert.equal(weeks[1].km, 32.1, "the engine's own next week is its own, never touched");
  // The current rung is the jump itself, a new high against 32.5.
  assert.equal(weeks[0].new_high, true);
  assert.ok(weeks.every((w) => !("held" in w)), "the ladder has no hold of its own");
});

test("a peak half a kilometre either side of the biggest week is about it; one well past is a new high", () => {
  const rung = (km) => ({ kind: "peak", phase: "sharpen", km, focus: "x", focus_short: "x", new_high: false, current: false });
  for (const km of [35.3, 36.3, 37.4]) {
    const near = [rung(km)];
    markNewHighs(near, 35.8);
    assert.equal(near[0].new_high, false, `${km}`);
    assert.equal(near[0].holds_high, true, `${km}`);
    assert.equal(near[0].focus_short, "About your biggest week");
    // Said either side of the week, so never "rather than passing it" beside a figure that passes it.
    assert.doesNotMatch(near[0].focus, /passing|holds your biggest/i);
  }
  const far = [rung(40)];
  markNewHighs(far, 35.8);
  assert.equal(far[0].new_high, true);
  assert.equal(far[0].focus_short, "A new weekly high");
});

// ── the whole read on the live shape ──

test("raceBuild on the live Sunday: the week closes, reads from 35.8 km, and says so", () => {
  seedLive();
  race();
  const build = raceBuild(SUN);
  assert.equal(build.available, true);
  const tw = build.this_week;
  assert.ok(tw, "this week reads");
  assert.equal(tw.closed, true);
  assert.equal(tw.closed_reason, "last_run_day_logged");
  assert.equal(tw.logged_km, 35.8);
  assert.equal(tw.runs.length, 4);
  assert.deepEqual(
    tw.runs.filter((r) => r.extra).map((r) => r.activity_id),
    [ids.wed]
  );

  // The ladder: this week is the week as run.
  const current = build.weeks.find((w) => w.current);
  assert.equal(current.closed, true);
  assert.equal(current.km, 35.8);
  assert.equal(current.planned_km, tw.km);
  const peak = build.weeks.find((w) => w.kind === "peak");
  if (peak && Math.abs(peak.km - 35.8) <= 35.8 * 0.05) {
    assert.equal(peak.new_high, false, "a peak within 5% of the week just run is not a new high");
    assert.equal(peak.holds_high, true);
  }

  // The closed week is in the review and the capacity read today, not next Monday.
  assert.equal(build.review.includes_this_week, true);
  assert.deepEqual(build.review.weeks.at(-1), { week_start: MONDAY, km: 35.8, runs: 4 });
  assert.equal(build.capacity.best_week_km, 35.8);

  // One calm adapted sentence, and the recap — both in the reading grammar. Friday's hill
  // sprints were the week's quality session, moved a day on purpose: a moved key run is
  // the planned run (2026-10-04, closedRunIntentOn), never harm, so nothing in the week
  // is set aside and the recap may say what the week was.
  assert.equal(build.capacity.note, "");
  assert.deepEqual(build.capacity.set_aside, []);
  assert.match(build.adapted, /35\.8 km/);
  assert.doesNotMatch(build.adapted, /two weeks|fortnight|climbs again/);
  assert.ok(tw.headline && tw.detail, "a recap once runs are in");
  assert.doesNotMatch(tw.headline, /asked a lot|body felt it|still answering/i);
  assert.match(tw.detail, /35\.8 km/);
  assert.match(tw.detail, /three easy and one hard/);
  assert.match(tw.detail, /long run in/);
  for (const line of [build.adapted, tw.headline, tw.detail, ...tw.runs.flatMap((r) => [r.actual_line, r.plan_line, r.adjustment ?? ""])]) {
    assert.equal(violatesReadingGrammar(line), null, line);
    assert.doesNotMatch(line, /\bscore|\bgrade|you must/i, line);
  }
});

test("the ladder read the Sunday a week closes is the ladder Monday's engine walks, and the engine names the same peak", () => {
  seedLive();
  race();
  const sunday = raceBuild(SUN);
  const monday = raceBuild(NEXT_MON);
  // Every rung ahead, by kind and km (Monday's current rung then words its focus from the
  // engine's own session for the week, which a projected rung cannot know).
  const ahead = (build) => build.weeks.filter((w) => w.week_start >= NEXT_MON).map((w) => [w.week_start, w.kind, w.km]);
  assert.deepEqual(ahead(sunday), ahead(monday));
  const peakWords = (build) => build.weeks.find((w) => w.kind === "peak")?.focus_short;
  assert.equal(peakWords(sunday), peakWords(monday));
  // The run engine's feasibility sentence reads the same walk, the closed week included.
  const peak = sunday.weeks.find((w) => w.kind === "peak");
  assert.ok(peak);
  assert.equal(weeklyRunPlan(SUN).goal_feasibility?.constrained_peak_km, peak.km);
});

test("mid-week the week stays open: the ladder walks from the prescription and nothing is adapted", () => {
  seedLive();
  race();
  const build = raceBuild(FRI);
  assert.equal(build.this_week.closed, false);
  assert.equal(build.adapted, "");
  assert.notEqual(build.review.includes_this_week, true);
  const current = build.weeks.find((w) => w.current);
  assert.notEqual(current.closed, true);
  assert.match(build.this_week.headline, /under way|taking shape|so far|biggest|new high|more running/i);
});

// ── 5 + 7: the pure sentences ──

test("the recap speaks the week, never scores it", () => {
  const runs = (...words) => words.map((intensity_word) => ({ intensity_word }));
  const big = weekRecap(
    { logged_km: 35.8, planned_km: 19.5, runs: runs("easy", "easy", "hard", "easy"), closed: true, long_done: true, long_planned: true, best_before_km: 32.5 },
    SUN
  );
  assert.match(big.headline, /biggest|new high|more running/i);
  assert.match(big.detail, /well past the 19\.5 km planned/);
  // What the ladder does next is the adapted sentence's, never the recap's too.
  assert.doesNotMatch(big.detail, /weeks ahead|hold/);

  const asked = weekRecap(
    { logged_km: 35.8, planned_km: 19.5, runs: runs("easy", "easy", "hard", "easy"), closed: true, long_done: true, long_planned: true, best_before_km: 32.5, harmed: true },
    SUN
  );
  assert.match(asked.headline, /asked a lot|body felt it|still answering/i);
  assert.doesNotMatch(asked.headline, /biggest week yet|new high/i);

  const allHard = weekRecap(
    { logged_km: 22, planned_km: 21, runs: runs("hard", "hard", "hard"), closed: true, long_done: true, long_planned: true, best_before_km: 32.5 },
    SUN
  );
  assert.match(allHard.detail, /every run on the hard side/);
  assert.match(allHard.detail, /easy days stay easy/);
  assert.match(allHard.headline, /work is in|the week, done|the week is in/i);

  const lighter = weekRecap(
    { logged_km: 12, planned_km: 21, runs: runs("easy", "easy"), closed: true, long_done: false, long_planned: true, best_before_km: 32.5 },
    SUN
  );
  assert.match(lighter.headline, /lighter|quieter/i);
  assert.match(lighter.detail, /no long run this time/);

  assert.equal(
    weekRecap({ logged_km: 0, planned_km: 20, runs: [], closed: false, long_done: false, long_planned: true, best_before_km: 30 }, SUN),
    null
  );
  for (const date of [SUN, shift(SUN, 1), shift(SUN, 2)]) {
    const h = weekRecap(
      { logged_km: 35.8, planned_km: 19.5, runs: runs("easy", "hard"), closed: true, long_done: true, long_planned: true, best_before_km: 32.5, harmed: true },
      date
    ).headline;
    assert.equal(violatesReadingGrammar(h), null, h);
  }
  for (const r of [big, asked, allHard, lighter])
    for (const line of [r.headline, r.detail]) assert.equal(violatesReadingGrammar(line), null, line);
});

test("the adapted sentence: re-read after a different week, the engine's next week after harm, silent when open or on plan", () => {
  const adapt = { closed: true, logged_km: 35.8, planned_km: 19.5, harmed: false, next_km: 32.1 };
  assert.match(adaptedLine(adapt, SUN), /35\.8 km/);
  assert.match(adaptedLine(adapt, SUN), /19\.5 km/);
  // After harm it names next week's own rung — only when that rung really does not climb past.
  const harmed = adaptedLine({ ...adapt, harmed: true }, SUN);
  assert.match(harmed, /next week (sits|stays) at 32\.1 km/);
  assert.doesNotMatch(harmed, /two weeks|fortnight|climbs again/);
  assert.doesNotMatch(adaptedLine({ ...adapt, harmed: true, next_km: 38 }, SUN), /next week (sits|stays)/);
  assert.equal(adaptedLine({ ...adapt, closed: false }, SUN), "");
  assert.equal(adaptedLine({ ...adapt, logged_km: 20 }, SUN), "");
  for (const date of [SUN, shift(SUN, 1), shift(SUN, 2)]) {
    assert.equal(violatesReadingGrammar(adaptedLine(adapt, date)), null);
    assert.equal(violatesReadingGrammar(adaptedLine({ ...adapt, harmed: true }, date)), null);
  }
});
