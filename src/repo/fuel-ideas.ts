// ---------- fuel ideas: three staples for the rest of today ----------
//
// Meal plans stopped drafting on a schedule; what replaces them is ideas on demand.
// This is the deterministic floor of that: three ideas built from the athlete's OWN
// staples (foods logged on at least two different days, plus what they usually eat
// near this hour), sized to the rest of today inside the observed intake band
// (intake-band.ts), protein first.
//
// THE RULES:
//   - An idea is never a plan and never eaten. It carries a `prefill` for the
//     composer's "Start from this"; nothing is logged until the person logs it.
//   - PROTEIN FIRST. Ideas rank by how much of the protein still owed they cover.
//     A portion is shrunk to fit the band ONLY when the smaller portion still covers
//     the whole protein gap — an idea never trades protein away to fit the band. When
//     the protein-carrying portion does not fit, it is offered anyway and says so.
//   - The band bounds energy only, and only when there IS a band: with no band the
//     ideas keep the usual portion and make no energy claim.
//   - No agent turn. An agent refinement, if one is ever layered on, must never block
//     this response.

import type { ClientFuelIdea, ClientFuelIdeas } from "../contracts/fuel.js";
import { db } from "../db.js";
import { intakeBand } from "./intake-band.js";
import { dayIntakeCoverage, frequentFoodKey, frequentFoods, getDayIntake } from "./nutrition.js";
import { computeGoalCheck } from "./profile.js";
import { addDaysISO, localDateISO } from "./shared.js";

export const FUEL_IDEAS_COUNT = 3;
export const FUEL_STAPLE_WINDOW_DAYS = 90;
// A staple repeats: one logged day is an event, two is a habit worth building on.
export const FUEL_STAPLE_MIN_DAYS = 2;
const PORTIONS = [0.5, 1, 1.5, 2] as const;
const PORTION_WORDS: Record<number, string> = {
  0.5: "a half portion",
  1: "your usual portion",
  1.5: "one and a half portions",
  2: "a double portion",
};

export interface FuelStaple {
  key: string;
  title: string;
  kcal: number;
  protein_g: number;
  carbs_g: number | null;
  fat_g: number | null;
  times_logged: number;
  last_logged: string | null;
  usual_now: boolean;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * The athlete's staples: foods logged on at least FUEL_STAPLE_MIN_DAYS distinct days in
 * the window, each with the macros of its newest occurrence that carries both kcal and
 * protein (a staple with no known protein cannot be ranked protein-first, so it is left
 * out), plus the foods usually eaten near `hour` (frequentFoods), flagged `usual_now`.
 */
export function fuelStaples(asOf: string = localDateISO(), hour?: number): FuelStaple[] {
  const since = addDaysISO(asOf, -FUEL_STAPLE_WINDOW_DAYS) ?? asOf;
  const rows = db
    .prepare(
      `SELECT id, COALESCE(date, substr(created_at, 1, 10)) AS day, meal, parsed_json
         FROM food_notes
        WHERE COALESCE(date, substr(created_at, 1, 10)) >= ?
          AND COALESCE(date, substr(created_at, 1, 10)) <= ?
        ORDER BY id DESC`
    )
    .all(since, asOf) as any[];
  const byKey = new Map<string, { title: string; days: Set<string>; last: string | null; macros: any | null }>();
  for (const row of rows) {
    let parsed: any = null;
    try {
      parsed = row.parsed_json ? JSON.parse(String(row.parsed_json)) : null;
    } catch {
      parsed = null;
    }
    const title = String(parsed?.summary ?? row.meal ?? "").trim();
    if (!title) continue;
    const key = frequentFoodKey(title);
    if (!key) continue;
    const day = String(row.day ?? "").slice(0, 10);
    const cur = byKey.get(key) ?? { title, days: new Set<string>(), last: null, macros: null };
    if (day) cur.days.add(day);
    if (!cur.last || day > cur.last) cur.last = day || cur.last;
    const kcal = num(parsed?.kcal);
    const protein = num(parsed?.protein_g);
    // Rows are id-DESC, so the first occurrence carrying both is the newest estimate.
    if (!cur.macros && kcal != null && kcal > 0 && protein != null) {
      cur.macros = { kcal, protein_g: protein, carbs_g: num(parsed?.carbs_g), fat_g: num(parsed?.fat_g) };
    }
    byKey.set(key, cur);
  }
  let usualNow = new Set<string>();
  try {
    usualNow = new Set(frequentFoods(hour).map((f) => frequentFoodKey(f.summary)));
  } catch {
    usualNow = new Set();
  }
  const out: FuelStaple[] = [];
  for (const [key, v] of byKey) {
    if (!v.macros) continue;
    const now = usualNow.has(key);
    if (v.days.size < FUEL_STAPLE_MIN_DAYS && !now) continue;
    out.push({
      key,
      title: v.title,
      kcal: v.macros.kcal,
      protein_g: v.macros.protein_g,
      carbs_g: v.macros.carbs_g,
      fat_g: v.macros.fat_g,
      times_logged: v.days.size,
      last_logged: v.last,
      usual_now: now,
    });
  }
  return out;
}

interface Sized {
  staple: FuelStaple;
  portion: number;
  kcal: number;
  protein: number;
  covered: number;
  fits: boolean | null;
}

// Size one staple for the room left (rules in the header). PURE.
export function sizeFuelIdea(staple: FuelStaple, proteinNeed: number | null, energyRoom: number | null): Sized {
  const at = (portion: number): Sized => {
    const kcal = staple.kcal * portion;
    const protein = staple.protein_g * portion;
    return {
      staple,
      portion,
      kcal,
      protein,
      covered: proteinNeed == null ? protein : Math.min(protein, proteinNeed),
      fits: energyRoom == null ? null : kcal <= energyRoom,
    };
  };
  const usual = at(1);
  // Up: more of a protein staple, only with a band to size inside and only while it
  // still fits and still buys protein that is owed.
  if (energyRoom != null && proteinNeed != null && proteinNeed > usual.covered && usual.fits) {
    let best = usual;
    for (const portion of PORTIONS.filter((p) => p > 1)) {
      const s = at(portion);
      if (s.fits && s.covered > best.covered + 0.5) best = s;
    }
    return best;
  }
  // Down: only to fit the band, and only when no protein that is owed is lost.
  if (usual.fits === false) {
    for (const portion of PORTIONS.filter((p) => p < 1).sort((a, b) => b - a)) {
      const s = at(portion);
      const keepsProtein = proteinNeed == null || proteinNeed <= 0 || s.covered >= usual.covered - 1e-9;
      if (s.fits && keepsProtein) return s;
    }
  }
  return usual;
}

function ideaWhy(s: Sized, proteinNeed: number | null, energyRoom: number | null): string {
  const protein = Math.round(s.protein);
  let lead: string;
  if (proteinNeed != null && proteinNeed > 0) {
    lead = `About ${protein} g protein toward the ${Math.round(proteinNeed)} g still to go`;
  } else if (proteinNeed != null) {
    lead = `Protein is already met today; this adds about ${protein} g`;
  } else {
    lead = `One of your staples, about ${protein} g protein`;
  }
  if (s.fits === true)
    return `${lead}, and it fits the ${Math.round(energyRoom as number)} kcal left in your observed range.`;
  if (s.fits === false) {
    return proteinNeed != null && proteinNeed > 0
      ? `${lead}. It runs past your observed range today; protein comes first.`
      : `${lead}. It runs past your observed range today.`;
  }
  return `${lead}.`;
}

export interface FuelIdeasOptions {
  hour?: number;
  /** Idea keys or staple keys to skip ("Another idea"). */
  exclude?: string[];
}

/**
 * Three ideas for the rest of `date` (default today), deterministic. Never logs,
 * never drafts a plan, never asks an agent.
 */
export function fuelIdeas(date: string = localDateISO(), opts: FuelIdeasOptions = {}): ClientFuelIdeas {
  let goal: any = null;
  try {
    goal = computeGoalCheck();
  } catch {
    goal = null;
  }
  const band = intakeBand(date, { goal });
  const anchor = band.protein_anchor;
  const day = getDayIntake(date);
  const totals = day.totals;
  const coverage = day.count ? dayIntakeCoverage(date).coverage : "none";
  const state: ClientFuelIdeas["today_so_far"]["state"] = !day.count
    ? "nothing logged"
    : date < localDateISO() && coverage === "complete"
      ? "complete"
      : "in progress";

  const proteinNeed = anchor ? Math.max(0, anchor.protein_g - totals.protein_g) : null;
  const energyRoom = band.energy_ceiling_kcal != null ? Math.round(band.energy_ceiling_kcal - totals.kcal) : null;

  const excluded = new Set((opts.exclude ?? []).map((k) => String(k).split("@")[0]));
  const eatenToday = new Set(day.entries.map((e: any) => frequentFoodKey(String(e.summary ?? ""))));
  const staples = fuelStaples(date, opts.hour).filter((s) => !excluded.has(s.key) && !eatenToday.has(s.key));

  const fitRank = (f: boolean | null) => (f === true ? 2 : f === null ? 1 : 0);
  const sized = staples
    .map((staple) => sizeFuelIdea(staple, proteinNeed, energyRoom))
    .sort(
      (a, b) =>
        (proteinNeed != null && proteinNeed > 0 ? Math.round(b.covered / 5) - Math.round(a.covered / 5) : 0) ||
        fitRank(b.fits) - fitRank(a.fits) ||
        b.staple.protein_g / b.staple.kcal - a.staple.protein_g / a.staple.kcal ||
        Number(b.staple.usual_now) - Number(a.staple.usual_now) ||
        b.staple.times_logged - a.staple.times_logged ||
        a.staple.key.localeCompare(b.staple.key)
    )
    .slice(0, FUEL_IDEAS_COUNT);

  const round = (n: number | null) => (n == null ? null : Math.round(n));
  const ideas: ClientFuelIdea[] = sized.map((s) => {
    const portion_words = PORTION_WORDS[s.portion] ?? `${s.portion}× your usual portion`;
    return {
      key: `${s.staple.key}@${s.portion}`,
      title: s.staple.title,
      portion: s.portion,
      portion_words,
      kcal: round(s.kcal),
      protein_g: round(s.protein),
      carbs_g: s.staple.carbs_g == null ? null : Math.round(s.staple.carbs_g * s.portion),
      fat_g: s.staple.fat_g == null ? null : Math.round(s.staple.fat_g * s.portion),
      fits_band: s.fits,
      why: ideaWhy(s, proteinNeed, energyRoom),
      prefill: s.portion === 1 ? s.staple.title : `${s.staple.title} (${portion_words})`,
      times_logged: s.staple.times_logged,
      last_logged: s.staple.last_logged,
      source: "staple",
    };
  });

  return {
    kind: "ideas",
    date,
    protein_anchor: anchor,
    today_so_far: {
      kcal: totals.kcal,
      protein_g: totals.protein_g,
      fiber_g: totals.fiber_g,
      state,
    },
    room: { protein_g: proteinNeed == null ? null : Math.round(proteinNeed), energy_kcal: energyRoom },
    band_status: band.status,
    ideas,
    words: ideas.length
      ? "Ideas from your own staples, not a plan. Nothing is logged until you log it."
      : "No staples to build ideas from yet. They appear once a few meals repeat.",
  };
}
