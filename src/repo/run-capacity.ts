// ============================================================================
// run-capacity.ts — what the athlete's running has already DEMONSTRATED.
//
// The run engine is reactive: each week steps off the closed week before it. That
// forgets ground already covered — one light week (a recovery dip, a trip, a cold)
// and the build re-climbs from there, so the race ladder could peak below a week the
// athlete ran a fortnight earlier. This module is the read the engine and the ladder
// share for "what has this athlete already shown they can carry":
//
//   • floor_km — the best closed Mon–Sun week of the last DEMONSTRATED_CAPACITY_WEEKS
//     that carried NO harm evidence. Harm is `harmEvidenceOnDay` on every run day of
//     the week, the one law (a poor rating, a longest run past the build's ceiling, an
//     intense hard day the next morning did not absorb, a rest-grade or past-band next
//     morning) — never re-derived here. A week the body paid for is set aside and the
//     floor falls back to the best week it did not: capacity is not pushed through harm.
//   • Harm on a day a trip or an illness covers (the day or its next morning) is
//     CONFOUNDED — the travel or the bug talking, not the running — and is not charged
//     to the week (the travel-confounder law underfueling.ts already follows). And a
//     light week of that kind never lowers the floor: the floor is a max, so a lighter
//     week simply is not it.
//   • long_km — the longest run of the last 28 days taken well (`demonstratedLongKm`).
//   • best_week_km — the biggest closed week on record, harm or not: what a "new
//     weekly high" is said against.
//
// Read-only and deterministic. It never prescribes: `raceRamp` turns the floor into a
// peak target and `capacityResumeKm` into a bounded resume (run-ramp.ts).
// ============================================================================

import { db } from "../db.js";
import { addDaysISO, daysBetweenISO, isoDaysAgo, mondayOf } from "../lib/dates.js";
import { round1 } from "../lib/numbers.js";
import { withoutShadowActivities } from "./activity-shadow.js";
import { harmEvidenceOnDay, type HarmEvidence } from "./brain/read-adherence.js";
import { activitySportWhere, RUN_SPORT_PATTERNS } from "./endurance-sports.js";
import { DEMONSTRATED_CAPACITY_WEEKS } from "./run-ramp.js";
import { tripCoversDay } from "./underfueling.js";

export interface DemonstratedRunCapacity {
  /** The closed-week anchor the read is taken at (the Sunday a week closed on). */
  as_of: string;
  window_weeks: number;
  /** The best closed week of the window with no harm evidence, km. Null when none. */
  floor_km: number | null;
  floor_week_start: string | null;
  /** Bigger weeks of the window passed over because the body paid for them. */
  set_aside: { week_start: string; km: number; harm: HarmEvidence }[];
  /** The biggest closed week on record, harm or not, km. */
  best_week_km: number | null;
  /** The longest run of the 28 days ending `as_of` taken well, km. */
  long_km: number | null;
}

interface RunDay {
  date: string;
  km: number;
}

function runDays(from: string | null, to: string): RunDay[] {
  try {
    const sport = activitySportWhere("activities", RUN_SPORT_PATTERNS);
    const rows = withoutShadowActivities(
      db
        .prepare(
          `SELECT date, type, source, external_id, duration_min, distance_km FROM activities
            WHERE ${from ? "date >= ? AND " : ""}date <= ? AND distance_km > 0 AND (${sport.sql})`
        )
        .all(...(from ? [from, to] : [to]), ...sport.params) as any[]
    );
    return rows
      .map((r) => ({ date: String(r.date).slice(0, 10), km: Number(r.distance_km) }))
      .filter((r) => Number.isFinite(r.km) && r.km > 0);
  } catch {
    return [];
  }
}

function weekTotals(runs: RunDay[]): Map<string, { km: number; dates: string[] }> {
  const weeks = new Map<string, { km: number; dates: string[] }>();
  for (const r of runs) {
    const wk = mondayOf(r.date);
    const cur = weeks.get(wk) ?? { km: 0, dates: [] };
    cur.km += r.km;
    if (!cur.dates.includes(r.date)) cur.dates.push(r.date);
    weeks.set(wk, cur);
  }
  return weeks;
}

function illnessCoversDay(iso: string): boolean {
  try {
    return !!db
      .prepare(
        `SELECT 1 FROM context_events
          WHERE kind IN ('illness','sick') AND (archived IS NULL OR archived = 0)
            AND (start_date IS NULL OR start_date <= ?)
            AND COALESCE(end_date, resolved_at, ?) >= ? LIMIT 1`
      )
      .get(iso, iso, iso);
  } catch {
    return false;
  }
}

/** A trip or an illness covers the day's run or the morning that judges it. */
function confoundedDay(iso: string): boolean {
  const next = addDaysISO(iso, 1);
  const days = next ? [iso, next] : [iso];
  return days.some((d) => {
    try {
      return tripCoversDay(d) || illnessCoversDay(d);
    } catch {
      return false;
    }
  });
}

/**
 * The harm evidence a week's running carried: the first run day `harmEvidenceOnDay`
 * does not clear, when no trip or illness confounds it. `confounded` says harm was
 * found only on confounded days.
 */
export function weekRunHarm(runDates: readonly string[]): { harm: HarmEvidence | null; confounded: boolean } {
  let confounded = false;
  for (const date of [...runDates].sort()) {
    let found: HarmEvidence | null = null;
    try {
      found = harmEvidenceOnDay(date);
    } catch {
      found = null;
    }
    if (!found) continue;
    if (confoundedDay(date)) {
      confounded = true;
      continue;
    }
    return { harm: found, confounded };
  }
  return { harm: null, confounded };
}

/**
 * The harm evidence of the Mon–Sun week holding `dateISO`, when its running carried any —
 * for a week still being run, the harm so far.
 */
export function closedWeekRunHarm(dateISO: string): HarmEvidence | null {
  const monday = mondayOf(dateISO);
  const sunday = addDaysISO(monday, 6) ?? dateISO;
  const dates = [...new Set(runDays(monday, sunday).map((r) => r.date))];
  return dates.length ? weekRunHarm(dates).harm : null;
}

/**
 * The longest run of the 28 days ending `asOf` the athlete took WELL —
 * `harmEvidenceOnDay` clears its day (no poor rating, not past the build's own
 * ceiling, no bad next morning). That is capacity already demonstrated: the ladder
 * holds it on a reset and steps off it on a build, never plans a climb back up to it,
 * and the long-run peak never lands under it. A longest the body paid for is not
 * counted; the next-longest that it took well is. Null when none.
 */
export function demonstratedLongKm(asOf: string, runs: { date: string; km: number }[]): number | null {
  const recent = runs
    .filter((r) => r.km > 0 && r.date <= asOf && (daysBetweenISO(asOf, r.date) ?? 99) <= 28)
    .sort((a, b) => b.km - a.km);
  for (const r of recent) {
    let harmed = false;
    try {
      harmed = harmEvidenceOnDay(r.date) != null;
    } catch {
      harmed = false;
    }
    if (!harmed) return round1(r.km);
  }
  return null;
}

/**
 * What the running has demonstrated as of `anchorISO` — the last day of the closed
 * week the read looks back from (the engine's volume anchor: the Sunday before the
 * week being planned). Only CLOSED weeks count, so the read is a property of the week
 * and never chases itself mid-week.
 */
export function demonstratedRunCapacity(anchorISO: string): DemonstratedRunCapacity {
  const anchor = String(anchorISO).slice(0, 10);
  const lastMonday = mondayOf(anchor);
  // A week counts only once it has closed at the anchor.
  const lastClosedMonday =
    addDaysISO(lastMonday, 6) === anchor ? lastMonday : (addDaysISO(lastMonday, -7) ?? lastMonday);
  const firstMonday = addDaysISO(lastClosedMonday, -7 * (DEMONSTRATED_CAPACITY_WEEKS - 1)) ?? lastClosedMonday;
  const closedEnd = addDaysISO(lastClosedMonday, 6) ?? anchor;
  const allRuns = runDays(null, closedEnd);
  const weeks = weekTotals(allRuns);
  let best = 0;
  for (const w of weeks.values()) best = Math.max(best, w.km);

  const window = [...weeks.entries()]
    .filter(([wk]) => wk >= firstMonday && wk <= lastClosedMonday)
    .map(([week_start, w]) => ({ week_start, km: round1(w.km), dates: w.dates }))
    .sort((a, b) => b.km - a.km || b.week_start.localeCompare(a.week_start));
  let floor: { week_start: string; km: number } | null = null;
  const set_aside: DemonstratedRunCapacity["set_aside"] = [];
  for (const week of window) {
    const { harm } = weekRunHarm(week.dates);
    if (harm) {
      set_aside.push({ week_start: week.week_start, km: week.km, harm });
      continue;
    }
    floor = { week_start: week.week_start, km: week.km };
    break;
  }
  return {
    as_of: anchor,
    window_weeks: DEMONSTRATED_CAPACITY_WEEKS,
    floor_km: floor?.km ?? null,
    floor_week_start: floor?.week_start ?? null,
    set_aside,
    best_week_km: best > 0 ? round1(best) : null,
    long_km: demonstratedLongKm(
      closedEnd,
      allRuns.filter((r) => r.date >= isoDaysAgo(closedEnd, 28))
    ),
  };
}
