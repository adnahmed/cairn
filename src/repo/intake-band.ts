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
//     their date, Garmin fills the rest), screened by the shared scale-quality rule
//     (`robustWeightTrend`, weight-evidence.ts — the same one expenditure uses), over
//     the same weeks shifted by a short lag.
//   - It is an OBSERVATION. It is not a target, it is not a maintenance measurement,
//     and `capProtectiveRaise` (cut-target.ts) is untouched by it: only measured
//     maintenance caps a protective raise. The band's ceiling is a no-gain intake by
//     construction, so it can never license a surplus.
//   - Protein first. The band bounds ENERGY only; the protein anchor is read from the
//     day's target and nothing here ever trims it.
//   - Too few complete days (or no readable weight response beside them) → no band,
//     said in words.
//
// HOW THE SIGNAL IS RECOVERED on a real, noisy scale. A pound of day-to-day scatter
// swamps any ONE week: a ten-day slope carries a standard error near 0.8 lb/week, so a
// true half-pound-a-week drift almost never stands clear of it and a week-by-week read
// comes back "unknown" nearly every time. So the band is read from the weeks POOLED:
//   1. One continuous weight line is fitted through the whole window by least
//      squares: a level, plus a slope for each week (the week's response window —
//      the week shifted by RESPONSE_LAG_DAYS). That is the smoothed trend; a week's
//      weigh-ins inform its neighbours through the shared level instead of each week
//      standing alone.
//   2. Weeks that carry a complete-day average AND weigh-ins are the evidence. They
//      share slopes by intake: every week below an intake split shares one slope,
//      every week above it another. Each split between two observed weekly averages
//      is tried, and the one that fits best is kept only when the two slopes differ
//      by at least SPLIT_MIN_Z standard errors; otherwise all the evidence weeks share
//      one slope. A week without complete days (or without weigh-ins) keeps a slope of
//      its own that is never attributed to any intake.
//   3. Standard errors come from the residual scatter (floored at the noise floor)
//      under day-to-day carry-over: the lag-one autocorrelation of the residuals feeds
//      an AR(1) sandwich covariance (a salty dinner shows on two mornings, which is
//      one observation, not two).
//   4. Each side's slope is classified against its own standard error exactly like a
//      week used to be (classifyTrend), and the band follows from the sides: the most
//      eaten where the weight still came down, the least eaten where it went up.
//   5. How far the separation (or a one-sided trend) stands clear of the noise is the
//      confidence, spoken as tentative / observed / strong. A read that only shows the
//      weight holding level has located no turn, so it is never more than tentative.

import type {
  ClientIntakeBand,
  ClientIntakeBandConfidence,
  ClientIntakeBandGroup,
  ClientIntakeBandWeek,
  ClientIntakeWeekResponse,
  ClientProteinAnchor,
} from "../contracts/fuel.js";
import { canonicalBodyweightSeries } from "./bodyweight.js";
import { completedIntakeRange } from "./intake-window.js";
import { dayIntakeTarget } from "./nutrition.js";
import { computeGoalCheck } from "./profile.js";
import { addDaysISO, localDateISO } from "./shared.js";
import { robustWeightTrend } from "./weight-evidence.js";
import { round2 } from "../lib/numbers.js";

// Twelve weeks: long enough that ordinary week-to-week swings in intake put weeks on
// both sides of where the weight turns, short enough to describe the athlete now.
export const INTAKE_BAND_WINDOW_WEEKS = 12;
// Fewer complete days than this across the window and there is no band: a week or so
// of whole days cannot show where a weight turns.
export const INTAKE_BAND_MIN_COMPLETE_DAYS = 10;
// A week's average is built only from its complete days, and needs this many.
export const INTAKE_BAND_WEEK_MIN_COMPLETE_DAYS = 3;
// Weeks that carry both an average and weigh-ins — overall, and on each side of a split.
export const INTAKE_BAND_MIN_RESPONSE_WEEKS = 2;
// Weight moving less than this per week is "steady" — below scale noise.
export const INTAKE_BAND_TREND_DEADBAND_LB = 0.25;
// A slope is a direction only when it stands this many standard errors clear of zero.
export const INTAKE_BAND_TREND_MIN_SE = 2;
// "Steady" is a claim too — that the weight did not move — so it needs a slope precise
// enough to rule out a real move: the 2-SE half-width must stay within this (lb/week).
export const INTAKE_BAND_STEADY_MAX_UNCERTAINTY_LB = 0.75;
// The scale-noise floor (lb) the standard error is never computed below: a two-point
// week has no residual to measure, and a perfectly smooth series is not a noiseless one.
export const INTAKE_BAND_NOISE_FLOOR_LB = 0.3;
// The weeks below and above an intake split must differ by this many standard errors
// before the split is believed. Stricter than a single test's 2: the best of up to a
// dozen candidate splits is being kept, and pure noise must not buy a turn.
export const INTAKE_BAND_SPLIT_MIN_Z = 2.5;
// How far the separation (or a one-sided trend) must stand clear of the noise, in
// standard errors, for each confidence word. Below OBSERVED the read is tentative.
export const INTAKE_BAND_OBSERVED_Z = 3.5;
export const INTAKE_BAND_STRONG_Z = 5;
const OBSERVED_MIN_WEEKS = 4;
// A located turn is more than tentative only with this many weeks on EACH side of it:
// two extreme weeks alone are too easily a pair of noisy ones.
const TURN_MIN_SIDE_WEEKS = 3;
const STRONG_MIN_WEEKS = 6;
const STRONG_MIN_COMPLETE_DAYS = 28;
// Intake shows on the scale a little later (water and glycogen follow within a day or
// two), so each week's response window is the week shifted this many days on.
const RESPONSE_LAG_DAYS = 1;
const RESPONSE_MIN_WEIGH_INS = 2;
const RESPONSE_MIN_SPAN_DAYS = 4;
// Carry-over from one morning to the next is capped here, so a badly fitted series
// cannot inflate its standard errors without bound.
const MAX_AUTOCORRELATION = 0.8;
// χ² with one degree of freedom at 99%: the profile-likelihood margin for where a split
// sits. Wide on purpose: the loss edge and the ceiling come from its low end, so an
// uncertain turn under-claims how much can be eaten rather than over-claims it.
const PROFILE_CHI2_99 = 6.63;

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
 * Which way a weight trend moved, given its slope and standard error (both lb/week).
 * PURE. The one classification every read here uses:
 *   - up / down: past the deadband AND at least INTAKE_BAND_TREND_MIN_SE standard
 *     errors clear of zero;
 *   - steady: inside the deadband AND precise enough to rule out a real move;
 *   - unknown: anything else — a trend the scale cannot call is absent, never a guess.
 */
export function classifyTrend(perWeek: number, sePerWeek: number): ClientIntakeWeekResponse {
  const clear = Math.abs(perWeek) >= INTAKE_BAND_TREND_MIN_SE * sePerWeek;
  if (perWeek <= -INTAKE_BAND_TREND_DEADBAND_LB && clear) return "down";
  if (perWeek >= INTAKE_BAND_TREND_DEADBAND_LB && clear) return "up";
  if (
    Math.abs(perWeek) < INTAKE_BAND_TREND_DEADBAND_LB &&
    INTAKE_BAND_TREND_MIN_SE * sePerWeek <= INTAKE_BAND_STEADY_MAX_UNCERTAINTY_LB
  )
    return "steady";
  return "unknown";
}

/**
 * Which way ONE week's weight moved, read against the scale's own noise. `sigma` is
 * the athlete's day-to-day scatter pooled across the whole window (one week's handful
 * of weigh-ins is far too few to measure its own noise). PURE. Kept for the per-week
 * rows; the band itself is read from the pooled weeks (fitIntakeResponse).
 */
export function classifyWeekResponse(
  slopePerDay: number,
  sxx: number,
  sigma: number
): { perWeek: number; response: ClientIntakeWeekResponse } {
  const perWeek = slopePerDay * 7;
  const se = (Math.max(sigma, INTAKE_BAND_NOISE_FLOOR_LB) / Math.sqrt(sxx)) * 7;
  return { perWeek, response: classifyTrend(perWeek, se) };
}

// ---------- the pooled fit (PURE) ----------

/** One week of the window: where its response window starts (a day index) and its average. */
export interface IntakeResponseWeek {
  /** Day index (same axis as the points) the week's 7-day response window opens on. */
  start: number;
  /** Complete-day average, kcal/day — null when the week is not intake evidence. */
  kcal: number | null;
}

export interface IntakeResponseGroup {
  /** Indexes into the weeks passed in. */
  weeks: number[];
  kcal_min: number;
  kcal_max: number;
  per_week: number;
  se_per_week: number;
  response: ClientIntakeWeekResponse;
}

export interface IntakeResponseFit {
  /** 1 group (no split stood clear of the noise) or 2 (lower intakes first). */
  groups: IntakeResponseGroup[];
  /** Standard errors separating the two groups' slopes; null with one group. */
  split_z: number | null;
  /**
   * Where the split plausibly sits (two groups only): every candidate split whose fit
   * is within a 99% profile-likelihood margin of the best one, as the lowest lower-side
   * top and the highest upper-side bottom (kcal/day). The turn lies in this range; a
   * single best split would pretend to know it to the week.
   */
  boundary: { low_kcal: number; high_kcal: number } | null;
  /** Residual scatter around the fitted line (floored), lb. */
  sigma: number;
  /** Lag-one autocorrelation of the residuals (clamped to [0, 0.8]). */
  rho: number;
  points: number;
}

// Solve (XᵀX + ridge)β = Xᵀy and return β with (XᵀX + ridge)⁻¹. Gauss-Jordan with
// partial pivoting; the matrices here are at most ~15 × 15. Null when singular.
function leastSquares(
  rows: number[][],
  y: number[],
  ridge: number[]
): { beta: number[]; inv: number[][]; rss: number; resid: number[] } | null {
  const p = ridge.length;
  const a: number[][] = Array.from({ length: p }, (_, i) => {
    const row = new Array(2 * p + 1).fill(0);
    row[p + i] = 1;
    return row;
  });
  for (let r = 0; r < rows.length; r++) {
    const x = rows[r];
    for (let i = 0; i < p; i++) {
      if (x[i] === 0) continue;
      for (let j = 0; j < p; j++) a[i][j] += x[i] * x[j];
      a[i][2 * p] += x[i] * y[r];
    }
  }
  for (let i = 0; i < p; i++) a[i][i] += ridge[i];
  for (let col = 0; col < p; col++) {
    let pivot = col;
    for (let r = col + 1; r < p; r++) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    if (!(Math.abs(a[pivot][col]) > 1e-12)) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    const d = a[col][col];
    for (let j = 0; j <= 2 * p; j++) a[col][j] /= d;
    for (let r = 0; r < p; r++) {
      if (r === col || a[r][col] === 0) continue;
      const f = a[r][col];
      for (let j = 0; j <= 2 * p; j++) a[r][j] -= f * a[col][j];
    }
  }
  const beta = a.map((row) => row[2 * p]);
  const inv = a.map((row) => row.slice(p, 2 * p));
  const resid = rows.map((x, r) => y[r] - x.reduce((s, v, i) => s + v * beta[i], 0));
  const rss = resid.reduce((s, e) => s + e * e, 0);
  return { beta, inv, rss, resid };
}

// How far into week w's 7-day response window day x is (0 before it, 7 after it).
const exposure = (x: number, start: number) => Math.min(7, Math.max(0, x - start));

/**
 * The pooled read. PURE. `points` are weigh-ins on a day-index axis; `weeks` are the
 * window's weeks with their response-window start on the same axis and, for weeks
 * that are intake evidence, their complete-day average. Returns null when there is
 * too little to fit (fewer than INTAKE_BAND_MIN_RESPONSE_WEEKS evidence weeks, or
 * too few weigh-ins to leave any residual).
 */
export function fitIntakeResponse(
  weeks: IntakeResponseWeek[],
  points: Array<{ x: number; y: number }>
): IntakeResponseFit | null {
  const firstStart = Math.min(...weeks.map((w) => w.start));
  // Before the first week's response window the line has no slope to explain it with.
  const pts = points.filter((p) => p.x >= firstStart).sort((a, b) => a.x - b.x);
  const evidence = weeks.map((w, i) => ({ ...w, i })).filter((w) => w.kcal != null) as Array<{
    start: number;
    kcal: number;
    i: number;
  }>;
  if (evidence.length < INTAKE_BAND_MIN_RESPONSE_WEEKS) return null;
  const evidenceSet = new Set(evidence.map((w) => w.i));
  // A non-evidence week keeps its own slope — but only one the weigh-ins can see move:
  // a week every point sits wholly before (all zeros) or wholly after (a constant 7,
  // the level itself) has nothing to estimate.
  const nuisance = weeks
    .map((w, i) => ({ ...w, i }))
    .filter((w) => !evidenceSet.has(w.i) && pts.some((p) => p.x > w.start) && pts.some((p) => p.x < w.start + 7));

  type Fitted = {
    groups: number[][];
    rows: number[][];
    beta: number[];
    inv: number[][];
    rss: number;
    df: number;
    resid: number[];
  };
  const fit = (groups: number[][]): Fitted | null => {
    const p = 1 + groups.length + nuisance.length;
    if (pts.length - p < 3) return null;
    const rows = pts.map((pt) => [
      1,
      ...groups.map((g) => g.reduce((s, i) => s + exposure(pt.x, weeks[i].start), 0)),
      ...nuisance.map((w) => exposure(pt.x, w.start)),
    ]);
    // A whisper of ridge on the nuisance slopes only: two back-to-back weeks with no
    // weigh-ins inside them are otherwise only identified as a sum.
    const ridge = [0, ...groups.map(() => 0), ...nuisance.map(() => 1e-6)];
    const solved = leastSquares(
      rows,
      pts.map((pt) => pt.y),
      ridge
    );
    if (!solved) return null;
    return { groups, rows, ...solved, df: pts.length - p };
  };

  // Noise from a fitted model: residual scatter (floored) and its day-to-day carry-over.
  const noise = (f: Fitted): { sigma: number; rho: number; inflate: number } => {
    const sigma = Math.max(Math.sqrt(f.rss / f.df), INTAKE_BAND_NOISE_FLOOR_LB);
    let num = 0;
    let den = 0;
    for (let k = 0; k < pts.length; k++) {
      den += f.resid[k] ** 2;
      if (k > 0 && pts[k].x - pts[k - 1].x === 1) num += f.resid[k] * f.resid[k - 1];
    }
    const rho = den > 0 ? Math.min(MAX_AUTOCORRELATION, Math.max(0, num / den)) : 0;
    return { sigma, rho, inflate: Math.sqrt((1 + rho) / (1 - rho)) };
  };

  // The group slopes' covariance (lb²/day²) under AR(1) scale noise — the sandwich
  // σ²·(XᵀX)⁻¹·XᵀΩX·(XᵀX)⁻¹ with Ω_ij = ρ^|day_i − day_j|, so a slope built from a
  // run of correlated mornings is not credited as if each were independent.
  const groupCov = (f: Fitted): number[][] => {
    const { sigma, rho } = noise(f);
    const p = f.beta.length;
    const m: number[][] = Array.from({ length: p }, () => new Array(p).fill(0));
    for (let i = 0; i < pts.length; i++) {
      for (let j = 0; j < pts.length; j++) {
        const w = i === j ? 1 : rho > 0 ? rho ** Math.abs(pts[i].x - pts[j].x) : 0;
        if (w < 1e-6) continue;
        const xi = f.rows[i];
        const xj = f.rows[j];
        for (let a = 0; a < p; a++) {
          if (xi[a] === 0) continue;
          for (let b = 0; b < p; b++) m[a][b] += w * xi[a] * xj[b];
        }
      }
    }
    const g = f.groups.length;
    const out: number[][] = Array.from({ length: g }, () => new Array(g).fill(0));
    for (let r = 0; r < g; r++) {
      for (let c = 0; c < g; c++) {
        let sum = 0;
        for (let a = 0; a < p; a++) {
          const ia = f.inv[1 + r][a];
          if (ia === 0) continue;
          for (let b = 0; b < p; b++) sum += ia * m[a][b] * f.inv[b][1 + c];
        }
        out[r][c] = sigma * sigma * sum;
      }
    }
    return out;
  };

  const describe = (f: Fitted): IntakeResponseGroup[] => {
    const cov = groupCov(f);
    return f.groups.map((g, gi) => {
      const per_week = f.beta[1 + gi] * 7;
      const se_per_week = Math.sqrt(Math.max(0, cov[gi][gi])) * 7;
      const kcal = g.map((i) => weeks[i].kcal as number);
      return {
        weeks: g,
        kcal_min: Math.min(...kcal),
        kcal_max: Math.max(...kcal),
        per_week,
        se_per_week,
        response: classifyTrend(per_week, se_per_week),
      };
    });
  };

  const single = fit([evidence.map((w) => w.i)]);
  if (!single) return null;

  // The best split between two distinct observed weekly averages, each side carrying
  // at least INTAKE_BAND_MIN_RESPONSE_WEEKS weeks.
  const sorted = [...evidence].sort((a, b) => a.kcal - b.kcal || a.i - b.i);
  const candidates: Array<{ f: Fitted; lowerTop: number; upperBottom: number }> = [];
  for (let k = INTAKE_BAND_MIN_RESPONSE_WEEKS; k <= sorted.length - INTAKE_BAND_MIN_RESPONSE_WEEKS; k++) {
    if (!(sorted[k - 1].kcal < sorted[k].kcal)) continue;
    const f = fit([sorted.slice(0, k).map((w) => w.i), sorted.slice(k).map((w) => w.i)]);
    if (f) candidates.push({ f, lowerTop: sorted[k - 1].kcal, upperBottom: sorted[k].kcal });
  }
  const best = candidates.reduce<(typeof candidates)[number] | null>(
    (acc, c) => (!acc || c.f.rss < acc.f.rss ? c : acc),
    null
  );
  let splitZ: number | null = null;
  if (best) {
    const cov = groupCov(best.f);
    const se = Math.sqrt(Math.max(cov[0][0] + cov[1][1] - 2 * cov[0][1], 0));
    splitZ = se > 0 ? (best.f.beta[2] - best.f.beta[1]) / se : null;
  }
  const split = best && splitZ != null && Math.abs(splitZ) >= INTAKE_BAND_SPLIT_MIN_Z ? best : null;
  const chosen = split ? split.f : single;
  const n = noise(chosen);
  let boundary: IntakeResponseFit["boundary"] = null;
  if (split) {
    // Profile likelihood: a split whose residual sum is within χ²₁(99%) × the noise
    // variance (inflated for carry-over) of the best is as plausible a turn.
    const margin = PROFILE_CHI2_99 * (n.sigma * n.inflate) ** 2;
    const plausible = candidates.filter((c) => c.f.rss - split.f.rss <= margin);
    boundary = {
      low_kcal: Math.min(...plausible.map((c) => c.lowerTop)),
      high_kcal: Math.max(...plausible.map((c) => c.upperBottom)),
    };
  }
  return {
    groups: describe(chosen),
    split_z: split ? splitZ : null,
    boundary,
    sigma: n.sigma,
    rho: n.rho,
    points: pts.length,
  };
}

/**
 * How far the pooled read stands clear of the noise, as a confidence word. PURE.
 *   - inverted: two sides whose slopes run the wrong way (more eaten, weight falling
 *     faster) — the record contradicts itself, so tentative at most;
 *   - turn: a lower side that came down (or held) under a higher side that held (or
 *     rose); its evidence is the split, and each side needs TURN_MIN_SIDE_WEEKS;
 *   - otherwise a one-sided trend, whose evidence is its own slope;
 *   - levelOnly: nothing moved — no turn is located, so tentative at most.
 */
export function intakeResponseConfidence(
  fit: IntakeResponseFit,
  evidenceWeeks: number,
  completeDays: number
): {
  confidence: ClientIntakeBandConfidence;
  inverted: boolean;
  turn: boolean;
  levelOnly: boolean;
  z: number;
} {
  const lower = fit.groups[0];
  const upper = fit.groups[1] ?? null;
  const inverted = upper != null && (fit.split_z ?? 0) < 0;
  const turn =
    !inverted &&
    upper != null &&
    fit.boundary != null &&
    ((lower.response === "down" && (upper.response === "up" || upper.response === "steady")) ||
      (lower.response === "steady" && upper.response === "up"));
  const directional = fit.groups.filter((g) => g.response === "down" || g.response === "up");
  const levelOnly = !directional.length;
  const z = turn
    ? Math.abs(fit.split_z ?? 0)
    : directional.length
      ? Math.min(...directional.map((g) => Math.abs(g.per_week) / Math.max(g.se_per_week, 1e-9)))
      : 0;
  const sideWeeks = turn && upper ? Math.min(lower.weeks.length, upper.weeks.length) : Infinity;
  const confidence: ClientIntakeBandConfidence =
    inverted || levelOnly || sideWeeks < TURN_MIN_SIDE_WEEKS
      ? "low"
      : z >= INTAKE_BAND_STRONG_Z && evidenceWeeks >= STRONG_MIN_WEEKS && completeDays >= STRONG_MIN_COMPLETE_DAYS
        ? "high"
        : z >= INTAKE_BAND_OBSERVED_Z && evidenceWeeks >= OBSERVED_MIN_WEEKS
          ? "moderate"
          : "low";
  return { confidence, inverted, turn, levelOnly, z };
}

// ---------- the anchor ----------

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

const CONFIDENCE_LABEL: Record<ClientIntakeBandConfidence, string> = {
  low: "Tentative",
  moderate: "Observed",
  high: "Strong",
};

/**
 * The observed intake band as of `asOf` (default today): the last
 * INTAKE_BAND_WINDOW_WEEKS closed weeks, complete days only, against the smoothed
 * weight response over the same weeks, pooled (see the header). PURE of writes; reads
 * the food log and the canonical bodyweight series.
 */
export function intakeBand(asOf: string = localDateISO(), opts: IntakeBandOptions = {}): ClientIntakeBand {
  const through = addDaysISO(asOf, -1) ?? asOf;
  const since = addDaysISO(through, -(INTAKE_BAND_WINDOW_WEEKS * 7 - 1)) ?? through;
  const window = completedIntakeRange(since, through, through);
  const complete = window.days.filter((day) => day.credible);
  const canonical = canonicalBodyweightSeries({ since, through: asOf });
  // The shared scale-quality rule: an unconfirmed final shock is withheld, a repeated
  // new level is admitted gradually.
  const weights = robustWeightTrend(canonical).points;
  const anchor = proteinAnchor(opts.goal);

  // Calendar weeks ending on `through`, oldest first, each with its response window.
  const fitted: Array<{
    week_start: string;
    week_end: string;
    days: number;
    kcal_avg: number | null;
    start: number;
    weighed: boolean;
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
    const start = daysBetween(since, week_start) + RESPONSE_LAG_DAYS;
    const points = weights
      .map((p) => ({ x: daysBetween(since, p.date), y: p.weight_lb }))
      .filter((p) => p.x >= start && p.x <= start + 6);
    const span = points.length ? Math.max(...points.map((p) => p.x)) - Math.min(...points.map((p) => p.x)) : 0;
    const weighed = points.length >= RESPONSE_MIN_WEIGH_INS && span >= RESPONSE_MIN_SPAN_DAYS;
    const fit = weighed ? fitSlope(points.map((p) => ({ x: p.x - start, y: p.y }))) : null;
    fitted.push({ week_start, week_end, days: days.length, kcal_avg, start, weighed, fit });
  }
  // The per-week rows: each week's own slope against the scatter pooled over every
  // week that has residuals to give. Shown for the record; the band is read below.
  const pooledRss = fitted.reduce((sum, w) => sum + (w.fit && w.fit.df > 0 ? w.fit.rss : 0), 0);
  const pooledDf = fitted.reduce((sum, w) => sum + (w.fit && w.fit.df > 0 ? w.fit.df : 0), 0);
  const weekSigma = pooledDf > 0 ? Math.sqrt(pooledRss / pooledDf) : INTAKE_BAND_NOISE_FLOOR_LB;
  const weeks: ClientIntakeBandWeek[] = fitted.map((w) => {
    const read = w.fit ? classifyWeekResponse(w.fit.slope, w.fit.sxx, weekSigma) : null;
    return {
      week_start: w.week_start,
      week_end: w.week_end,
      complete_days: w.days,
      kcal_avg: w.kcal_avg,
      weight_change_lb_per_week: read ? round2(read.perWeek) : null,
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
      weigh_in_days: canonical.filter((p) => p.date <= through).length,
    },
    weeks,
  };
  const none = (
    status: "too_few_days" | "no_weight_response",
    words: string,
    reason: string,
    pooled: ClientIntakeBand["pooled"] = null
  ): ClientIntakeBand => ({
    ...base,
    status,
    band: null,
    energy_ceiling_kcal: null,
    confidence: null,
    confidence_words: null,
    words,
    pooled,
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

  // Evidence weeks: a complete-day average AND weigh-ins inside the response window.
  // A week the scale did not see keeps its own slope in the fit, attributed to nothing.
  const evidenceWeeks = fitted.filter((w) => w.kcal_avg != null && w.weighed).length;
  const pooledFit =
    evidenceWeeks >= INTAKE_BAND_MIN_RESPONSE_WEEKS
      ? fitIntakeResponse(
          fitted.map((w) => ({ start: w.start, kcal: w.kcal_avg != null && w.weighed ? w.kcal_avg : null })),
          weights.map((p) => ({ x: daysBetween(since, p.date), y: p.weight_lb }))
        )
      : null;
  if (!pooledFit) {
    return none(
      "no_weight_response",
      `${complete.length} complete days are logged, but there aren't enough weigh-ins beside them yet to see which way your weight moved.`,
      `${evidenceWeeks} week(s) carry both a complete-day average and weigh-ins; the pooled read needs ${INTAKE_BAND_MIN_RESPONSE_WEEKS}.`
    );
  }

  const groups: ClientIntakeBandGroup[] = pooledFit.groups.map((g) => ({
    kcal_min: round10(g.kcal_min),
    kcal_max: round10(g.kcal_max),
    weeks: g.weeks.length,
    lb_per_week: round2(g.per_week),
    response: g.response,
  }));
  const pooled = { groups, scale_noise_lb: round2(pooledFit.sigma) };
  const trail =
    `pooled ${pooledFit.points} weigh-in(s) as one continuous trend over ${evidenceWeeks} evidence week(s) ` +
    `(scatter ${round2(pooledFit.sigma)} lb, day-to-day carry-over ${round2(pooledFit.rho)}); ` +
    pooledFit.groups
      .map(
        (g) =>
          `${Math.round(g.kcal_min)}–${Math.round(g.kcal_max)} kcal/day over ${g.weeks.length} week(s): ` +
          `${round2(g.per_week)} ± ${round2(g.se_per_week)} lb/week (${g.response})`
      )
      .join("; ") +
    (pooledFit.split_z != null ? `; split ${round2(pooledFit.split_z)} SE` : "; no split stood clear of the noise");

  const read = pooledFit.groups.filter((g) => g.response !== "unknown");
  if (!read.length) {
    return none(
      "no_weight_response",
      `${complete.length} complete days are logged, but the scale's day-to-day swings are still larger than the trend, so it doesn't yet show which way your weight moved in those weeks.`,
      `No pooled trend stands clear of the scale's own noise: ${trail}.`,
      pooled
    );
  }

  // Every evidence week takes its side's direction; a side the scale cannot call is absent.
  const kcalOf = (g: IntakeResponseGroup) => g.weeks.map((i) => fitted[i].kcal_avg as number);
  const down = read.filter((g) => g.response === "down").flatMap(kcalOf);
  const up = read.filter((g) => g.response === "up").flatMap(kcalOf);
  const steady = read.filter((g) => g.response === "steady").flatMap(kcalOf);
  const maxDown = down.length ? Math.max(...down) : null;
  const minUp = up.length ? Math.min(...up) : null;
  const lower = pooledFit.groups[0];
  const upper = pooledFit.groups[1] ?? null;
  const verdict = intakeResponseConfidence(pooledFit, evidenceWeeks, complete.length);
  const { inverted, turn, levelOnly, confidence } = verdict;
  // More eaten, yet the weight came down, where less eaten went up: a contradiction.
  const mixed = inverted || (maxDown != null && minUp != null && maxDown >= minUp);
  const boundary = pooledFit.boundary;

  let low: number;
  let high: number;
  let lowIsLoss: boolean;
  let highIsGain: boolean;
  let ceilingRaw: number | null;
  if (mixed) {
    const all = [...down, ...up, ...steady];
    low = Math.min(...all);
    high = Math.max(...all);
    lowIsLoss = true;
    highIsGain = true;
    // The most eaten without an upward trend, below every week that did trend up —
    // unless the sides run backwards, when no intake can honestly be called no-gain.
    const nonGain = [...down, ...steady].filter((k) => minUp == null || k < minUp);
    ceilingRaw = !inverted && nonGain.length ? Math.max(...nonGain) : null;
  } else if (turn && boundary && upper) {
    lowIsLoss = lower.response === "down";
    highIsGain = upper.response === "up";
    // Loss edge: the most eaten where EVERY plausible split still has the weight coming
    // down; gain edge: the least eaten where every plausible split has it rising.
    low = lowIsLoss ? boundary.low_kcal : lower.kcal_min;
    high = highIsGain ? boundary.high_kcal : upper.kcal_max;
    // No gain: under a rising upper side, the most eaten that surely sits below the
    // turn; under a steady upper side, the most eaten at all.
    ceilingRaw = highIsGain ? boundary.low_kcal : upper.kcal_max;
  } else {
    lowIsLoss = maxDown != null;
    low = maxDown ?? (steady.length ? Math.min(...steady) : (minUp as number));
    highIsGain = minUp != null;
    high = minUp ?? Math.max(...[...down, ...steady]);
    const nonGain = [...down, ...steady].filter((k) => minUp == null || k < minUp);
    ceilingRaw = nonGain.length ? Math.max(...nonGain) : null;
  }
  low = round10(low);
  high = round10(Math.max(low, high));
  const ceiling = ceilingRaw == null ? null : round10(ceilingRaw);

  const label = CONFIDENCE_LABEL[confidence];
  const counts = `${evidenceWeeks} weeks and ${complete.length} complete days`;
  const confidence_words = mixed
    ? `${label}: the weeks disagree with each other, so this is a loose read.`
    : levelOnly
      ? `${label}: the weight held level across these weeks, which doesn't yet show where it would turn.`
      : confidence === "high"
        ? `${label}: ${counts} agree, and the trend stands well clear of the scale's day-to-day swings.`
        : confidence === "moderate"
          ? `${label}: ${counts} show it clear of the scale's day-to-day swings.`
          : `${label}: ${counts} lean this way, but the scale's day-to-day swings are still close to the trend.`;

  const lead =
    confidence === "high"
      ? `Clear over ${evidenceWeeks} weeks`
      : confidence === "moderate"
        ? `Observed over ${evidenceWeeks} weeks`
        : `A tentative read from ${evidenceWeeks} weeks`;
  const steadyMin = steady.length ? Math.min(...steady) : null;
  const steadyMax = steady.length ? Math.max(...steady) : null;
  let words: string;
  if (inverted) {
    words = `The record is mixed: your weight came down in weeks at the higher intakes and not at the lower ones, so there's no range to lean on yet.`;
  } else if (mixed) {
    words = `The record is mixed: weeks between ${kcalWords(low)} and ${kcalWords(high)} went both ways, so the range is loose.`;
  } else if (turn && lowIsLoss && highIsGain) {
    words = `${lead}: your weight drifted down in weeks averaging up to ${kcalWords(low)} and rose in weeks from ${kcalWords(high)}, so it turns somewhere between.`;
  } else if (turn && lowIsLoss) {
    words = `${lead}: your weight drifted down in weeks averaging up to ${kcalWords(low)} and held steady in weeks up to ${kcalWords(high)}; no week has shown a gain yet.`;
  } else if (turn) {
    words = `${lead}: your weight held steady in weeks up to ${kcalWords(ceiling as number)} and rose in weeks from ${kcalWords(high)}.`;
  } else if (maxDown != null && minUp != null) {
    words = `${lead}: your weight drifted down in weeks averaging up to ${kcalWords(maxDown)} and rose in weeks from ${kcalWords(minUp)}, so it turns somewhere between.`;
  } else if (maxDown != null) {
    words =
      steadyMax != null
        ? `${lead}: your weight drifted down in weeks averaging up to ${kcalWords(maxDown)} and held steady in weeks up to ${kcalWords(steadyMax)}; no week has shown a gain yet.`
        : `${lead}: your weight drifted down in weeks averaging up to ${kcalWords(maxDown)}; no week at a higher intake has shown a gain yet.`;
  } else if (minUp != null) {
    words =
      steadyMax != null
        ? `${lead}: your weight held steady in weeks up to ${kcalWords(steadyMax)} and rose in weeks from ${kcalWords(minUp)}.`
        : `${lead}: your weight rose in weeks from ${kcalWords(minUp)}; no week at a lower intake has shown it coming down yet.`;
  } else {
    words = `${lead}: your weight held steady in weeks averaging ${kcalWords(steadyMin as number)}${(steadyMax as number) !== steadyMin ? ` to ${kcalWords(steadyMax as number)}` : ""}.`;
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
    pooled,
    reason:
      `${complete.length} complete day(s) in ${since}..${window.through} (${window.partial_days} partial excluded); ` +
      `${trail}. down=[${down.join(",")}] steady=[${steady.join(",")}] up=[${up.join(",")}] kcal/day.`,
  };
}
