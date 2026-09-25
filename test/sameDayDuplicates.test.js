// The same fact typed twice never reads as two facts — one rule per kind:
//   weight       an identical re-submit inside the window is a no-op; trends read ONE
//                weigh-in per day (the latest manual entry).
//   tape         a same-day re-entry of a site supersedes the earlier value in every
//                reader; history rows are kept.
//   activities   a hand log shadowing the watch's row of the same run is flagged and
//                excluded from km/volume reads; a watch run arriving after a hand log
//                retires it at insert.
// Plus v115, which folds only EXACT double-submit weigh-ins already on disk.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { db, repo, resetTables } from "./_seed.js";
import { MIGRATIONS } from "../dist/migrate.js";
import { dailyManualWeighIns, WEIGHT_RESUBMIT_WINDOW_MIN } from "../dist/repo/bodyweight.js";
import { dailySiteSeries } from "../dist/repo/measurement-series.js";
import { getBodyMetricTrends } from "../dist/repo/body-metrics.js";
import { logWeight } from "../dist/repo/profile.js";
import { addActivity, listActivities, recentTraining } from "../dist/repo/activities.js";
import { weeklyKm } from "../dist/repo/program-state.js";
import { RUN_SPORT_PATTERNS } from "../dist/repo/endurance-sports.js";
import { localDateISO } from "../dist/repo/shared.js";

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return localDateISO(d);
}

function ageRow(table, id, minutes) {
  db.prepare(`UPDATE ${table} SET created_at = datetime('now', ?) WHERE id = ?`).run(`-${minutes} minutes`, id);
}

beforeEach(() => {
  resetTables("bodyweight_log", "body_measurements", "activities", "garmin_activities");
});

// ---------------------------------------------------------------- weight ----

test("weight: an identical value re-submitted inside the window is a no-op returning the first row", () => {
  const date = daysAgo(1);
  const first = logWeight(170.4, date);
  const again = logWeight(170.4, date);
  assert.equal(again.id, first.id, "the double submit hands back the row already written");
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM bodyweight_log`).get().n, 1);
});

test("weight: a note on the repeat fills a row that had none, and never replaces one", () => {
  const date = daysAgo(1);
  const first = logWeight(170.4, date);
  assert.equal(logWeight(170.4, date, "after coffee").note, "after coffee");
  assert.equal(logWeight(170.4, date, "different words").note, "after coffee", "an existing note is never replaced");
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM bodyweight_log`).get().n, 1);
  assert.equal(db.prepare(`SELECT note FROM bodyweight_log WHERE id = ?`).get(first.id).note, "after coffee");
});

test("weight: a different value, the same value later, or another date are real readings", () => {
  const date = daysAgo(1);
  const first = logWeight(170.4, date);
  const corrected = logWeight(171.0, date);
  assert.notEqual(corrected.id, first.id, "a genuinely different same-day reading is kept");
  ageRow("bodyweight_log", first.id, WEIGHT_RESUBMIT_WINDOW_MIN + 5);
  ageRow("bodyweight_log", corrected.id, WEIGHT_RESUBMIT_WINDOW_MIN + 5);
  const later = logWeight(170.4, date);
  assert.notEqual(later.id, first.id, "the same value outside the window is a new weigh-in");
  const otherDay = logWeight(170.4, daysAgo(2));
  assert.notEqual(otherDay.id, first.id, "the window is per date");
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM bodyweight_log`).get().n, 4);
});

test("weight: trends read ONE weigh-in per day — the latest manual entry", () => {
  const d3 = daysAgo(3);
  const d2 = daysAgo(2);
  const d1 = daysAgo(1);
  const ins = db.prepare(`INSERT INTO bodyweight_log (date, weight_lb) VALUES (?, ?)`);
  ins.run(d3, 172);
  ins.run(d3, 180); // typo…
  ins.run(d3, 172.2); // …corrected: the latest entry owns the day
  ins.run(d2, 171.5);
  ins.run(d1, 171);
  ins.run(d1, 171);

  const daily = dailyManualWeighIns({ since: d3, through: d1 });
  assert.deepEqual(
    daily.map((w) => [w.date, w.weight_lb]),
    [
      [d3, 172.2],
      [d2, 171.5],
      [d1, 171],
    ]
  );
  assert.equal(dailyManualWeighIns({ limit: 2 }).length, 2, "limit keeps the most recent days");
  assert.deepEqual(
    dailyManualWeighIns({ limit: 2 }).map((w) => w.date),
    [d2, d1],
    "limited, still chronological"
  );

  const trend = getBodyMetricTrends(30).weight;
  assert.equal(trend.n, 3, "three DAYS weighed, not six rows");
  assert.deepEqual(trend.points, [172.2, 171.5, 171]);
  assert.equal(repo.listWeight(60).length, 6, "the history list stays row-by-row");
});

// ------------------------------------------------------------------ tape ----

test("tape: a same-day re-entry of a site supersedes the earlier value in every reader, history kept", () => {
  const d10 = daysAgo(10);
  const d1 = daysAgo(1);
  repo.addBodyMeasurement(d10, { waist_in: 34, hip_in: 40 });
  repo.addBodyMeasurement(d1, { waist_in: 33, hip_in: 39.5, neck_in: 15 });
  // Second session the same day corrects the waist only; hip is left blank.
  repo.addBodyMeasurement(d1, { waist_in: 33.5 });

  assert.deepEqual(
    dailySiteSeries("waist_in").map((r) => [r.date, r.value]),
    [
      [d10, 34],
      [d1, 33.5],
    ],
    "one waist per day; the later same-day value wins"
  );
  assert.deepEqual(
    dailySiteSeries("hip_in").map((r) => [r.date, r.value]),
    [
      [d10, 40],
      [d1, 39.5],
    ],
    "a site the later row left blank does not supersede the earlier value"
  );
  assert.deepEqual(dailySiteSeries("not_a_site"), [], "an unknown column reads as nothing");
  assert.deepEqual(
    dailySiteSeries("waist_in", { since: d1, through: d1 }).map((r) => r.value),
    [33.5],
    "date bounds are inclusive"
  );

  const waist = getBodyMetricTrends(30).sites.find((s) => s.key === "waist_in");
  assert.equal(waist.n, 2, "a day taped twice is one data point");
  assert.equal(waist.latest, 33.5);
  assert.equal(repo.latestKnownMeasurement().waist_in, 33.5, "the indicators read the corrected value");
  assert.equal(repo.latestKnownMeasurement().hip_in, 39.5);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM body_measurements`).get().n, 3, "no history row deleted");
});

// ------------------------------------------------------------ activities ----

function seedWatchRun(date, { duration_min = 50, distance_km = 8.0, external_id = `g-${date}` } = {}) {
  return addActivity({ date, type: "running", duration_min, distance_km, source: "garmin", external_id });
}

test("activities: a hand log typed after the watch run is flagged and never double-counts km", () => {
  const date = daysAgo(2);
  const watch = seedWatchRun(date);
  const hand = addActivity({ date, type: "run", duration_min: 50, distance_km: 8, notes: "felt easy" });
  // A genuinely different second run the same day is its own effort.
  const second = addActivity({ date, type: "run", duration_min: 20, distance_km: 3 });

  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM activities`).get().n, 3, "the hand log is kept (its words)");
  const listed = listActivities(20);
  assert.equal(listed.find((r) => r.id === hand.id).shadow_of, watch.id, "the shadow names the synced row");
  assert.equal(listed.find((r) => r.id === watch.id).shadow_of, null);
  assert.equal(listed.find((r) => r.id === second.id).shadow_of, null, "a disagreeing run is not a shadow");

  assert.equal(weeklyKm(localDateISO(), 0, RUN_SPORT_PATTERNS), 11, "8 km + 3 km, never 19");

  const feedIds = recentTraining(20)
    .filter((r) => r.kind === "activity")
    .map((r) => r.id);
  assert.ok(!feedIds.includes(hand.id), "the Lately feed shows one run, not two");
  assert.ok(feedIds.includes(watch.id) && feedIds.includes(second.id));
});

test("activities: a watch run arriving after the hand log retires it (the reverse direction)", () => {
  const date = daysAgo(3);
  addActivity({ date, type: "run", duration_min: 40, distance_km: 7 });
  seedWatchRun(date, { duration_min: 41, distance_km: 7.1 });
  const rows = db.prepare(`SELECT source FROM activities WHERE date = ?`).all(date);
  assert.deepEqual(
    rows.map((r) => r.source),
    ["garmin"],
    "one run remains, the watch's"
  );
  assert.equal(weeklyKm(localDateISO(), 0, RUN_SPORT_PATTERNS), 7.1);
});

// ------------------------------------------------------------- migration ----

test("v115 folds only exact double-submit weigh-ins and is idempotent", () => {
  const v115 = MIGRATIONS.find((m) => m.version === 115);
  assert.ok(v115, "v115 is on the ladder");
  const d = new DatabaseSync(":memory:");
  v115.up(d); // no table on an old ladder position: a no-op, not a throw
  d.exec(`CREATE TABLE bodyweight_log (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT, weight_lb REAL);`);
  d.prepare(`INSERT INTO bodyweight_log (date, weight_lb) VALUES ('2026-01-09', 170)`).run();
  d.prepare(`INSERT INTO bodyweight_log (date, weight_lb) VALUES ('2026-01-09', 170)`).run();
  v115.up(d); // a legacy table with no created_at has no window: untouched, not a throw
  assert.equal(d.prepare(`SELECT COUNT(*) AS n FROM bodyweight_log`).get().n, 2);
  d.exec(`DROP TABLE bodyweight_log;`);
  d.exec(`CREATE TABLE bodyweight_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, weight_lb REAL NOT NULL,
    note TEXT, created_at TEXT DEFAULT (datetime('now'))
  );`);
  const ins = d.prepare(`INSERT INTO bodyweight_log (date, weight_lb, note, created_at) VALUES (?, ?, ?, ?)`);
  ins.run("2026-01-10", 170.4, null, "2026-01-10 07:00:00"); // 1 survivor of a burst
  ins.run("2026-01-10", 170.4, null, "2026-01-10 07:00:04"); // 2 double submit -> folded
  ins.run("2026-01-10", 170.4, null, "2026-01-10 07:03:00"); // 3 still inside the burst -> folded
  ins.run("2026-01-10", 170.8, null, "2026-01-10 07:03:30"); // 4 a different value -> kept
  ins.run("2026-01-10", 170.4, null, "2026-01-10 19:00:00"); // 5 same value hours later -> kept
  ins.run("2026-01-11", 170.0, "morning", "2026-01-11 07:00:00"); // 6
  ins.run("2026-01-11", 170.0, "morning", "2026-01-11 07:00:05"); // 7 same words -> folded
  ins.run("2026-01-11", 170.0, "post-run", "2026-01-11 07:00:09"); // 8 new words -> kept
  ins.run("2026-01-12", 169.8, null, null); // 9 no created_at: never matched
  ins.run("2026-01-12", 169.8, null, null); // 10

  v115.up(d);
  v115.up(d); // idempotent
  const ids = d
    .prepare(`SELECT id FROM bodyweight_log ORDER BY id`)
    .all()
    .map((r) => r.id);
  assert.deepEqual(ids, [1, 4, 5, 6, 8, 9, 10]);
  d.close();
});
