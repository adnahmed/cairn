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
//   - A week's weight direction counts only when its slope stands clear of the
//     athlete's own scale noise (classifyWeekResponse); a week the scale cannot call
//     is absent, like a partial day — never a guessed direction.
//   - Too few complete days (or no readable weight response beside them) → no band,
//     said in words.

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
// A week's slope is a direction only when it stands this many standard errors clear of
// zero. Daily scale noise (water, food in transit) is about a pound, so a ten-day slope
// carries a standard error near 0.8 lb/week: without this, a steady cut reads a false
// "up" week in roughly one of six weeks, and that one week moves the ceiling.
export const INTAKE_BAND_TREND_MIN_SE = 2;
// "Steady" is a claim too — that the weight did not move — so it needs a slope precise
// enough to rule out a real move: the 2-SE half-width must stay within this (lb/week).
export const INTAKE_BAND_STEADY_MAX_UNCERTAINTY_LB = 0.75;
// The scale-noise floor (lb) the standard error is never computed below: a two-point
// week has no residual to measure, and a perfectly smooth series is not a noiseless one.
export const INTAKE_BAND_NOISE_FLOOR_LB = 0.3;
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

interface SlopeFit {
  /** lb/day */
  slope: number;
  /** Σ(x − x̄)², for the slope's standard error. */
  sxx: number;
  /** Residual sum of squares around the fitted line, and its degrees of freedom. */
  rss: number;
  df: number;
}

// Least-squares slope in lb/day over (dayIndex, weight) points.
function fitSlope(points: Array<{ x: number; y: number }>): SlopeFit | null {
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
  if (!(den > 0)) return null;
  const slope = num / den;
  let rss = 0;
  for (const p of points) rss += (p.y - (my + slope * (p.x - mx))) ** 2;
  return { slope, sxx: den, rss, df: n - 2 };
}

/**
 * Which way one week's weight moved, read against the scale's own noise. `sigma` is
 * the athlete's day-to-day scatter pooled across the whole window (one week's handful
 * of weigh-ins is far too few to measure its own noise). PURE.
 *   - up / down: past the deadband AND at least INTAKE_BAND_TREND_MIN_SE standard
 *     errors clear of zero;
 *   - steady: inside the deadband AND precise enough to rule out a real move;
 *   - unknown: anything else — a week the scale cannot call is absent, never a guess.
 */
export function classifyWeekResponse(
  slopePerDay: number,
  sxx: number,
  sigma: number
): { perWeek: number; response: ClientIntakeWeekResponse } {
  const perWeek = slopePerDay * 7;
  const se = (Math.max(sigma, INTAKE_BAND_NOISE_FLOOR_LB) / Math.sqrt(sxx)) * 7;
  const clear = Math.abs(perWeek) >= INTAKE_BAND_TREND_MIN_SE * se;
  const response: ClientIntakeWeekResponse =
    perWeek <= -INTAKE_BAND_TREND_DEADBAND_LB && clear
      ? "down"
      : perWeek >= INTAKE_BAND_TREND_DEADBAND_LB && clear
        ? "up"
        : Math.abs(perWeek) < INTAKE_BAND_TREND_DEADBAND_LB &&
            INTAKE_BAND_TREND_MIN_SE * se <= INTAKE_BAND_STEADY_MAX_UNCERTAINTY_LB
          ? "steady"
          : "unknown";
  return { perWeek, response };
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

  // Calendar weeks ending on `through`, oldest first. Each week's slope is fitted
  // first; the classification waits for the pooled noise below.
  const fitted: Array<{
    week_start: string;
    week_end: string;
    days: number;
    kcal_avg: number | null;
    fit: SlopeFit | null;
  }> = [];
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
    const fit = points.length >= RESPONSE_MIN_WEIGH_INS && span >= RESPONSE_MIN_SPAN_DAYS ? fitSlope(points) : null;
    fitted.push({ week_start, week_end, days: days.length, kcal_avg, fit });
  }
  // The athlete's own scale noise, pooled over every week that has residuals to give.
  const pooledRss = fitted.reduce((sum, w) => sum + (w.fit && w.fit.df > 0 ? w.fit.rss : 0), 0);
  const pooledDf = fitted.reduce((sum, w) => sum + (w.fit && w.fit.df > 0 ? w.fit.df : 0), 0);
  const sigma = pooledDf > 0 ? Math.sqrt(pooledRss / pooledDf) : INTAKE_BAND_NOISE_FLOOR_LB;
  const weeks: ClientIntakeBandWeek[] = fitted.map((w) => {
    const read = w.fit ? classifyWeekResponse(w.fit.slope, w.fit.sxx, sigma) : null;
    return {
      week_start: w.week_start,
      week_end: w.week_end,
      complete_days: w.days,
      kcal_avg: w.kcal_avg,
      weight_change_lb_per_week: read ? Math.round(read.perWeek * 100) / 100 : null,
      response: read ? read.response : "unknown",
    };
  });

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

  // Weeks with enough weigh-ins to fit a slope at all, readable or not.
  const weighedWeeks = fitted.filter((w) => w.kcal_avg != null && w.fit).length;
  const read = weeks.filter(
    (w): w is ClientIntakeBandWeek & { kcal_avg: number } => w.kcal_avg != null && w.response !== "unknown"
  );
  if (read.length < INTAKE_BAND_MIN_RESPONSE_WEEKS) {
    return none(
      "no_weight_response",
      weighedWeeks < INTAKE_BAND_MIN_RESPONSE_WEEKS
        ? `${complete.length} complete days are logged, but there aren't enough weigh-ins beside them yet to see which way your weight moved.`
        : `${complete.length} complete days are logged, but the scale's day-to-day swings are still larger than the trend, so it doesn't yet show which way your weight moved in those weeks.`,
      `${read.length} week(s) carry both a complete-day average and a weight slope clear of the scale's own noise (pooled scatter ${Math.round(sigma * 100) / 100} lb); the band needs ${INTAKE_BAND_MIN_RESPONSE_WEEKS}.`
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
      `(${window.partial_days} partial excluded): down=[${down.join(",")}] steady=[${steady.join(",")}] up=[${up.join(",")}] kcal/day; ` +
      `weeks the scale could not call (pooled scatter ${Math.round(sigma * 100) / 100} lb) are left out.`,
  };
}
