// One tape reading per site per day — the single read rule for `body_measurements`.
//
// THE RULE. A same-day re-entry of a site SUPERSEDES the earlier value for that day:
// the latest row (highest id) carrying that site owns the date. Measuring twice and
// correcting one site is the common case — the second session usually re-types the
// sites that were fine and fixes the one that was off — so every reader that walks a
// site over time (the trend lines, the waist-flow gate, the underfueling body channel,
// the brain's waist evaluator) reads ONE value per date through here, never the raw
// rows. A day taped twice is one data point, not two, and never pulls a slope toward
// itself or clears an "enough readings" bar on its own.
//
// History is kept: the earlier row is not deleted (it is the athlete's own entry and
// may carry sites the later session skipped — a site the later row leaves NULL does
// not supersede anything, so the earlier value still stands for that site).
// `listBodyMeasurements` stays row-by-row for the history list.
//
// Leaf module: imports only the database, so evaluators / underfueling / nutrition can
// read it without cycling through body-metrics.ts (which imports profile.ts).
import { db } from "../db.js";

export const MEASUREMENT_SITE_COLUMNS = [
  "waist_in",
  "hip_in",
  "chest_in",
  "shoulder_in",
  "neck_in",
  "thigh_in",
  "upper_arm_in",
  "calf_in",
  "forearm_in",
] as const;
export type MeasurementSiteColumn = (typeof MEASUREMENT_SITE_COLUMNS)[number];

export interface DailySiteReading {
  /** The row that owns this date for this site (the latest one carrying it). */
  id: number;
  date: string;
  value: number;
}

function isSiteColumn(site: string): site is MeasurementSiteColumn {
  return (MEASUREMENT_SITE_COLUMNS as readonly string[]).includes(site);
}

/**
 * The site's readings, ONE per date (latest same-day row wins), chronological.
 * `since`/`through` bound the date inclusively. An unknown site reads as [] — the
 * column name is interpolated, so it is checked against the fixed list first.
 */
export function dailySiteSeries(
  site: string,
  opts: { since?: string | null; through?: string | null } = {}
): DailySiteReading[] {
  if (!isSiteColumn(site)) return [];
  const clauses: string[] = [];
  const values: string[] = [];
  if (opts.since) {
    clauses.push("m.date >= ?");
    values.push(opts.since);
  }
  if (opts.through) {
    clauses.push("m.date <= ?");
    values.push(opts.through);
  }
  const rows = db
    .prepare(
      `SELECT m.id, m.date, m.${site} AS value
         FROM body_measurements m
        WHERE m.${site} IS NOT NULL
          AND m.id = (SELECT MAX(i.id) FROM body_measurements i WHERE i.date = m.date AND i.${site} IS NOT NULL)
          ${clauses.length ? `AND ${clauses.join(" AND ")}` : ""}
        ORDER BY m.date ASC`
    )
    .all(...values) as any[];
  return rows
    .map((row) => ({ id: Number(row.id), date: String(row.date ?? "").slice(0, 10), value: Number(row.value) }))
    .filter((row) => Number.isFinite(row.value));
}
