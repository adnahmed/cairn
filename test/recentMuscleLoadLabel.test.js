// recentMuscleLoad names the MOST RECENT contributor (live bug, 2026-10-04): the
// quads read `last_date 2026-10-04` (Sunday's long run) with `activity: "trail MTB"`
// (Saturday's ride), because every endurance bump overwrote the name without
// checking recency, and that mislabelled line rode into every prompt as recent_load.
// Deterministic, offline, temp DB (see test/run.mjs).
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { db, resetTables } from "./_seed.js";
import { loadPhrase, recentMuscleLoad } from "../dist/repo/hybrid-load.js";

const SAT = "2026-10-03";
const SUN = "2026-10-04";

beforeEach(() => {
  resetTables("logged_sets", "sessions", "exercises", "activities", "garmin_activities", "garmin_sources");
});

const ride = () =>
  db
    .prepare(
      `INSERT INTO activities (date, type, raw_text, duration_min, distance_km) VALUES (?, 'ride', ?, 142, NULL)`
    )
    .run(SAT, "Cambridge Mountain Biking");
const run = () =>
  db
    .prepare(
      `INSERT INTO activities (date, type, raw_text, duration_min, distance_km, rpe) VALUES (?, 'run', NULL, 83.8, 13.54, 3)`
    )
    .run(SUN);

for (const [name, order] of [
  ["ride then run", [ride, run]],
  ["run then ride", [run, ride]],
]) {
  test(`quads name Sunday's run, not Saturday's ride (${name})`, () => {
    for (const insert of order) insert();
    const quads = recentMuscleLoad(2, SUN).get("quads");
    assert.ok(quads);
    assert.equal(quads.last_date, SUN);
    assert.equal(quads.activity, "run");
    assert.equal(quads.source, "endurance");
    assert.match(loadPhrase(quads), /run today$/);
    // A group only the ride touched keeps the ride's name.
    const forearms = recentMuscleLoad(2, SUN).get("forearms");
    assert.equal(forearms.activity, "trail MTB");
    assert.equal(forearms.last_date, SAT);
  });
}

test("a newer strength day clears an older endurance name", () => {
  ride();
  const ex = db.prepare(`INSERT INTO exercises (name, muscle_group) VALUES ('Back Squat', 'quads')`).run();
  const session = db.prepare(`INSERT INTO sessions (date) VALUES (?)`).run(SUN);
  db.prepare(
    `INSERT INTO logged_sets (session_id, exercise_id, set_number, weight, reps) VALUES (?, ?, 1, 100, 5)`
  ).run(session.lastInsertRowid, ex.lastInsertRowid);
  const quads = recentMuscleLoad(2, SUN).get("quads");
  assert.equal(quads.last_date, SUN);
  assert.equal(quads.source, "both");
  assert.equal(quads.activity, null, "the squat is the most recent thing, and it is not the ride");
  assert.match(loadPhrase(quads), /quads work you did today/);
});

test("on the same day an endurance effort names a group strength also touched", () => {
  const ex = db.prepare(`INSERT INTO exercises (name, muscle_group) VALUES ('Back Squat', 'quads')`).run();
  const session = db.prepare(`INSERT INTO sessions (date) VALUES (?)`).run(SUN);
  db.prepare(
    `INSERT INTO logged_sets (session_id, exercise_id, set_number, weight, reps) VALUES (?, ?, 1, 100, 5)`
  ).run(session.lastInsertRowid, ex.lastInsertRowid);
  run();
  const quads = recentMuscleLoad(2, SUN).get("quads");
  assert.equal(quads.activity, "run");
  assert.equal(quads.source, "both");
});
