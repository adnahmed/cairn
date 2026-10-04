// The live week of 2026-09-28 as a synthetic fixture (shape only, no real data): a
// supporting runner with stated runs Tue easy / Thu quality / Sun long, a half on
// 2026-11-01, and a Saturday mountain-bike habit that lives only in the schedule note.
//
//   Tue 09-29  run 9.68 km, RPE 3 (stated easy)
//   Wed 09-30  run 6.63 km, no RPE (a social run)
//   Fri 10-02  "Hill Sprints" 5.97 km — the quality session, moved off Thursday on purpose
//   Sat 10-03  "Cambridge Mountain Biking" 142 min, load 240, TE 4
//   Sun 10-04  run 13.54 km, RPE 3 (the long run)
//
// Five steadier weeks before it (22.5 → 27.9 km) and one earlier Saturday ride (09-19),
// so the observed Saturday pattern is two of the last six weeks.
import { db, repo, resetTables } from "./_seed.js";

export const RACE = "2026-11-01";
export const WEEK = "2026-09-28";
export const TUE = "2026-09-29";
export const WED = "2026-09-30";
export const THU = "2026-10-01";
export const FRI = "2026-10-02";
export const SAT = "2026-10-03";
export const SUN = "2026-10-04";
export const NEXT_MON = "2026-10-05";

export function resetLiveWeekTables() {
  resetTables(
    "activities",
    "garmin_activities",
    "garmin_daily_metrics",
    "garmin_sources",
    "context_events",
    "sessions",
    "logged_sets",
    "exercises",
    "plan_items",
    "plan_days",
    "program_blocks",
    "brain_decisions",
    "daily_metrics",
    "app_state",
    "profile"
  );
}

let sourceId = null;
function garminSource() {
  if (sourceId != null) {
    const still = db.prepare(`SELECT id FROM garmin_sources WHERE id = ?`).get(sourceId);
    if (still) return sourceId;
  }
  sourceId = Number(
    db.prepare(`INSERT INTO garmin_sources (provider, label) VALUES ('garmin', 'live-week-fixture')`).run()
      .lastInsertRowid
  );
  return sourceId;
}

/** One activity, with an optional watch row (name, te_label, TE, load). */
export function activity(date, { type = "run", km = null, min = null, rpe = null, garmin = null } = {}) {
  const row = repo.addActivity({ type, date, distance_km: km, duration_min: min, rpe });
  if (garmin) {
    db.prepare(
      `INSERT INTO garmin_activities
         (source_id, external_id, activity_id, date, type, name, duration_min, distance_km,
          te_label, aerobic_te, training_effect, training_load)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      garminSource(),
      `live-week-${row.id}`,
      row.id,
      date,
      garmin.type ?? (type === "run" ? "running" : type),
      garmin.name ?? null,
      min,
      km,
      garmin.te_label ?? null,
      garmin.aerobic_te ?? null,
      garmin.aerobic_te ?? null,
      garmin.load ?? null
    );
  }
  return row;
}

export function run(date, km, extra = {}) {
  return activity(date, { type: "run", km, min: Math.round(km * 6.2 * 10) / 10, ...extra });
}

export function ride(date, min, { load = 200, te = 3.8, name = "Cambridge Mountain Biking" } = {}) {
  return activity(date, {
    type: "ride",
    min,
    km: Math.round(min * 0.2 * 10) / 10,
    garmin: { type: "mountain_biking", name, aerobic_te: te, load },
  });
}

export function seedProfile({ crossTraining } = {}) {
  repo.setProfile({
    age: 40,
    sex: "male",
    primary_discipline: "hybrid",
    endurance_sport: "running",
    training_intent: {
      priorities: ["longevity", "muscle", "strength", "leanness", "endurance"],
      endurance_role: "supporting",
    },
    endurance_goal: { mode: "race", event: "City Half", date: RACE, distance_km: 21.1, target: "sub-2:00" },
    endurance_schedule: {
      days: [
        { dow: 0, kind: "long" },
        { dow: 2, kind: "easy" },
        { dow: 4, kind: "quality" },
      ],
      ...(crossTraining ? { cross_training: crossTraining } : {}),
      note: "Saturday optional (MTB or other) — never a planned run",
      source: "athlete",
    },
  });
}

/** The five steadier weeks before the live week, plus the 09-19 Saturday ride. */
export function seedHistory() {
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
  ride("2026-09-19", 115, { load: 190, te: 3.6 });
}

/**
 * The live week itself. `wedHard`: the variant where Wednesday's untitled social run
 * also reads hard on the watch. `withSunday` false leaves Sunday's long run unrun.
 */
export function seedLiveWeek({ wedHard = false, withSunday = true, withSaturday = true } = {}) {
  const tue = run(TUE, 9.68, {
    min: 53.9,
    rpe: 3,
    garmin: { name: "Easy Run", te_label: "LACTATE_THRESHOLD", aerobic_te: 4.5 },
  });
  const wed = run(WED, 6.63, {
    min: 40.1,
    garmin: wedHard
      ? { name: "Cambridge Running", te_label: "TEMPO", aerobic_te: 3.6 }
      : { name: "Cambridge Running", te_label: "AEROBIC_BASE", aerobic_te: 2.8 },
  });
  const fri = run(FRI, 5.97, { min: 39.3, garmin: { name: "Hill Sprints", te_label: "VO2MAX", aerobic_te: 3.2 } });
  const sat = withSaturday ? ride(SAT, 142, { load: 240, te: 4 }) : null;
  const sun = withSunday ? run(SUN, 13.54, { min: 83.8, rpe: 3 }) : null;
  return { tue, wed, fri, sat, sun };
}
