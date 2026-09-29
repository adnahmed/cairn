// ============================================================================
// felt-brake.ts — when a run-down check-in may carry a day (owner ruling, 2026-09-29).
//
// A check-in is one tap the athlete gives "no big thought". On its own it EASES a
// day; it takes the day (REST) only when something OBJECTIVE agrees with it about the
// same 24 hours. This module is the one answer to both halves of that question, so
// the day read, and anything else that asks "was that tap news?" (the recovery-week
// refusal), cannot come to disagree about it:
//   • isRunDownCheckin — energy ≤ 2, or sleep-feel ≤ 2 WITHOUT energy ≥ 4 (a poor
//     night they feel fine after is MIXED, not run-down).
//   • feltRestCorroborated — a rest-grade morning reading, a genuinely short last
//     night, last night's HRV/RHR past the athlete's own band or a short-sleep
//     constraint on the board (FELT_REST_CORROBORATION, signal-state.ts), or
//     yesterday's harm evidence.
//   • runDownCheckinCorroboratedOn — both, for one date, off that date's own inputs.
// Illness is not a tap and is not asked here: "I'm sick" rests the day on its own.
// ============================================================================
import { harmEvidenceOnDay, withMorningReadiness } from "./brain/read-adherence.js";
import { getCheckinByDate, getRecoverySummary, latestSleep } from "./coach.js";
import { dayPlanningSignalState } from "./day-read.js";
import { readsRestGradeReadiness } from "./readiness-bands.js";
import { isReadDayReadiness, LAST_NIGHT_MAX_AGE_DAYS } from "./sensor-freshness.js";
import { addDaysISO } from "./shared.js";
import { hasFeltRestCorroboration, type SignalDimension, type SignalDimensionState } from "./signal-state.js";

/** A last night under this many minutes is genuinely short — objective, not felt. */
export const FELT_REST_SHORT_NIGHT_MIN = 300;

type CheckinLike = { energy?: unknown; sleep_feel?: unknown } | null | undefined;

const tapAtOrBelow = (value: unknown, bar: number): boolean => value != null && Number(value) <= bar;

/** A check-in that reads run-down: low energy, or a low sleep-feel not offset by good energy. */
export function isRunDownCheckin(checkin: CheckinLike): boolean {
  if (!checkin) return false;
  if (tapAtOrBelow(checkin.energy, 2)) return true;
  return tapAtOrBelow(checkin.sleep_feel, 2) && !(checkin.energy != null && Number(checkin.energy) >= 4);
}

export interface FeltRestCorroborationInput {
  /** The day being read; yesterday's harm evidence is looked up from it. */
  date: string;
  dimensions: Record<SignalDimension, SignalDimensionState>;
  /** A read-day readiness reading in the rest-grade band. */
  restGradeReadiness: boolean;
  /** Last night's sleep in minutes (the night dated `date`), or null. */
  lastNightMin: number | null | undefined;
}

/** Whether anything OBJECTIVE agrees with a felt brake about the same 24 hours. */
export function feltRestCorroborated(input: FeltRestCorroborationInput): boolean {
  if (input.restGradeReadiness) return true;
  const night = Number(input.lastNightMin);
  if (input.lastNightMin != null && night > 0 && night < FELT_REST_SHORT_NIGHT_MIN) return true;
  if (hasFeltRestCorroboration(input.dimensions)) return true;
  const yesterday = addDaysISO(input.date, -1);
  if (!yesterday) return false;
  try {
    return harmEvidenceOnDay(yesterday) != null;
  } catch {
    return false;
  }
}

/**
 * Did a run-down check-in on `date` carry that day — was it corroborated? False for
 * a day with no run-down check-in. Every input is read as of `date`, the same
 * producers the day read uses, and a producer that fails answers "not corroborated":
 * a lone tap stays slight input rather than being promoted by an unreadable table.
 */
export function runDownCheckinCorroboratedOn(date: string): boolean {
  try {
    const checkin = getCheckinByDate(date) as CheckinLike;
    if (!isRunDownCheckin(checkin)) return false;
    const recovery = withMorningReadiness(getRecoverySummary(14, undefined, date), date) as any;
    const readinessQuality =
      recovery?.quality?.training_readiness ?? recovery?.recovery?.quality?.training_readiness ?? null;
    const restGradeReadiness =
      isReadDayReadiness(readinessQuality?.latest_date ?? null, date) &&
      readsRestGradeReadiness(recovery?.recovery?.training_readiness ?? null);
    const lastNight = latestSleep(LAST_NIGHT_MAX_AGE_DAYS, date) as { total_min?: number | null } | null;
    const state = dayPlanningSignalState(date, { recovery, checkin });
    return feltRestCorroborated({
      date,
      dimensions: state.dimensions,
      restGradeReadiness,
      lastNightMin: lastNight?.total_min ?? null,
    });
  } catch {
    return false;
  }
}
