// A run is graded by the athlete's own heart-rate model, never the watch's.
//
// Owner law (2026-09-25): "Garmin te_label must never classify his runs; use the
// personal HR model." The hard-cardio read used to grade a run hard off Garmin's
// training effect ≥ 4, its te_label, time in Garmin's Z4, or its load against the
// median — so a 148-bpm treadmill run (effect 4.2, "LACTATE_THRESHOLD") and a
// conversational 157 (effect 4.5) both counted as harm. With a usable personal model a
// run is hard when:
//   • classifyRunEffort reads it as quality against his own zones;
//   • he NAMED it quality ("Hills", "5k+sprints", "5K Fast", "LT HR Test");
//   • 4+ minutes sat in heart-rate bins wholly above his threshold band.
// No model, or not a run: the old bars stand.
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { db, repo, resetTables } from "./_seed.js";
import { dayLoad, hardCardioDay, hardCardioDayIntense } from "../dist/repo/training-read.js";
import { recentEnduranceImpacts } from "../dist/repo/hybrid-load.js";
import { harmEvidenceOnDay } from "../dist/repo/brain/read-adherence.js";
import { recordCalibrationEvent } from "../dist/repo/calibration.js";
import { getHrModel } from "../dist/repo/hr-model.js";
import { namesQualityRun } from "../dist/repo/stated-effort.js";
import { OWN_RUN_BAR_CAP, runLengthBars } from "../dist/repo/run-intensity.js";
import { setActivityFeltEffort } from "../dist/repo/activity-effort.js";

const REF = "2031-06-30";
const shift = (iso, days) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 864e5).toISOString().slice(0, 10);

beforeEach(() => {
  resetTables(
    "activities",
    "garmin_activities",
    "garmin_daily_metrics",
    "garmin_sources",
    "calibration_events",
    "hr_model_state",
    "sessions",
    "profile"
  );
});

let seq = 0;
function watch({
  date,
  type = "running",
  name = "Cambridge Running",
  km = 8,
  minutes = 45,
  avgHr,
  maxHr = 176,
  te = 3,
  label = null,
  load = 100,
  zones = null,
}) {
  seq += 1;
  repo.upsertGarminActivity({
    external_id: `pri-${seq}`,
    date,
    type,
    name,
    duration_min: minutes,
    moving_min: minutes,
    distance_km: km,
    avg_hr: avgHr,
    max_hr: maxHr,
    aerobic_te: te,
    training_effect: te,
    te_label: label,
    training_load: load,
    hr_zones: zones,
  });
  return db
    .prepare(`SELECT a.id FROM activities a JOIN garmin_activities g ON g.activity_id = a.id WHERE g.external_id = ?`)
    .get(`pri-${seq}`).id;
}

// The owner's model: a field-tested threshold of 167 → steady top 157, threshold top 165.
// The basis runs are long, so no run below is a "longest run" first.
function fieldTested() {
  for (const days of [60, 70, 80, 90])
    watch({ date: shift(REF, -days), km: 14, minutes: 36, avgHr: 145, maxHr: 182, load: 60 });
  recordCalibrationEvent({
    kind: "lthr_tt",
    date: shift(REF, -30),
    target_key: "lthr",
    result: { lthr: 167 },
    source: "stated",
  });
}

// Garmin's own bins, as the live rows carry them: Z4 opens at 157, Z5 at 178.
const garminBins = (z4Secs, z5Secs = 0) => [
  { zone: 1, secs: 20, low_hr: 97 },
  { zone: 2, secs: 60, low_hr: 118 },
  { zone: 3, secs: 900, low_hr: 138 },
  { zone: 4, secs: z4Secs, low_hr: 157 },
  { zone: 5, secs: z5Secs, low_hr: 178 },
];

test("the fixture: threshold 167, steady band tops at 157, threshold band at 165", () => {
  fieldTested();
  const model = getHrModel(REF);
  assert.equal(model.lthr, 167);
  assert.equal(model.zones.z3_top, 157);
  assert.equal(model.zones.z4_top, 165);
});

test("the conversational 157 (effect 4.5, LACTATE_THRESHOLD, load 219) is not hard", () => {
  fieldTested();
  watch({
    date: REF,
    km: 9.68,
    minutes: 53.9,
    avgHr: 157,
    maxHr: 170,
    te: 4.5,
    label: "LACTATE_THRESHOLD",
    load: 219,
    zones: garminBins(2248),
  });
  assert.equal(hardCardioDayIntense(REF), false);
  assert.equal(harmEvidenceOnDay(REF), null);
  // Still a loading day by its length — an easy run costs something.
  assert.equal(hardCardioDay(REF), true);
});

test("the 148 treadmill run (effect 4.2, LACTATE_THRESHOLD) is not hard", () => {
  fieldTested();
  watch({
    date: REF,
    type: "treadmill_running",
    name: "Treadmill Running",
    km: 8.64,
    minutes: 54.4,
    avgHr: 148,
    maxHr: 174,
    te: 4.2,
    label: "LACTATE_THRESHOLD",
    load: 193,
    zones: garminBins(1425),
  });
  assert.equal(hardCardioDayIntense(REF), false);
});

test("the LT field test (164 for 73 min) and a 5k test at 165 stay hard", () => {
  fieldTested();
  watch({ date: REF, name: "LT HR Test and sightseeing", km: 12.96, minutes: 73.2, avgHr: 164, maxHr: 174, te: 5 });
  assert.equal(hardCardioDayIntense(REF), true);
  const day = shift(REF, -2);
  // Unnamed, the personal zones alone grade it quality.
  watch({ date: day, km: 6.72, minutes: 35.6, avgHr: 165, maxHr: 178, te: 4.3 });
  assert.equal(hardCardioDayIntense(day), true);
});

test("an interval day the athlete NAMED stays hard even when its average reads steady", () => {
  fieldTested();
  watch({ date: REF, name: "5k+sprints", km: 9.82, minutes: 63.6, avgHr: 149, te: 3.6, label: "TEMPO" });
  assert.equal(hardCardioDayIntense(REF), true);
  const hills = shift(REF, -3);
  watch({ date: hills, name: "Hills", km: 4.47, minutes: 29.1, avgHr: 149, te: 3.3 });
  assert.equal(hardCardioDayIntense(hills), true);
  // The same numbers under the watch's default title are an ordinary run.
  const plain = shift(REF, -5);
  watch({ date: plain, km: 4.47, minutes: 29.1, avgHr: 149, te: 3.3, label: "TEMPO", zones: garminBins(631) });
  assert.equal(hardCardioDayIntense(plain), false);
});

test("time in bins wholly above the threshold band is hard; a straddling bin proves nothing", () => {
  fieldTested();
  watch({ date: REF, minutes: 40, avgHr: 152, zones: garminBins(600, 300) });
  assert.equal(hardCardioDayIntense(REF), true, "5 min in a bin opening at 178 (> 165)");
  const straddle = shift(REF, -2);
  watch({ date: straddle, minutes: 40, avgHr: 152, zones: garminBins(1800, 60) });
  assert.equal(hardCardioDayIntense(straddle), false, "Z4 opens at 157, inside his steady band");
});

test("a place name is not a session word", () => {
  assert.equal(namesQualityRun("Beacon Hill Running"), false);
  assert.equal(namesQualityRun("Cambridge Running"), false);
  assert.equal(namesQualityRun("Cambridge - Base"), false);
  assert.equal(namesQualityRun("hill repeats"), true);
  assert.equal(namesQualityRun("5K Fast"), true);
  assert.equal(namesQualityRun("LT HR Test and sightseeing"), true);
  assert.equal(namesQualityRun("track_intervals"), true);
});

test("stated easy outranks even a quality-by-HR reading; the next morning still outranks both", () => {
  fieldTested();
  const id = watch({ date: REF, minutes: 40, avgHr: 163 });
  assert.equal(hardCardioDayIntense(REF), true);
  setActivityFeltEffort(id, { rpe: 3 });
  assert.equal(hardCardioDayIntense(REF), false);
  repo.upsertGarminDailyMetric({ date: shift(REF, 1), training_readiness: 10 });
  assert.equal(harmEvidenceOnDay(REF)?.kind, "readiness_rest_grade");
});

test("no usable model: the watch's bars still stand (no personal zones to read against)", () => {
  watch({ date: REF, km: 9.68, minutes: 53.9, avgHr: 157, te: 4.5, label: "LACTATE_THRESHOLD" });
  assert.equal(getHrModel(REF).confidence, "insufficient");
  assert.equal(hardCardioDayIntense(REF), true);
});

test("a ride is not a run: its bars are unchanged", () => {
  fieldTested();
  watch({
    date: REF,
    type: "mountain_biking",
    name: "Cambridge Mountain Biking",
    km: 30,
    minutes: 150,
    avgHr: 140,
    te: 4.5,
  });
  assert.equal(hardCardioDayIntense(REF), true);
});

// ── the per-muscle dose and the day grade read the same way ─────────────────────

const impactOn = (date) => recentEnduranceImpacts(1, date).find((i) => i.date === date);

test("per-muscle dose: the 148 treadmill run is a moderate leg dose, not a hard heavy one", () => {
  fieldTested();
  watch({
    date: REF,
    type: "treadmill_running",
    name: "Treadmill Running",
    km: 8.64,
    minutes: 54.4,
    avgHr: 148,
    te: 4.2,
    label: "LACTATE_THRESHOLD",
    load: 193,
  });
  const impact = impactOn(REF);
  assert.equal(impact.intensity, "moderate");
  assert.equal(impact.load, "moderate");
});

test("per-muscle dose: a long run still loads the legs heavily even when it was not hard", () => {
  fieldTested();
  watch({ date: REF, km: 9.68, minutes: 53.9, avgHr: 157, te: 4.5, label: "LACTATE_THRESHOLD", load: 219 });
  const impact = impactOn(REF);
  assert.equal(impact.intensity, "moderate", "not hard by his own zones");
  assert.equal(impact.load, "heavy", "9.7 km is past the run's distance bar — the legs did that work");
});

test("per-muscle dose: the LT test is hard and heavy; a short easy jog is light", () => {
  fieldTested();
  watch({ date: REF, name: "LT HR Test", km: 12.96, minutes: 73.2, avgHr: 164, te: 5 });
  assert.deepEqual([impactOn(REF).intensity, impactOn(REF).load], ["hard", "heavy"]);
  const jog = shift(REF, -2);
  watch({ date: jog, km: 2.5, minutes: 16, avgHr: 138, te: 2.4 });
  assert.deepEqual([impactOn(jog).intensity, impactOn(jog).load], ["easy", "light"]);
});

test("per-muscle dose: a stated-easy run carries its length, not the watch's intensity — model or not", () => {
  const id = watch({ date: REF, km: 8.64, minutes: 54.4, avgHr: 148, te: 4.2, label: "LACTATE_THRESHOLD" });
  assert.equal(getHrModel(REF).confidence, "insufficient");
  assert.equal(impactOn(REF).intensity, "hard", "no model, no statement: the watch's bars");
  setActivityFeltEffort(id, { rpe: 3 });
  assert.deepEqual([impactOn(REF).intensity, impactOn(REF).load], ["moderate", "moderate"]);
});

test("day grade: a 30-minute run at 150 with effect 4.2 is moderate, not hard; at 163 it is hard", () => {
  fieldTested();
  watch({ date: REF, km: 5, minutes: 30, avgHr: 150, te: 4.2, label: "LACTATE_THRESHOLD" });
  assert.equal(dayLoad(REF, { countsCardio: true }), "moderate");
  const quality = shift(REF, -2);
  watch({ date: quality, km: 5.5, minutes: 30, avgHr: 163, te: 3.4 });
  assert.equal(dayLoad(quality, { countsCardio: true }), "hard");
});

test("day grade: no model keeps the watch's effect bar", () => {
  watch({ date: REF, km: 5, minutes: 30, avgHr: 150, te: 4.2 });
  assert.equal(dayLoad(REF, { countsCardio: true }), "hard");
});

// ── how long is long: against his own ordinary run ──────────────────────────────

// Six weeks of his ordinary running: ~38 min / ~6.7 km, and one 17.7 km long run.
function ordinaryWeeks(anchor) {
  const plan = [
    [3, 38, 6.4],
    [6, 36, 6.7],
    [9, 41, 6.8],
    [13, 31, 5.0],
    [16, 38, 6.4],
    [20, 105, 17.7],
    [24, 30, 4.9],
    [27, 37, 6.7],
  ];
  for (const [days, minutes, km] of plan)
    repo.addActivity({ type: "run", date: shift(anchor, -days), duration_min: minutes, distance_km: km });
}

test("the long bar is 1.5× his own median run, never under the fixed bar, capped", () => {
  assert.deepEqual(
    (({ min, km, basis }) => ({ min, km, basis }))(runLengthBars(REF, { min: 55, km: 9 })),
    { min: 55, km: 9, basis: "fixed" },
    "no history: today's fixed bar exactly"
  );
  ordinaryWeeks(REF);
  const own = runLengthBars(REF, { min: 55, km: 9 });
  assert.equal(own.basis, "own");
  assert.equal(own.min, 56); // 1.5 × the 37.5-minute median
  assert.equal(own.km, 9.8); // 1.5 × the 6.55 km median
  assert.equal(own.longest_km, 17.7);
  // A big-volume runner's bar is capped: past 90 min / 16 km a run is long for anyone.
  resetTables("activities");
  for (const days of [2, 5, 8, 12, 15])
    repo.addActivity({ type: "run", date: shift(REF, -days), duration_min: 80, distance_km: 15 });
  const big = runLengthBars(REF, { min: 55, km: 9 });
  assert.equal(big.min, OWN_RUN_BAR_CAP.min);
  assert.equal(big.km, OWN_RUN_BAR_CAP.km);
});

test("leg dose: an ordinary-length Tuesday run for this runner is moderate, not heavy", () => {
  ordinaryWeeks(REF); // REF is a Monday; the run below lands on Tuesday
  const tue = shift(REF, 1);
  repo.addActivity({ type: "run", date: tue, duration_min: 53.9, distance_km: 9.68 });
  assert.equal(impactOn(tue).load, "moderate");
  // With no history the fixed bar stands: 9.68 km is heavy.
  resetTables("activities");
  repo.addActivity({ type: "run", date: tue, duration_min: 53.9, distance_km: 9.68 });
  assert.equal(impactOn(tue).load, "heavy");
});

test("leg dose: his long-run-day run stays heavy when it clears the fixed bar", () => {
  repo.setProfile({
    endurance_schedule: {
      days: [
        { dow: 0, kind: "long" },
        { dow: 2, kind: "easy" },
      ],
      source: "athlete",
    },
  });
  ordinaryWeeks(REF);
  const sunday = shift(REF, 6); // REF is a Monday
  repo.addActivity({ type: "run", date: sunday, duration_min: 53.9, distance_km: 9.68 });
  assert.equal(impactOn(sunday).load, "heavy");
  // A short Sunday jog is not the long run.
  const next = shift(sunday, 7);
  repo.addActivity({ type: "run", date: next, duration_min: 30, distance_km: 5 });
  assert.notEqual(impactOn(next).load, "heavy");
});

test("day grade: a 54-minute run is a moderate day for this runner, a hard one for a novice", () => {
  ordinaryWeeks(REF);
  const tue = shift(REF, 1);
  repo.addActivity({ type: "run", date: tue, duration_min: 54, distance_km: 8.6 });
  assert.equal(dayLoad(tue, { countsCardio: true }), "moderate");
  resetTables("activities");
  repo.addActivity({ type: "run", date: tue, duration_min: 54, distance_km: 8.6 });
  assert.equal(dayLoad(tue, { countsCardio: true }), "hard");
});

test("program state: a TEMPO-labelled 148 run is not the week's quality; a named hills session is", () => {
  repo.setProfile({ primary_discipline: "hybrid", endurance_sport: "running" });
  fieldTested();
  watch({ date: shift(REF, -3), km: 8, minutes: 50, avgHr: 148, te: 3.4, label: "TEMPO" });
  assert.equal(repo.getProgramState(REF).endurance?.has_quality, false);
  watch({ date: shift(REF, -1), name: "Hills", km: 4.5, minutes: 29, avgHr: 149, te: 3.3 });
  assert.equal(repo.getProgramState(REF).endurance?.has_quality, true);
});

test("program state: no model keeps the watch's label bar", () => {
  repo.setProfile({ primary_discipline: "hybrid", endurance_sport: "running" });
  watch({ date: shift(REF, -3), km: 8, minutes: 50, avgHr: 148, te: 3.4, label: "TEMPO" });
  assert.equal(repo.getProgramState(REF).endurance?.has_quality, true);
});
