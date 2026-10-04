// A run's SHAPE reaches the brain, not just its summary.
//
// The live case (2026-10-02): six hill repeats with walked recoveries — 5.97 km, avg
// HR 149, 14 laps, +70 m — synced as a summary only. Against the athlete's own model
// (easy ceiling ≈ 151) the average read EASY, the Z4/Z5 bins never cleared four
// minutes above his threshold band, and the title ("Cambridge Running") named
// nothing, so the hard read, the harm bar and the per-muscle dose all saw an easy run.
// The watch had sent the structure all along (`splitSummaries` in the list payload)
// and the sync dropped it; the running-dynamics columns read null on every run
// because only the detail call — which answers null for them — was ever written.
//
//   • the list payload's running dynamics, grade-adjusted speed, Body Battery change
//     and segment structure are stored (garminActivityInput);
//   • laps parse from the splits endpoint's lapDTOs;
//   • a structured interval workout is quality work for the personal hard read —
//     unless its own work laps were all under his easy line;
//   • the coach's run line carries the shape; read_activity_detail returns every lap;
//   • migration v117 backfills the stored payloads.
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { db, repo, resetTables } from "./_seed.js";
import { garminActivityInput } from "../dist/garmin.js";
import {
  intervalSessionEvidence,
  isStructuredIntervalSession,
  normalizeGarminLaps,
  normalizeSplitSummaries,
  structureNote,
} from "../dist/repo/run-structure.js";
import { hardCardioDayIntense } from "../dist/repo/training-read.js";
import { recordCalibrationEvent } from "../dist/repo/calibration.js";
import { recentCardioRead } from "../dist/repo/recent-cardio.js";
import { executeCoachReadTool } from "../dist/brain/read-tool-runtime.js";
import { backfillGarminRunStructure } from "../dist/migrations/frozen/v117-garmin-run-structure.js";

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
  repo.setSettings({ run_units: "km" });
});

// This morning's list payload, as Garmin sent it (the fields this reads).
const HILL_SPLITS = [
  {
    noOfSplits: 4,
    totalAscent: 3.01,
    duration: 305.277,
    splitType: "RWD_WALK",
    distance: 403.36,
    averageSpeed: 1.321,
    elevationLoss: 9.15,
  },
  {
    noOfSplits: 1,
    totalAscent: 2.52,
    duration: 312.084,
    splitType: "INTERVAL_WARMUP",
    distance: 854.68,
    averageSpeed: 2.739,
    elevationLoss: 0,
  },
  {
    noOfSplits: 5,
    totalAscent: 67.56,
    duration: 2055.989,
    splitType: "RWD_RUN",
    distance: 5570.99,
    averageSpeed: 2.71,
    elevationLoss: 61.27,
  },
  {
    noOfSplits: 7,
    totalAscent: 53.08,
    duration: 1211.902,
    splitType: "INTERVAL_ACTIVE",
    distance: 3563.14,
    averageSpeed: 2.94,
    elevationLoss: 20.17,
  },
  { noOfSplits: 1, duration: 0, splitType: "RWD_STAND" },
  {
    noOfSplits: 6,
    totalAscent: 14.09,
    duration: 837.475,
    splitType: "INTERVAL_RECOVERY",
    distance: 1556.53,
    averageSpeed: 1.859,
    elevationLoss: 50.68,
  },
];
// An ordinary run: the whole run is one "active" bout.
const PLAIN_SPLITS = [
  { noOfSplits: 1, duration: 2408, splitType: "INTERVAL_ACTIVE", distance: 6630, averageSpeed: 2.77 },
  { noOfSplits: 1, duration: 2408, splitType: "RWD_RUN", distance: 6630, averageSpeed: 2.77 },
];

function hillPayload(overrides = {}) {
  return {
    activityId: 24577054247,
    activityName: "Cambridge Running",
    startTimeLocal: `${REF} 07:05:11`,
    activityType: { typeKey: "running" },
    distance: 5970,
    duration: 2358,
    movingDuration: 2358,
    elevationGain: 70.69,
    averageSpeed: 2.53,
    averageHR: 149,
    maxHR: 179,
    lapCount: 14,
    avgGroundContactTime: 282.5,
    avgVerticalOscillation: 8.76,
    avgVerticalRatio: 9.2,
    avgGradeAdjustedSpeed: 2.556,
    differenceBodyBattery: -11,
    splitSummaries: HILL_SPLITS,
    ...overrides,
  };
}

// One `/typedsplits` entry, as the live endpoint sends it (no lapIndex; a `type`).
const lapDto = (i, type, secs, meters, hr, maxHr, gain = 0) => ({
  messageIndex: i,
  type,
  duration: secs,
  movingDuration: secs,
  distance: meters,
  averageSpeed: meters / secs,
  averageMovingSpeed: meters / secs,
  avgGradeAdjustedSpeed: (meters / secs) * 1.1,
  averageHR: hr,
  maxHR: maxHr,
  elevationGain: gain,
  elevationLoss: 1,
  averageRunCadence: 160,
});

// The typed list interleaves the run/walk detection (RWD_*) over the same time; only
// the INTERVAL_* entries are laps.
function hillLaps(workHr = 168, workMax = 177) {
  const splits = [lapDto(0, "RWD_RUN", 942, 2589, 149, 179), lapDto(1, "INTERVAL_WARMUP", 312, 855, 135, 148)];
  for (let i = 0; i < 6; i++) {
    splits.push(lapDto(2 + i * 3, "INTERVAL_ACTIVE", 170, 510, workHr, workMax, 8));
    splits.push(lapDto(3 + i * 3, "INTERVAL_RECOVERY", 140, 260, 140, workMax - 6));
    splits.push(lapDto(4 + i * 3, "RWD_WALK", 40, 50, 140, 150));
  }
  return { activityId: 24577054247, splits };
}

// The owner's model: threshold 167 → steady top 157, threshold top 165, easy ≈ 151.
function fieldTested() {
  let n = 0;
  for (const days of [60, 70, 80, 90]) {
    n += 1;
    repo.upsertGarminActivity({
      external_id: `basis-${n}`,
      date: shift(REF, -days),
      type: "running",
      name: "Boston Running",
      duration_min: 36,
      moving_min: 36,
      distance_km: 14,
      avg_hr: 145,
      max_hr: 182,
    });
  }
  recordCalibrationEvent({
    kind: "lthr_tt",
    date: shift(REF, -30),
    target_key: "lthr",
    result: { lthr: 167 },
    source: "stated",
  });
}

function syncRun(payload, laps = null) {
  const input = garminActivityInput(payload);
  if (laps) input.laps = normalizeGarminLaps(laps);
  repo.upsertGarminActivity(input);
  return db
    .prepare(`SELECT a.id FROM activities a JOIN garmin_activities g ON g.activity_id = a.id WHERE g.external_id = ?`)
    .get(String(payload.activityId)).id;
}

test("the list payload's running dynamics, grade-adjusted speed, Body Battery and shape are kept", () => {
  const input = garminActivityInput(hillPayload());
  assert.equal(input.avg_ground_contact_ms, 282.5);
  assert.equal(input.avg_vertical_osc_cm, 8.76);
  assert.equal(input.avg_vertical_ratio, 9.2);
  assert.equal(input.gap_speed, 2.556);
  assert.equal(input.body_battery_delta, -11);
  const work = input.structure.find((s) => s.kind === "work");
  assert.deepEqual([work.bouts, Math.round(work.secs), Math.round(work.ascent_m)], [7, 1212, 53]);
  assert.ok(!input.structure.some((s) => s.kind === "stand"), "an empty segment carries nothing");
});

test("laps parse from the typed list: warm-up, work and recovery told apart, run/walk detection dropped", () => {
  const laps = normalizeGarminLaps(hillLaps());
  assert.equal(laps.length, 13);
  assert.equal(laps[0].kind, "warmup");
  assert.equal(laps.filter((l) => l.kind === "work").length, 6);
  assert.equal(laps.filter((l) => l.kind === "recovery").length, 6);
  assert.equal(laps[1].avg_hr, 168);
  assert.deepEqual(
    laps.slice(0, 3).map((l) => l.n),
    [1, 2, 3],
    "numbered in lap order"
  );
  assert.equal(normalizeGarminLaps({ splits: [lapDto(0, "RWD_RUN", 600, 1600, 140, 150)] }), null);
  assert.equal(normalizeGarminLaps({ lapDTOs: [] }), null);
  assert.equal(normalizeGarminLaps(null), null);
});

test("the plain lap list's blanket INTERVAL label is never read as work", () => {
  // Live (2026-10-02): every lap of a watch workout — warm-up, reps, recoveries — came
  // back intensityType "INTERVAL" from /splits.
  const laps = normalizeGarminLaps({
    lapDTOs: [
      { lapIndex: 1, intensityType: "INTERVAL", duration: 312, distance: 855, averageHR: 135 },
      { lapIndex: 2, intensityType: "INTERVAL", duration: 55, distance: 212, averageHR: 162 },
    ],
  });
  assert.deepEqual(
    laps.map((l) => l.kind),
    ["other", "other"]
  );
  assert.equal(structureNote(normalizeSplitSummaries(HILL_SPLITS), laps, "km").includes("work reps"), false);
});

test("an interval session needs bouts, recoveries and real work — a plain run is not one", () => {
  assert.equal(isStructuredIntervalSession(normalizeSplitSummaries(HILL_SPLITS)), true);
  assert.equal(isStructuredIntervalSession(normalizeSplitSummaries(PLAIN_SPLITS)), false);
  const strides = [
    { noOfSplits: 6, duration: 120, splitType: "INTERVAL_ACTIVE", distance: 600 },
    { noOfSplits: 5, duration: 300, splitType: "INTERVAL_RECOVERY", distance: 500 },
  ];
  assert.equal(isStructuredIntervalSession(normalizeSplitSummaries(strides)), false, "strides are not a session");
});

test("this morning's hill repeats read HARD — the average alone read them easy", () => {
  fieldTested();
  syncRun(hillPayload());
  assert.equal(hardCardioDayIntense(REF), true);
});

test("without the shape, the same run still reads easy (the bug this fixes)", () => {
  fieldTested();
  syncRun(hillPayload({ activityId: 1, splitSummaries: null }));
  assert.equal(hardCardioDayIntense(REF), false);
});

test("a structured workout whose work laps were all easy is not made hard", () => {
  fieldTested();
  syncRun(hillPayload(), hillLaps(140, 146));
  assert.equal(hardCardioDayIntense(REF), false);
  assert.equal(
    intervalSessionEvidence(normalizeSplitSummaries(HILL_SPLITS), normalizeGarminLaps(hillLaps()), 151),
    true
  );
});

test("the run line carries the shape, and the reps when laps are stored", () => {
  syncRun(hillPayload({ startTimeLocal: `${shift(REF, 0)} 07:05:11` }), hillLaps());
  const row = recentCardioRead(REF).rows[0];
  assert.match(
    row.structure,
    /^intervals: warm-up 5:12 · 7 work bouts 20:12 total, 3\.56 km, \+53 m · 6 recoveries 13:58/
  );
  assert.match(row.structure, /walked 5:05/);
  assert.match(row.structure, /grade-adjusted pace 6:31\/km/);
  assert.match(row.structure, /work reps \(avg\/max HR\): 1\) 2:50 5:33\/km 168\/177 bpm \+8 m/);
  // A plain run has no shape to speak of.
  syncRun(hillPayload({ activityId: 2, lapCount: 1, elevationGain: 10, splitSummaries: PLAIN_SPLITS }));
  const plain = recentCardioRead(REF).rows.find((r) => r.structure == null);
  assert.ok(plain, "a plain run carries no shape line");
  assert.equal(structureNote(null, null, "km"), null);
});

test("read_activity_detail returns every lap, the segments and running form — never the training effect", () => {
  const id = syncRun(hillPayload(), hillLaps());
  const result = executeCoachReadTool(
    { tool: "read_activity_detail", args: { activity_id: id } },
    { run_id: "t", today: REF }
  );
  assert.equal(result.data.found, true);
  assert.equal(result.rows_returned, 13);
  assert.equal(result.data.laps[1].kind, "work");
  assert.equal(result.data.laps[1].avg_hr, 168);
  assert.equal(result.data.activity.running_form.ground_contact_ms, 282.5);
  assert.equal(result.data.activity.grade_adjusted_pace, "6:31/km");
  assert.equal(result.data.structure.interval_session, true);
  const text = JSON.stringify(result);
  assert.ok(!/te_label|training_effect|aerobic_te|raw_json/.test(text), text);

  const missing = executeCoachReadTool(
    { tool: "read_activity_detail", args: { activity_id: 999999 } },
    { run_id: "t" }
  );
  assert.equal(missing.data.found, false);
  assert.throws(() =>
    executeCoachReadTool({ tool: "read_activity_detail", args: { activity_id: "x" } }, { run_id: "t" })
  );
});

test("a run with unsynced laps says so", () => {
  const id = syncRun(hillPayload());
  const result = executeCoachReadTool({ tool: "read_activity_detail", args: { activity_id: id } }, { run_id: "t" });
  assert.match(result.data.laps_note, /not synced yet/);
});

test("v117 backfills the stored payloads, and a re-run changes nothing", () => {
  const mem = new DatabaseSync(":memory:");
  mem.exec(`CREATE TABLE garmin_activities (id INTEGER PRIMARY KEY, raw_json TEXT, structure_json TEXT, gap_speed REAL,
    body_battery_delta REAL, avg_ground_contact_ms REAL, avg_vertical_osc_cm REAL, avg_vertical_ratio REAL)`);
  mem
    .prepare(`INSERT INTO garmin_activities (id, raw_json) VALUES (1, ?), (2, ?), (3, 'not json')`)
    .run(JSON.stringify(hillPayload()), JSON.stringify({ activityName: "Strength" }));
  assert.equal(backfillGarminRunStructure(mem), 1);
  const row = mem.prepare(`SELECT * FROM garmin_activities WHERE id = 1`).get();
  assert.equal(row.avg_ground_contact_ms, 282.5);
  assert.equal(row.gap_speed, 2.556);
  assert.equal(row.body_battery_delta, -11);
  assert.equal(JSON.parse(row.structure_json).find((s) => s.kind === "work").bouts, 7);
  const before = JSON.stringify(row);
  backfillGarminRunStructure(mem);
  assert.equal(JSON.stringify(mem.prepare(`SELECT * FROM garmin_activities WHERE id = 1`).get()), before);
});

test("v117 on a table that predates running dynamics fills what it has", () => {
  const mem = new DatabaseSync(":memory:");
  mem.exec(`CREATE TABLE garmin_activities (id INTEGER PRIMARY KEY, raw_json TEXT, structure_json TEXT, gap_speed REAL,
    body_battery_delta REAL)`);
  mem.prepare(`INSERT INTO garmin_activities (id, raw_json) VALUES (1, ?)`).run(JSON.stringify(hillPayload()));
  assert.equal(backfillGarminRunStructure(mem), 1);
  assert.equal(mem.prepare(`SELECT gap_speed FROM garmin_activities`).get().gap_speed, 2.556);
});
