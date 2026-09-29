// STATING HOW A RUN FELT, AFTER THE FACT.
//
// The one writer behind `PUT /api/activities/:id/effort`, the `set_activity_effort` MCP
// tool and chat's `set_activity_effort` action. It stores the athlete's felt effort on
// the activity's existing `rpe` column (no new field — the column was always the
// athlete's word, see stated-effort.ts) and, for a run with heart rate stated in the
// talk-test band, files the matching talk-test observation on the calibration ladder
// (`recordTalkTestObservation`), where a repeated pattern of them may lift the easy
// line (`talkTestEasyLine`, hr-model.ts). Changing or clearing the effort withdraws
// that observation, so the ladder never holds a word the athlete took back.
//
// What the statement moves is read, never stored: the harm read, the intensity
// discipline and the run engine's demonstrated capacity all ask `activities.rpe`
// directly. So the only caches to retire are the ones those reads feed — the day of
// the run and the morning after it (whose read looks back at yesterday's work).
import { db } from "../db.js";
import { withoutShadowActivities, shadowedActivity } from "./activity-shadow.js";
import { getActivity, updateActivityFields } from "./activities.js";
import { clearTalkTestObservation, recordTalkTestObservation, type CalibrationEvent } from "./calibration.js";
import { refreshPersistedHrModel } from "./hr-model.js";
import { invalidateDayRead } from "./intelligence.js";
import { addDaysISO, localDateISO } from "./shared.js";
import { isStatedEasyRpe } from "./stated-effort.js";

/** A stated note is the athlete's own sentence, bounded like any capture note. */
const FELT_NOTE_MAX = 280;

export type ActivityEffortResult =
  | {
      ok: true;
      activity: Record<string, unknown>;
      rpe: number | null;
      /** The athlete said easy: the watch's intensity bars no longer grade this run hard. */
      stated_easy: boolean;
      /** The talk-test observation filed for this run, when it had heart rate. */
      talk_test: CalibrationEvent | null;
    }
  | { ok: false; code: "invalid_id" | "invalid_rpe" | "not_found"; error: string };

/** A 1–10 felt effort, halves allowed; null clears. Undefined/garbage → undefined (invalid). */
export function normalizeFeltRpe(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (value === undefined || value === "") return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1 || n > 10) return undefined;
  return Math.round(n * 2) / 2;
}

type EffortRow = {
  id: number;
  date: string;
  type: string | null;
  source: string | null;
  external_id: string | null;
  duration_min: number | null;
  distance_km: number | null;
};

// A hand log that shadows the watch's own row of the same run is not what the reads
// count (withoutShadowActivities drops it), so a felt effort stated on it lands on the
// synced row instead — the effort is about the run, not about which row was tapped.
function effortTarget(row: EffortRow): EffortRow {
  const sameDay = db
    .prepare(`SELECT id, date, type, source, external_id, duration_min, distance_km FROM activities WHERE date = ?`)
    .all(String(row.date).slice(0, 10)) as EffortRow[];
  return shadowedActivity(row, sameDay) ?? row;
}

/**
 * The run (or other cardio effort) a felt statement about `date` is about: the day's
 * longest non-shadow activity, runs first. Null when the day holds none.
 */
export function resolveEffortActivityId(date: string): number | null {
  const day = String(date || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const rows = withoutShadowActivities(
    db
      .prepare(`SELECT id, date, type, source, external_id, duration_min, distance_km FROM activities WHERE date = ?`)
      .all(day) as EffortRow[]
  );
  if (!rows.length) return null;
  const isRun = (r: EffortRow) => /run/i.test(String(r.type ?? ""));
  const ranked = [...rows].sort(
    (a, b) =>
      Number(isRun(b)) - Number(isRun(a)) ||
      (Number(b.duration_min) || 0) - (Number(a.duration_min) || 0) ||
      b.id - a.id
  );
  return ranked[0].id;
}

export function setActivityFeltEffort(id: unknown, input: { rpe: unknown; note?: unknown }): ActivityEffortResult {
  const activityId = Number(id);
  if (!Number.isInteger(activityId) || activityId <= 0) {
    return { ok: false, code: "invalid_id", error: "activity id must be a positive integer" };
  }
  const rpe = normalizeFeltRpe(input?.rpe);
  if (rpe === undefined) {
    return {
      ok: false,
      code: "invalid_rpe",
      error: "rpe must be a number from 1 (nothing) to 10 (all out), or null to clear",
    };
  }
  const found = getActivity(activityId) as EffortRow | null;
  if (!found) return { ok: false, code: "not_found", error: `activity ${activityId} not found` };
  const target = effortTarget(found);
  const note = typeof input?.note === "string" && input.note.trim() ? input.note.trim().slice(0, FELT_NOTE_MAX) : null;

  const activity = updateActivityFields(target.id, { rpe }) as Record<string, unknown>;
  const date = String(target.date).slice(0, 10);
  // The morning after reads yesterday's work (harm, the run-day intensity floor), so
  // its read moves with this statement too — when that morning has already come.
  const nextMorning = addDaysISO(date, 1);
  if (nextMorning && nextMorning <= localDateISO()) invalidateDayRead(nextMorning);

  const talkTest = syncTalkTest(target.id, date, rpe, note);
  return { ok: true, activity, rpe, stated_easy: isStatedEasyRpe(rpe), talk_test: talkTest };
}

// The run's Garmin row, when it has one with heart rate: the talk-test observation is
// filed against it (a stated easy effort) or withdrawn from it (anything else).
function syncTalkTest(
  activityId: number,
  date: string,
  rpe: number | null,
  note: string | null
): CalibrationEvent | null {
  const garmin = db
    .prepare(
      `SELECT id, type, avg_hr, COALESCE(moving_min, duration_min) AS minutes
         FROM garmin_activities WHERE activity_id = ? ORDER BY id DESC LIMIT 1`
    )
    .get(activityId) as { id: number; type: string | null; avg_hr: number | null; minutes: number | null } | undefined;
  if (!garmin) return null;
  const hr = Number(garmin.avg_hr);
  const isRun = /run/i.test(String(garmin.type ?? ""));
  let event: CalibrationEvent | null = null;
  let changed: boolean;
  if (isRun && Number.isFinite(hr) && hr > 0 && rpe != null && isStatedEasyRpe(rpe)) {
    event = recordTalkTestObservation({
      date,
      garmin_activity_id: Number(garmin.id),
      activity_id: activityId,
      avg_hr: hr,
      minutes: garmin.minutes == null ? null : Number(garmin.minutes),
      rpe,
      note,
    });
    changed = event != null;
  } else {
    changed = clearTalkTestObservation(Number(garmin.id));
  }
  if (changed) {
    try {
      refreshPersistedHrModel();
    } catch {
      /* the nightly derive picks it up — a failed refresh is not a failed statement */
    }
  }
  return event;
}
