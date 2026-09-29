// HOW HARD A RUN WAS — read off the athlete, never the watch (owner law, 2026-09-25:
// "Garmin te_label must never classify his runs; use the personal HR model").
//
// The one answer every intensity reader asks for a RUN with an average heart rate and
// a usable personal model: the harm read's hard-cardio bar (`hardCardioDayCore`), the
// day-load grade (`cardioEffort`/`dayLoad`, training-read.ts) and the per-muscle
// endurance dose (`classifyImpactLoad`, hybrid-load.ts). A run is HARD when
//   • `classifyRunEffort` reads it as quality against his own zones (above the steady
//     band for 12+ minutes, or 75+ minutes held in it);
//   • the athlete NAMED it quality ("Hills", "5k+sprints", "LT HR Test" —
//     `namesQualityRun`): an interval day's recoveries pull the average into the
//     steady band, and his title is his own input;
//   • HARD_EFFORT.z4Seconds sat in heart-rate bins lying wholly ABOVE his threshold
//     band (bin floor > z4_top). Garmin's bins are drawn on Garmin's zones, so a bin
//     straddling his line proves nothing either way.
// Training effect, te_label, time in Garmin's Z4 and the training load no longer speak
// for such a run: the load is Garmin's EPOC estimate, the quantity the training effect
// is itself computed from.
//
// Null means the personal model cannot judge (not a run, no heart rate, no usable
// model) and the caller keeps its old bars — rides, hikes, runs before any model.
// A run the athlete STATED easy (stated-effort.ts) is not hard whatever this says;
// callers check that first, since it holds with or without a model.
import { canonicalEnduranceSport } from "./endurance-sports.js";
import { HARD_EFFORT } from "./heavy-load.js";
import { classifyRunEffort, getHrModel, type HrModel } from "./hr-model.js";
import { namesQualityRun } from "./stated-effort.js";

export interface PersonalRunRead {
  hard: boolean;
  /** The personal model's own read of the average: easy / steady / quality. */
  effort: "easy" | "steady" | "quality";
}

/** The personal model as of `date`, when it can judge a run at all — the bar
 * runIntensityDiscipline holds: not insufficient, and a plausible easy line. */
export function usablePersonalHrModel(date: string): HrModel | null {
  try {
    const m = getHrModel(date);
    return m.confidence !== "insufficient" && m.zones && m.lthr != null && m.zones.z2_top >= 100 ? m : null;
  } catch {
    return null;
  }
}

export function personalRunRead(
  run: { avg_hr?: unknown; minutes?: unknown; names?: unknown[]; zones?: unknown },
  model: HrModel | null
): PersonalRunRead | null {
  if (!model?.zones) return null;
  const avg = Number(run.avg_hr);
  if (!Number.isFinite(avg) || avg <= 0) return null;
  const minutesRaw = run.minutes == null ? null : Number(run.minutes);
  const minutes = minutesRaw != null && Number.isFinite(minutesRaw) ? minutesRaw : null;
  const effort = classifyRunEffort(avg, minutes, model);
  if (effort === "unknown") return null;
  if (effort === "quality") return { hard: true, effort };
  if ((run.names ?? []).some((name) => namesQualityRun(name))) return { hard: true, effort };
  let above = 0;
  try {
    const z = typeof run.zones === "string" ? JSON.parse(run.zones) : run.zones;
    if (Array.isArray(z))
      for (const it of z) {
        const floor = Number(it?.low_hr);
        if (Number.isFinite(floor) && floor > model.zones.z4_top) above += Number(it?.secs ?? it?.seconds ?? 0) || 0;
      }
  } catch {
    /* malformed zone blob → no time evidence */
  }
  return { hard: above >= HARD_EFFORT.z4Seconds, effort };
}

/**
 * The personal read of one activities ⨝ garmin_activities row: null when it is not a
 * run with heart rate, or no usable model exists (the caller keeps the watch's bars).
 * Rows carry `type`, `avg_hr`, `hr_minutes`, `g_name`, `raw_text` and `zones`; the
 * model is a thunk so a day with no run never pays for one.
 */
export function personalRunReadForRow(r: any, model: () => HrModel | null): PersonalRunRead | null {
  if (canonicalEnduranceSport(r?.type).key !== "run") return null;
  const avg = Number(r?.avg_hr);
  if (!Number.isFinite(avg) || avg <= 0) return null;
  return personalRunRead(
    { avg_hr: avg, minutes: r.hr_minutes, names: [r.g_name, r.raw_text], zones: r.zones },
    model()
  );
}
