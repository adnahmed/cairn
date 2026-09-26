// ---------- the protein anchor and the observed intake band ----------
//
// The athlete's standing decision: PROTEIN IS THE ANCHOR, and energy is bounded by
// what their own complete logged days and their bodyweight's response show — never by
// a guessed target. This module is that read, and nothing else.
//
// THE LAWS it keeps:
//   - Only days `classifyIntakeDay` reads COMPLETE are evidence (completedIntakeRange
//     over CLOSED days). A partial or unlogged day is absent, never "low": it is not
//     averaged, cannot widen the band and cannot lower it.
//   - The weight response is the canonical bodyweight series (manual weigh-ins own
//     their date, Garmin fills the rest) over the same weeks, plus a short lag.
//   - It is an OBSERVATION. It is not a target, it is not a maintenance measurement,
//     and `capProtectiveRaise` (cut-target.ts) is untouched by it: only measured
//     maintenance caps a protective raise. The band's ceiling is a no-gain intake by
//     construction, so it can never license a surplus.
//   - Protein first. The band bounds ENERGY only; the protein anchor is read from the
//     day's target and nothing here ever trims it.
//   - Too few complete days (or no weigh-ins beside them) → no band, said in words.

import type {
  ClientIntakeBand,
  ClientIntakeBandConfidence,
  ClientIntakeBandWeek,
  ClientIntakeWeekResponse,
  ClientProteinAnchor,
} from "../contracts/fuel.js";
import { canonicalBodyweightSeries } from "./bodyweight.js";
import { completedIntakeRange } from "./intake-window.js";
import { dayIntakeTarget } from "./nutrition.js";
import { computeGoalCheck } from "./profile.js";
import { addDaysISO, localDateISO } from "./shared.js";

export const INTAKE_BAND_WINDOW_WEEKS = 8;
// Fewer complete days than this across the window and there is no band: a week or so
// of whole days cannot show where a weight turns.
export const INTAKE_BAND_MIN_COMPLETE_DAYS = 10;
// A week's average is built only from its complete days, and needs this many.
export const INTAKE_BAND_WEEK_MIN_COMPLETE_DAYS = 3;
// Weeks that carry both an average and a readable weight response.
export const INTAKE_BAND_MIN_RESPONSE_WEEKS = 2;
// Weight moving less than this per week is "steady" — below scale noise.
export const INTAKE_BAND_TREND_DEADBAND_LB = 0.25;
// Intake shows on the scale a little later, so a week's response window runs on.
const RESPONSE_LAG_DAYS = 3;
const RESPONSE_MIN_WEIGH_INS = 2;
const RESPONSE_MIN_SPAN_DAYS = 4;

const round10 = (n: number) => Math.round(n / 10) * 10;
const round50 = (n: number) => Math.round(n / 50) * 50;
const kcalWords = (n: number) => `about ${round50(n).toLocaleString("en-US")} kcal`;

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

// Least-squares slope in lb/day over (dayIndex, weight) points.
function slopePerDay(points: Array<{ x: number; y: number }>): number | null {
  if (points.length < 2) return null;
  const n = points.length;
  const mx = points.reduce((s, p) => s + p.x, 0) / n;
  const my = points.reduce((s, p) => s + p.y, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.x - mx) * (p.y - my);
    den += (p.x - mx) ** 2;
  }
  return den > 0 ? num / den : null;
}

/**
 * The protein anchor: the day's protein target, the accepted target first and the
 * formula otherwise (the same `dayIntakeTarget` the fuel card uses). Null only when
 * the profile cannot derive one. Pass an already-computed goal check to reuse it.
 */
export function proteinAnchor(goal?: any): ClientProteinAnchor | null {
  let target: ReturnType<typeof dayIntakeTarget> = null;
  try {
    target = dayIntakeTarget(goal ?? computeGoalCheck());
  } catch {
    target = null;
  }
  if (!target || !(target.protein_g > 0)) return null;
  const protein_g = Math.round(target.protein_g);
  return {
    protein_g,
    source: target.source,
    words: `Protein comes first: about ${protein_g} g a day. The energy range never trims it.`,
  };
}

export interface IntakeBandOptions {
  /** A goal check already computed by the caller (the coach context), to reuse. */
  goal?: any;
}

/**
 * The observed intake band as of `asOf` (default today): the last
 * INTAKE_BAND_WINDOW_WEEKS closed weeks, complete days only, against the weight's
 * response over the same weeks. PURE of writes; reads the food log and the canonical
 * bodyweight series.
 */
export function intakeBand(asOf: string = localDateISO(), opts: IntakeBandOptions = {}): ClientIntakeBand {
  const through = addDaysISO(asOf, -1) ?? asOf;
  const since = addDaysISO(through, -(INTAKE_BAND_WINDOW_WEEKS * 7 - 1)) ?? through;
  const window = completedIntakeRange(since, through, through);
  const complete = window.days.filter((day) => day.credible);
  const weights = canonicalBodyweightSeries({ since, through: asOf });
  const anchor = proteinAnchor(opts.goal);

  // Calendar weeks ending on `through`, oldest first.
  const weeks: ClientIntakeBandWeek[] = [];
  for (let i = INTAKE_BAND_WINDOW_WEEKS - 1; i >= 0; i--) {
    const week_end = addDaysISO(through, -7 * i) ?? through;
    const week_start = addDaysISO(week_end, -6) ?? week_end;
    const days = complete.filter((day) => day.date >= week_start && day.date <= week_end);
    const kcal_avg =
      days.length >= INTAKE_BAND_WEEK_MIN_COMPLETE_DAYS
        ? Math.round(days.reduce((sum, day) => sum + day.kcal, 0) / days.length)
        : null;
    const responseEnd =
      (addDaysISO(week_end, RESPONSE_LAG_DAYS) ?? week_end) < asOf
        ? (addDaysISO(week_end, RESPONSE_LAG_DAYS) ?? week_end)
        : asOf;
    const points = weights
      .filter((p) => p.date >= week_start && p.date <= responseEnd)
      .map((p) => ({ x: daysBetween(week_start, p.date), y: p.weight_lb }));
    const span = points.length ? Math.max(...points.map((p) => p.x)) - Math.min(...points.map((p) => p.x)) : 0;
    const slope =
      points.length >= RESPONSE_MIN_WEIGH_INS && span >= RESPONSE_MIN_SPAN_DAYS ? slopePerDay(points) : null;
    const perWeek = slope == null ? null : Math.round(slope * 7 * 100) / 100;
    const response: ClientIntakeWeekResponse =
      perWeek == null
        ? "unknown"
        : perWeek <= -INTAKE_BAND_TREND_DEADBAND_LB
          ? "down"
          : perWeek >= INTAKE_BAND_TREND_DEADBAND_LB
            ? "up"
            : "steady";
    weeks.push({
      week_start,
      week_end,
      complete_days: days.length,
      kcal_avg,
      weight_change_lb_per_week: perWeek,
      response,
    });
  }

  const base = {
    kind: "observation" as const,
    as_of: asOf,
    protein_anchor: anchor,
    window: {
      since,
      through: window.through,
      weeks: INTAKE_BAND_WINDOW_WEEKS,
      complete_days: complete.length,
      partial_days: window.partial_days,
      missing_days: window.missing_days,
      weigh_in_days: weights.filter((p) => p.date <= through).length,
    },
    weeks,
  };
  const none = (status: "too_few_days" | "no_weight_response", words: string, reason: string): ClientIntakeBand => ({
    ...base,
    status,
    band: null,
    energy_ceiling_kcal: null,
    confidence: null,
    confidence_words: null,
    words,
    reason,
  });

  if (complete.length < INTAKE_BAND_MIN_COMPLETE_DAYS) {
    const n = complete.length;
    return none(
      "too_few_days",
      `${n === 0 ? "No" : `Only ${n}`} complete ${n === 1 ? "day is" : "days are"} logged in the last ${INTAKE_BAND_WINDOW_WEEKS} weeks, so there's no intake range to read yet. Partial days are left out, never counted as low.`,
      `${n} complete day(s) in ${since}..${window.through}; the band needs ${INTAKE_BAND_MIN_COMPLETE_DAYS}. ${window.partial_days} partial day(s) excluded as absent evidence.`
    );
  }

  const read = weeks.filter(
    (w): w is ClientIntakeBandWeek & { kcal_avg: number } => w.kcal_avg != null && w.response !== "unknown"
  );
  if (read.length < INTAKE_BAND_MIN_RESPONSE_WEEKS) {
    return none(
      "no_weight_response",
      `${complete.length} complete days are logged, but there aren't enough weigh-ins beside them yet to see which way your weight moved.`,
      `${read.length} week(s) carry both a complete-day average and a readable weight slope; the band needs ${INTAKE_BAND_MIN_RESPONSE_WEEKS}.`
    );
  }

  const down = read.filter((w) => w.response === "down").map((w) => w.kcal_avg);
  const up = read.filter((w) => w.response === "up").map((w) => w.kcal_avg);
  const steady = read.filter((w) => w.response === "steady").map((w) => w.kcal_avg);
  const maxDown = down.length ? Math.max(...down) : null;
  const minUp = up.length ? Math.min(...up) : null;
  const mixed = maxDown != null && minUp != null && maxDown >= minUp;

  // The most eaten without an upward trend, below every week that did trend up.
  const nonGain = [...down, ...steady].filter((k) => minUp == null || k < minUp);
  const ceiling = nonGain.length ? round10(Math.max(...nonGain)) : null;

  let low: number;
  let high: number;
  let lowIsLoss: boolean;
  let highIsGain: boolean;
  if (mixed) {
    low = minUp as number;
    high = maxDown as number;
    lowIsLoss = true;
    highIsGain = true;
  } else {
    lowIsLoss = maxDown != null;
    low = maxDown ?? (steady.length ? Math.min(...steady) : (minUp as number));
    highIsGain = minUp != null;
    high = minUp ?? Math.max(...[...down, ...steady]);
  }
  low = round10(low);
  high = round10(Math.max(low, high));

  const bothEdges = maxDown != null && minUp != null;
  const confidence: ClientIntakeBandConfidence = mixed
    ? "low"
    : read.length >= 4 && complete.length >= 21 && (bothEdges || steady.length >= 2)
      ? "high"
      : read.length >= 3
        ? "moderate"
        : "low";
  const confidence_words =
    confidence === "high"
      ? `Several weeks agree (${read.length} readable weeks, ${complete.length} complete days).`
      : confidence === "moderate"
        ? `A few weeks agree (${read.length} readable weeks, ${complete.length} complete days) — a loose read.`
        : mixed
          ? "The weeks disagree with each other, so this is a loose read."
          : `Only ${read.length} readable weeks so far — a loose read.`;

  let words: string;
  if (mixed) {
    words = `The record is mixed: weeks between ${kcalWords(low)} and ${kcalWords(high)} went both ways, so the range is loose.`;
  } else if (maxDown != null && minUp != null) {
    words = `Over the last ${INTAKE_BAND_WINDOW_WEEKS} weeks your weight trended down in weeks averaging up to ${kcalWords(maxDown)} and up in weeks from ${kcalWords(minUp)}.`;
  } else if (maxDown != null) {
    words = `Your weight trended down in weeks averaging up to ${kcalWords(maxDown)}${steady.length ? ` and held around ${kcalWords(Math.max(...steady))}` : ""}; no week at a higher intake has shown a gain yet.`;
  } else if (minUp != null) {
    words = `Your weight trended up in weeks from ${kcalWords(minUp)}${steady.length ? ` and held around ${kcalWords(Math.min(...steady))}` : ""}.`;
  } else {
    words = `Your weight held steady in weeks averaging ${kcalWords(low)}${high !== low ? ` to ${kcalWords(high)}` : ""}.`;
  }
  words += " This is what your logged weeks showed, not a target.";

  return {
    ...base,
    status: "ok",
    band: { low_kcal: low, high_kcal: high, low_is_loss_edge: lowIsLoss, high_is_gain_edge: highIsGain, mixed },
    energy_ceiling_kcal: ceiling,
    confidence,
    confidence_words,
    words,
    reason:
      `${read.length} readable week(s) from ${complete.length} complete day(s) in ${since}..${window.through} ` +
      `(${window.partial_days} partial excluded): down=[${down.join(",")}] steady=[${steady.join(",")}] up=[${up.join(",")}] kcal/day.`,
  };
}
