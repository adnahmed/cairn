import { db } from "../db.js";
import { LB_PER_KG, localDateISO } from "./shared.js";

export type CanonicalBodyweightSource = "manual" | "garmin";

export interface CanonicalBodyweightPoint {
  date: string;
  weight_lb: number;
  source: CanonicalBodyweightSource;
  source_id: number;
  provenance: "bodyweight_log.weight_lb" | "garmin_daily_metrics.weight_kg";
}

export interface ResolvedCurrentBodyweight {
  date: string | null;
  weight_lb: number;
  source: CanonicalBodyweightSource | "profile";
  source_id: number | null;
  provenance: CanonicalBodyweightPoint["provenance"] | "profile.weight_lb";
}

function dateRange(column: string, since?: string | null, through?: string | null) {
  const clauses: string[] = [];
  const values: string[] = [];
  if (since) {
    clauses.push(`${column} >= ?`);
    values.push(since);
  }
  if (through) {
    clauses.push(`${column} <= ?`);
    values.push(through);
  }
  return { sql: clauses.length ? ` AND ${clauses.join(" AND ")}` : "", values };
}

// Internal calculation series: one lb-valued point per calendar date. Garmin
// fills dates that have no explicit weigh-in; the latest explicit manual row for
// a date wins every same-date collision. Public listWeight remains manual-only.
export function canonicalBodyweightSeries(
  opts: { since?: string | null; through?: string | null } = {}
): CanonicalBodyweightPoint[] {
  const garminRange = dateRange("date", opts.since, opts.through);
  const manualRange = dateRange("date", opts.since, opts.through);
  const garminRows = db
    .prepare(
      `SELECT id, date, weight_kg
         FROM garmin_daily_metrics
        WHERE weight_kg IS NOT NULL${garminRange.sql}
        ORDER BY date, id`
    )
    .all(...garminRange.values) as any[];
  const manualRows = db
    .prepare(
      `SELECT id, date, weight_lb
         FROM bodyweight_log
        WHERE weight_lb IS NOT NULL${manualRange.sql}
        ORDER BY date, id`
    )
    .all(...manualRange.values) as any[];

  const byDate = new Map<string, CanonicalBodyweightPoint>();
  for (const row of garminRows) {
    const date = String(row.date ?? "").slice(0, 10);
    const kg = Number(row.weight_kg);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(kg) || kg <= 0) continue;
    byDate.set(date, {
      date,
      weight_lb: Math.round(kg * LB_PER_KG * 100) / 100,
      source: "garmin",
      source_id: Number(row.id),
      provenance: "garmin_daily_metrics.weight_kg",
    });
  }
  // Manual rows are applied second, so an explicit entry always owns its date.
  // ORDER BY id means the latest manual correction wins among manual duplicates.
  for (const row of manualRows) {
    const date = String(row.date ?? "").slice(0, 10);
    const lb = Number(row.weight_lb);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(lb) || lb <= 0) continue;
    byDate.set(date, {
      date,
      weight_lb: lb,
      source: "manual",
      source_id: Number(row.id),
      provenance: "bodyweight_log.weight_lb",
    });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// Calculations prefer the latest canonical scale point through the requested
// day. The profile is a cold-start fallback only; resolving never writes back.
export function resolvedCurrentBodyweight(profile?: any, through = localDateISO()): ResolvedCurrentBodyweight | null {
  const canonical = canonicalBodyweightSeries({ through });
  const latest = canonical.at(-1);
  if (latest) return latest;
  const profileLb = Number(profile?.weight_lb);
  if (!Number.isFinite(profileLb) || profileLb <= 0) return null;
  return {
    date: null,
    weight_lb: profileLb,
    source: "profile",
    source_id: null,
    provenance: "profile.weight_lb",
  };
}

// ---------- one weigh-in per day ----------
// THE RULE (manual log). A day's bodyweight is ONE number: the LATEST manual entry
// (highest id) for that date owns it — the same "latest manual correction wins" rule
// canonicalBodyweightSeries applies above. A genuinely different second reading the
// same day (a morning and an evening weigh-in, or a corrected typo) stays in the log as
// history, but every TREND, slope, count or first-reached read goes through this, so a
// day weighed three times never pulls a least-squares fit three times as hard or
// clears an "enough weigh-ins" bar on its own. `listWeight` (the athlete's history
// list) stays row-by-row on purpose.
export interface DailyWeighIn {
  id: number;
  date: string;
  weight_lb: number;
  note: string | null;
  created_at: string | null;
}

export function dailyManualWeighIns(
  opts: { since?: string | null; through?: string | null; limit?: number | null } = {}
): DailyWeighIn[] {
  const range = dateRange("b.date", opts.since, opts.through);
  const limit = Number(opts.limit);
  const hasLimit = Number.isFinite(limit) && limit > 0;
  const rows = db
    .prepare(
      `SELECT b.id, b.date, b.weight_lb, b.note, b.created_at
         FROM bodyweight_log b
        WHERE b.weight_lb IS NOT NULL
          AND b.id = (SELECT MAX(i.id) FROM bodyweight_log i WHERE i.date = b.date AND i.weight_lb IS NOT NULL)${range.sql}
        ORDER BY b.date DESC${hasLimit ? " LIMIT ?" : ""}`
    )
    .all(...range.values, ...(hasLimit ? [Math.trunc(limit)] : [])) as any[];
  return rows
    .map((row) => ({
      id: Number(row.id),
      date: String(row.date ?? "").slice(0, 10),
      weight_lb: Number(row.weight_lb),
      note: row.note ?? null,
      created_at: row.created_at ?? null,
    }))
    .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date) && Number.isFinite(row.weight_lb) && row.weight_lb > 0)
    .reverse();
}

// THE RULE (writes). An IDENTICAL value re-submitted for the same date within this
// window is a double submit (a second tap, a retried request, a chat turn and a form
// saying the same thing), not a second weigh-in: logWeight returns the existing row and
// writes nothing. A different value — or the same value outside the window — is a real
// reading and is kept. Migration v115 folds the exact bursts already on disk under the
// same window.
export const WEIGHT_RESUBMIT_WINDOW_MIN = 10;
const SAME_WEIGHT_EPSILON_LB = 0.001;

export function recentIdenticalWeighIn(date: string, weight_lb: number): { id: number; note: string | null } | null {
  const row = db
    .prepare(
      `SELECT id, note FROM bodyweight_log
        WHERE date = ? AND ABS(weight_lb - ?) < ?
          AND created_at IS NOT NULL
          AND created_at >= datetime('now', ?)
        ORDER BY id DESC LIMIT 1`
    )
    .get(date, weight_lb, SAME_WEIGHT_EPSILON_LB, `-${WEIGHT_RESUBMIT_WINDOW_MIN} minutes`) as any;
  return row ? { id: Number(row.id), note: row.note ?? null } : null;
}
