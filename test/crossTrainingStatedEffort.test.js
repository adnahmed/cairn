// Stated effort outranks the watch on a ride, exactly as on a run (decision 2,
// 2026-10-04) — and the running HR model never judges a ride. The live case:
// Saturday's 142-minute MTB carried TE 4 and load 240; with the athlete's own
// "easy" on it (rpe 3) the watch's intensity bars stand down and only its length
// still speaks. Without a stated effort the watch read stays.
// Deterministic, offline, temp DB (see test/run.mjs).
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { db, resetTables } from "./_seed.js";
import { recentEnduranceImpacts } from "../dist/repo/hybrid-load.js";
import { cardioEffort, hardCardioDayIntense } from "../dist/repo/training-read.js";
import { personalRunReadForRow } from "../dist/repo/run-intensity.js";

const DAY = "2026-10-03";

beforeEach(() => {
  resetTables("logged_sets", "sessions", "exercises", "activities", "garmin_activities", "garmin_sources");
});

function seedRide({ rpe, minutes = 140 }) {
  const info = db
    .prepare(
      `INSERT INTO activities (date, type, raw_text, duration_min, rpe) VALUES (?, 'ride', 'Cambridge Mountain Biking', ?, ?)`
    )
    .run(DAY, minutes, rpe);
  const src = db.prepare(`INSERT INTO garmin_sources (provider, label) VALUES ('garmin','test')`).run();
  db.prepare(
    `INSERT INTO garmin_activities (source_id, external_id, activity_id, date, type, name, aerobic_te, training_load, avg_hr)
     VALUES (?, ?, ?, ?, 'mountain_biking', 'Cambridge Mountain Biking', 4, 240, 150)`
  ).run(src.lastInsertRowid, `ga-${info.lastInsertRowid}`, info.lastInsertRowid, DAY);
}

const rideRow = (rpe, minutes = 140) => ({
  type: "ride",
  raw_text: "Cambridge Mountain Biking",
  duration_min: minutes,
  aerobic_te: 4,
  te_label: "TEMPO",
  rpe,
});

test("a ride stated easy is not a hard day on the watch's intensity", () => {
  seedRide({ rpe: 3 });
  assert.equal(hardCardioDayIntense(DAY, null), false);
});

test("a ride without a stated effort stays watch-graded hard", () => {
  seedRide({ rpe: null });
  assert.equal(hardCardioDayIntense(DAY, null), true);
});

test("cardioEffort grades a stated-easy ride on length only, never on TE", () => {
  assert.equal(cardioEffort(rideRow(3, 140)), "hard", "140 min clears the length bar");
  assert.equal(cardioEffort(rideRow(3, 30)), "moderate", "30 min with TE 4 is moderate on length, not hard on TE");
  assert.equal(cardioEffort(rideRow(3, 15)), "easy");
  assert.equal(cardioEffort(rideRow(null, 30)), "hard", "unstated: the watch's TE still grades it");
});

test("the per-muscle read of a stated-easy ride is never hard; unstated stays hard", () => {
  seedRide({ rpe: 3 });
  let impact = recentEnduranceImpacts(1, DAY)[0];
  assert.equal(impact.family, "ride");
  assert.notEqual(impact.intensity, "hard");
  assert.equal(impact.load, "heavy", "142 min of trail riding is still a long leg dose");
  resetTables("activities", "garmin_activities", "garmin_sources");
  seedRide({ rpe: null });
  impact = recentEnduranceImpacts(1, DAY)[0];
  assert.equal(impact.intensity, "hard");
});

test("the running HR model never judges a ride", () => {
  let asked = false;
  const model = () => {
    asked = true;
    return { easy_ceiling: 140 };
  };
  const row = { type: "ride", avg_hr: 150, hr_minutes: 140, g_name: "Cambridge Mountain Biking" };
  assert.equal(personalRunReadForRow(row, model), null);
  assert.equal(personalRunReadForRow({ ...row, type: "mountain_biking" }, model), null);
  assert.equal(asked, false, "the model is not even read for a ride");
});
