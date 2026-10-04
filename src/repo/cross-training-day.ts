// THE CROSS-TRAINING DAY — what the athlete SAID, or, failing that, what they DO.
//
// A runner who rides the trails every other Saturday has a week with a ride in it, and
// the brain should plan around that ride rather than read it as a conflict each time it
// lands. Two sources, in the order `strengthScheduleRead` uses for the lifting week:
//
//   1. STATED — `endurance_schedule.cross_training` ({dow, sport, optional: true}), a
//      field of its own so no run-day consumer can ever read it as a run;
//   2. OBSERVED — a non-run, non-light effort of one family (ride, paddle, swim, walk,
//      anything Garmin logs) on the same weekday in at least two of the last six ISO
//      weeks. Every surface says it is a pattern read off the log (`source:"observed"`).
//
// Two weeks is the bar here, not the lifting week's three: a weekend sport is weather-
// and life-dependent, so one in three weeks is already a habit worth planning around,
// and what this read changes is gentle (a known ride stops vetoing the long run the day
// after; it never adds work). This is a READ: nothing here writes a schedule.
import { mondayOf } from "../lib/dates.js";
import { recentEnduranceImpacts, type EnduranceImpact } from "./hybrid-load.js";
import { dowToDayNumber, getEnduranceSchedule, isoDow, WEEKDAY_NAMES } from "./profile.js";
import { addDaysISO, localDateISO } from "./shared.js";
import { copyDeep, requestMemo } from "./request-memo.js";

export const CROSS_TRAINING_WEEKS_WINDOW = 6;
export const CROSS_TRAINING_WEEKS_TO_COUNT = 2;
const MAX_DAYS = 3;

export interface CrossTrainingDay {
  dow: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  /** Mon = 1 … Sun = 7, the run engine's ring. */
  day_number: number;
  weekday: string;
  /** The load family: ride, swim, walk, row, paddle, ski, snow, court, whole_body, other. */
  sport_family: string;
  /** How a sentence names it: the log's own label ("trail MTB") when one recurs, else the family. */
  label: string;
  source: "stated" | "observed";
  optional: boolean;
  /** Weeks of the window with this family on this weekday (null only when nothing was read). */
  weeks_seen: number | null;
  weeks_window: number;
  typical_min: number | null;
  typical_load: "light" | "moderate" | "heavy" | null;
}

// The impact's load family, as the load read stamped it (endurance-sports
// activityLoadFamily). A sport of no known family speaks as "other" here.
export function impactFamily(impact: Pick<EnduranceImpact, "family">): string {
  return impact.family === "whole_body" ? "other" : impact.family;
}

const FAMILY_NOUN: Record<string, string> = {
  ride: "ride",
  swim: "swim",
  walk: "walk",
  row: "row",
  paddle: "paddle",
  ski: "ski",
  snow: "snow day",
  court: "game",
};

/** The plain noun for a family: "ride", "swim", "paddle"; "session" for anything else. */
export function crossTrainingNoun(family: string): string {
  return FAMILY_NOUN[family] ?? "session";
}

// Families whose usual outing loads the run's prime movers. Upper-body days
// (swim, paddle, row) and an unnamed session do not.
const LEG_LOAD_FAMILIES = new Set(["ride", "walk", "snow", "court", "ski"]);

export function crossTrainingLoadsLegs(family: string): boolean {
  return LEG_LOAD_FAMILIES.has(family);
}

const LOAD_RANK = { light: 0, moderate: 1, heavy: 2 } as const;

interface DowFamilyGroup {
  dow: number;
  family: string;
  impacts: EnduranceImpact[];
  weeks: Set<string>;
}

function typicalOf(impacts: EnduranceImpact[]): {
  label: string | null;
  typical_min: number | null;
  typical_load: CrossTrainingDay["typical_load"];
} {
  if (!impacts.length) return { label: null, typical_min: null, typical_load: null };
  const mins = impacts
    .map((i) => i.duration_min ?? 0)
    .filter((m) => m > 0)
    .sort((a, b) => a - b);
  const typical_min = mins.length ? mins[Math.floor(mins.length / 2)] : null;
  const loads = impacts.map((i) => i.load);
  const typical_load: CrossTrainingDay["typical_load"] =
    loads.filter((l) => l === "heavy").length * 2 >= loads.length
      ? "heavy"
      : loads.filter((l) => l !== "light").length * 2 >= loads.length
        ? "moderate"
        : "light";
  const labelCounts = new Map<string, number>();
  for (const i of impacts) labelCounts.set(i.label, (labelCounts.get(i.label) ?? 0) + 1);
  const label = [...labelCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
  return { label, typical_min, typical_load };
}

// Non-run, non-light efforts of the six ISO weeks ending the week of `asOf`, grouped by
// (weekday, family).
function observedGroups(asOf: string): DowFamilyGroup[] {
  const firstMonday = addDaysISO(mondayOf(asOf), -7 * (CROSS_TRAINING_WEEKS_WINDOW - 1)) ?? asOf;
  let impacts: EnduranceImpact[] = [];
  try {
    impacts = recentEnduranceImpacts(CROSS_TRAINING_WEEKS_WINDOW * 7, asOf);
  } catch {
    impacts = [];
  }
  const groups = new Map<string, DowFamilyGroup>();
  for (const impact of impacts) {
    if (impact.date < firstMonday || impact.date > asOf) continue;
    const family = impactFamily(impact);
    if (family === "run") continue;
    if (impact.load === "light") continue;
    const dow = isoDow(impact.date);
    const key = `${dow}:${family}`;
    const group = groups.get(key) ?? { dow, family, impacts: [], weeks: new Set<string>() };
    group.impacts.push(impact);
    group.weeks.add(mondayOf(impact.date));
    groups.set(key, group);
  }
  return [...groups.values()];
}

function heaviest(group: DowFamilyGroup): number {
  return Math.max(...group.impacts.map((i) => LOAD_RANK[i.load] ?? 0));
}

function dayFrom(
  dow: number,
  family: string,
  source: CrossTrainingDay["source"],
  optional: boolean,
  group: DowFamilyGroup | null
): CrossTrainingDay {
  const typical = typicalOf(group?.impacts ?? []);
  const day_number = dowToDayNumber(dow);
  return {
    dow: dow as CrossTrainingDay["dow"],
    day_number,
    weekday: WEEKDAY_NAMES[dow],
    sport_family: family,
    label: typical.label ?? crossTrainingNoun(family),
    source,
    optional,
    weeks_seen: group ? group.weeks.size : source === "stated" ? 0 : null,
    weeks_window: CROSS_TRAINING_WEEKS_WINDOW,
    typical_min: typical.typical_min,
    typical_load: typical.typical_load,
  };
}

/**
 * The recurring cross-training days, best first: the STATED ones when the athlete named
 * any (each carrying what the log shows of it on that weekday), otherwise the OBSERVED
 * pattern, ranked by weeks seen, then the heaviest typical load. One per weekday, at
 * most three. [] when neither.
 */
export function crossTrainingDays(asOf?: string): CrossTrainingDay[] {
  const date = asOf || localDateISO();
  return requestMemo(`cross_training_days:${date}`, () => crossTrainingDaysRead(date), copyDeep);
}

function crossTrainingDaysRead(asOf: string): CrossTrainingDay[] {
  const groups = observedGroups(asOf);
  let stated: NonNullable<ReturnType<typeof getEnduranceSchedule>>["cross_training"] = [];
  try {
    stated = getEnduranceSchedule()?.cross_training ?? [];
  } catch {
    stated = [];
  }
  if (stated.length) {
    return stated.slice(0, MAX_DAYS).map((entry) => {
      const sameDow = groups.filter((g) => g.dow === entry.dow);
      // The log's own read of that weekday: the stated family when it shows, else (an
      // "other" stated day) whatever recurs there most.
      const match =
        sameDow.find((g) => g.family === entry.sport) ??
        (entry.sport === "other" ? sameDow.sort((a, b) => b.weeks.size - a.weeks.size)[0] : undefined) ??
        null;
      return dayFrom(entry.dow, match && entry.sport === "other" ? match.family : entry.sport, "stated", true, match);
    });
  }
  const ranked = groups
    .filter((g) => g.weeks.size >= CROSS_TRAINING_WEEKS_TO_COUNT)
    .sort((a, b) => b.weeks.size - a.weeks.size || heaviest(b) - heaviest(a) || a.dow - b.dow);
  const out: CrossTrainingDay[] = [];
  const seen = new Set<number>();
  for (const group of ranked) {
    if (seen.has(group.dow)) continue;
    seen.add(group.dow);
    out.push(dayFrom(group.dow, group.family, "observed", true, group));
    if (out.length >= MAX_DAYS) break;
  }
  return out;
}

/**
 * The cross-training day `date` falls on, read as of `asOf` (default: `date` itself, so a
 * logged day counts toward its own pattern), or null.
 */
export function isKnownCrossTrainingDate(date: string, asOf?: string): CrossTrainingDay | null {
  const day = String(date).slice(0, 10);
  const dow = isoDow(day);
  return crossTrainingDays(asOf || day).find((d) => d.dow === dow) ?? null;
}
