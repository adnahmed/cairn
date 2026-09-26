// The ONE food-capture contract.
//
// Three surfaces ask an agent to describe a meal — free-text enrichment
// (src/prompt/enrich.ts), the chat `log_food` action (src/chatActions.ts) and the
// plate-photo vision read (src/prompt/enrich.ts) — and each used to declare its own
// JSON shape. They drifted: chat never asked for nutrition_pattern at all, the photo
// path (where the portion is INFERRED and structure matters most) never asked for
// ingredient rows, none asked for ingredient-level fiber, and only the photo path
// carried any provenance. This module declares that shape ONCE, as prompt fragments
// plus the coercion every path runs a returned payload through, so a fourth copy
// cannot quietly appear.
//
// CAPTURE DEPTH ≫ DISPLAY DEPTH. Everything here exists to feed the brain and to let
// intake be correlated against bloodwork (sodium↔BP, saturated fat↔LDL, added
// sugar↔HbA1c, iron↔ferritin, omega-3↔inflammation). Nothing here decides what a
// surface renders.
//
// The one rule that makes the extra depth safe: an ESTIMATE MUST NEVER BECOME
// INDISTINGUISHABLE FROM A MEASUREMENT. Every entry carries `confidence` and
// `basis`, and every capture path supplies a conservative fallback basis describing
// how it actually obtained the numbers, so a stated 205 g and a guess off a picture
// never read the same downstream.

import type { JsonSchema } from "./json-schema.js";

export const FOOD_CONFIDENCE_BANDS = ["low", "medium", "high"] as const;
export type FoodConfidence = (typeof FOOD_CONFIDENCE_BANDS)[number];

// How a number was obtained. Deliberately the SAME vocabulary the stored
// nutrition_pattern already uses (src/repo/nutrition-progress.ts counts these
// bands), so entry-level and pattern-level provenance are one register.
export const FOOD_BASIS_VALUES = ["label", "user_report", "estimated_from_foods", "photo"] as const;
export type FoodBasis = (typeof FOOD_BASIS_VALUES)[number];

export const FOOD_MACRO_KEYS = ["kcal", "protein_g", "carbs_g", "fat_g", "fiber_g"] as const;
export type FoodMacroKey = (typeof FOOD_MACRO_KEYS)[number];

// Ceilings one meal cannot honestly exceed. Shared so the chat lane, the text
// enricher and the photo enricher clamp identically.
export const FOOD_MACRO_CEILINGS: Record<FoodMacroKey, number> = {
  kcal: 5000,
  protein_g: 500,
  carbs_g: 1000,
  fat_g: 500,
  fiber_g: 200,
};

const MAX_INGREDIENTS = 50;
const MAX_ITEMS = 50;
const TEXT_CAP = 200;

export const FOOD_CONFIDENCE_SCHEMA = FOOD_CONFIDENCE_BANDS.join("|");
export const FOOD_BASIS_SCHEMA = FOOD_BASIS_VALUES.join("|");

// ---- prompt fragments (declared once, interpolated by all three contracts) ----

// One ingredient row. The QUANTITY IS A FIELD, not prose folded into the name —
// that is the whole reason the photo path's old `items: ["scrambled eggs (~2 eggs)"]`
// could not be reasoned over.
export const FOOD_INGREDIENT_SCHEMA =
  `{ "item": "<ingredient>", "amount": "<quantity as its own field, e.g. '205 g' / '2 eggs' / '1 cup'>",
        "kcal": <number|null>, "protein_g": <number|null>, "carbs_g": <number|null>, "fat_g": <number|null>, "fiber_g": <number|null>,
        "basis": "${FOOD_BASIS_SCHEMA}|null" }`;

// Coarse pattern bands — the fields that correlate with a blood panel. Never
// invented micronutrient milligrams.
export const FOOD_NUTRITION_PATTERN_SCHEMA = `{
      "sodium": "low|moderate|high|unknown", "potassium": "low|moderate|high|unknown",
      "calcium": "low|moderate|high|unknown", "iron": "low|moderate|high|unknown",
      "saturated_fat": "low|moderate|high|unknown", "added_sugar": "low|moderate|high|unknown",
      "saturated_fat_g": <number|null>, "unsaturated_fat_g": <number|null>,
      "omega_3_source": <boolean|null>, "alcohol_servings": <number|null>,
      "caffeine_mg": <number|null>, "caffeine_time": <string|null>,
      "food_quality": "mostly_whole|mixed|mostly_ultra_processed|unknown",
      "confidence": "${FOOD_CONFIDENCE_SCHEMA}", "basis": "${FOOD_BASIS_SCHEMA}"
    }`;

// ---- the ENFORCED twins of the three fragments above -------------------------
// The same shape, expressed as JSON Schema so a CLI that supports structured output
// CONSTRAINS the payload instead of merely being asked for it. Declared here, beside
// the prose fragments and off the same vocabulary constants, because the whole point
// of this module is that the food shape exists once — a schema authored over in
// agent-contracts.ts would be the fourth copy this file was written to prevent.
// Every field coerceFoodIngredients / coerceNutritionPattern / normalizeFoodCaptureParsed
// READS is named: constrained decoding drops what a schema does not mention.
export const FOOD_INGREDIENT_JSON_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: true,
  properties: {
    item: { type: "string" },
    // coerceFoodIngredients reads `item ?? name ?? food` and
    // `amount ?? qty ?? quantity ?? portion`. The canonical spelling leads and is what
    // the prose asks for; the aliases are named so a model that reaches for one lands
    // in a slot the decoder keeps rather than losing the row's quantity.
    name: { type: ["string", "null"] },
    food: { type: ["string", "null"] },
    amount: { type: ["string", "null"] },
    qty: { type: ["string", "null"] },
    quantity: { type: ["string", "null"] },
    portion: { type: ["string", "null"] },
    kcal: { type: ["number", "null"] },
    protein_g: { type: ["number", "null"] },
    carbs_g: { type: ["number", "null"] },
    fat_g: { type: ["number", "null"] },
    fiber_g: { type: ["number", "null"] },
    basis: { type: ["string", "null"] },
  },
};

export const FOOD_NUTRITION_PATTERN_JSON_SCHEMA: JsonSchema = {
  type: ["object", "null"],
  additionalProperties: true,
  properties: {
    sodium: { type: ["string", "null"] },
    potassium: { type: ["string", "null"] },
    calcium: { type: ["string", "null"] },
    iron: { type: ["string", "null"] },
    saturated_fat: { type: ["string", "null"] },
    added_sugar: { type: ["string", "null"] },
    saturated_fat_g: { type: ["number", "null"] },
    unsaturated_fat_g: { type: ["number", "null"] },
    omega_3_source: { type: ["boolean", "null"] },
    alcohol_servings: { type: ["number", "null"] },
    caffeine_mg: { type: ["number", "null"] },
    caffeine_time: { type: ["string", "null"] },
    food_quality: { type: ["string", "null"] },
    confidence: { type: ["string", "null"] },
    basis: { type: ["string", "null"] },
  },
};

// The meal estimate itself, shared by the text enricher's `structured` node, the
// photo read's flat top level, and anything else that stores a food capture.
export const FOOD_ESTIMATE_PROPERTIES: Record<string, JsonSchema> = {
  summary: { type: ["string", "null"] },
  items: { type: "array", items: { type: "string" } },
  ingredients: { type: "array", items: FOOD_INGREDIENT_JSON_SCHEMA },
  kcal: { type: ["number", "null"] },
  protein_g: { type: ["number", "null"] },
  carbs_g: { type: ["number", "null"] },
  fat_g: { type: ["number", "null"] },
  fiber_g: { type: ["number", "null"] },
  nutrition_pattern: FOOD_NUTRITION_PATTERN_JSON_SCHEMA,
  notes: { type: ["string", "null"] },
  confidence: { type: ["string", "null"] },
  basis: { type: ["string", "null"] },
};

// Entry-level provenance. Every capture path emits it.
export const FOOD_PROVENANCE_SCHEMA = `"confidence": "${FOOD_CONFIDENCE_SCHEMA}", "basis": "${FOOD_BASIS_SCHEMA}"`;

// The guardrails that belong to the SHAPE rather than to one surface. Each prompt
// keeps its own surface-specific prose (a photo can't show hidden oil; a text note
// may name a cooking method) and adds these.
export const FOOD_CAPTURE_GUARDRAILS = [
  `Break the meal into ingredient ROWS and put the quantity in "amount" as its own field — "205 g" belongs in amount, never folded into the item name. Estimate each row's macros INCLUDING fiber_g so the meal total is built up from its parts instead of guessed from the top down; null any row value you genuinely cannot estimate rather than inventing one.`,
  `"confidence" and "basis" record HOW the numbers were obtained and must be honest: "label" = read off a package or menu label, "user_report" = the athlete stated the quantity or the macros, "estimated_from_foods" = inferred from ordinary serving sizes, "photo" = inferred from the picture. A stated or weighed quantity is high confidence; anything you inferred is low or medium. An estimate must never be made to look like a measurement.`,
  `Give an ingredient row its own "basis" only when it differs from the meal's — a weighed chicken breast next to an eyeballed scoop of rice is exactly the case worth recording. Otherwise leave it null.`,
  `Use nutrition_pattern for COARSE bands, not invented micronutrient milligrams. Alcohol and caffeine stay null unless the meal actually identifies them.`,
] as const;

export function foodCaptureGuardrailLines(): string {
  return FOOD_CAPTURE_GUARDRAILS.map((line) => `- ${line}`).join("\n");
}

// ---- coercion (shared by every path that stores a food estimate) ----

const asNum = (v: unknown): number | undefined => {
  if (v === null || v === undefined || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
};

const asStr = (v: unknown, cap = 1000): string | undefined => {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return s ? s.slice(0, cap) : undefined;
};

// Clamp a meal total to a non-negative integer under its shared ceiling.
export function clampFoodMacro(key: FoodMacroKey, n: number): number {
  return Math.min(FOOD_MACRO_CEILINGS[key], Math.max(0, Math.round(n)));
}

// An ingredient row keeps one decimal — a 0.6 g fiber row is real, and the totals
// round at the meal level.
function clampIngredientMacro(key: FoodMacroKey, n: number): number {
  return Math.min(FOOD_MACRO_CEILINGS[key], Math.max(0, Math.round(n * 10) / 10));
}

export interface FoodIngredient {
  item: string;
  amount?: string;
  kcal?: number;
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
  fiber_g?: number;
  basis?: FoodBasis;
}

// Coerce an agent's ingredient array. A row with no readable item name is dropped;
// junk macros are dropped rather than stored as strings or negatives. Returns null
// when the payload carried no ingredients array at all, so a merge can tell
// "the agent said nothing" from "the agent said none".
export function coerceFoodIngredients(value: unknown): FoodIngredient[] | null {
  if (!Array.isArray(value)) return null;
  const rows = value
    .slice(0, MAX_INGREDIENTS)
    .map((raw): FoodIngredient | null => {
      if (typeof raw === "string") {
        const item = asStr(raw, TEXT_CAP);
        return item ? { item } : null;
      }
      if (!raw || typeof raw !== "object") return null;
      const row = raw as Record<string, unknown>;
      const item = asStr(row.item ?? row.name ?? row.food, TEXT_CAP);
      if (!item) return null;
      const out: FoodIngredient = { item };
      const amount = asStr(row.amount ?? row.qty ?? row.quantity ?? row.portion, TEXT_CAP);
      if (amount !== undefined) out.amount = amount;
      for (const key of FOOD_MACRO_KEYS) {
        const n = asNum(row[key]);
        if (n !== undefined) out[key] = clampIngredientMacro(key, n);
      }
      const basis = String(row.basis ?? "").toLowerCase();
      if ((FOOD_BASIS_VALUES as readonly string[]).includes(basis)) out.basis = basis as FoodBasis;
      return out;
    })
    .filter((row): row is FoodIngredient => !!row);
  return rows;
}

// Label one component for DISPLAY. Objects collapse to "item (amount)" so a
// structured row still reads as a sentence on a surface that only shows `items`.
export function foodItemLabel(x: unknown): string | null {
  if (x === null || x === undefined) return null;
  if (typeof x === "object") {
    const row = x as Record<string, unknown>;
    const item = asStr(row.item ?? row.name ?? row.summary ?? row.food, TEXT_CAP);
    const amount = asStr(row.amount ?? row.qty ?? row.quantity ?? row.portion, TEXT_CAP);
    if (!item) return null;
    return amount ? `${item} (${amount})`.slice(0, TEXT_CAP) : item;
  }
  const s = String(x).trim();
  return s ? s.slice(0, TEXT_CAP) : null;
}

export function coerceFoodItems(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value
    .map(foodItemLabel)
    .filter((x): x is string => !!x)
    .slice(0, MAX_ITEMS);
}

// Sum the macros the component rows actually carry. This is what lets fiber (and
// every other macro) be BUILT UP from the parts instead of guessed from the top
// down — used only as a fallback when the agent gave no meal total for that macro,
// so a stated total always wins.
export function foodMacroTotalsFrom(rows: unknown): Partial<Record<FoodMacroKey, number>> | null {
  if (!Array.isArray(rows)) return null;
  const totals: Partial<Record<FoodMacroKey, number>> = {};
  let saw = false;
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    for (const key of FOOD_MACRO_KEYS) {
      const n = asNum((row as Record<string, unknown>)[key]);
      if (n === undefined) continue;
      totals[key] = (totals[key] ?? 0) + n;
      saw = true;
    }
  }
  return saw ? totals : null;
}

export interface FoodProvenance {
  confidence: FoodConfidence;
  basis: FoodBasis;
}

// Entry-level provenance, always resolved. An absent or scored ("92%") confidence
// falls back to the honest FLOOR rather than being dropped — a missing band is
// exactly the ambiguity this field exists to remove — and an unrecognized basis
// falls back to how the calling path actually obtained the numbers.
export function coerceFoodProvenance(value: unknown, fallbackBasis: FoodBasis): FoodProvenance {
  const row = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const confidence = String(row.confidence ?? "").toLowerCase();
  const basis = String(row.basis ?? "").toLowerCase();
  return {
    confidence: (FOOD_CONFIDENCE_BANDS as readonly string[]).includes(confidence)
      ? (confidence as FoodConfidence)
      : "low",
    basis: (FOOD_BASIS_VALUES as readonly string[]).includes(basis) ? (basis as FoodBasis) : fallbackBasis,
  };
}

// Coerce/clamp the coarse pattern block. Bands are enum-checked, the fat split is
// dropped when it materially exceeds total fat (no false precision), and provenance
// is always present. Returns null when the payload carried nothing but provenance.
export function coerceNutritionPattern(
  value: unknown,
  fallbackBasis: string = "estimated_from_foods",
  totalFat?: unknown
): Record<string, any> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const out: Record<string, any> = {};
  const bands = new Set(["low", "moderate", "high", "unknown"]);
  for (const key of ["sodium", "potassium", "calcium", "iron", "saturated_fat", "added_sugar"]) {
    const band = String(row[key] ?? "").toLowerCase();
    if (bands.has(band)) out[key] = band;
  }
  for (const key of ["saturated_fat_g", "unsaturated_fat_g"] as const) {
    if (row[key] === null) {
      out[key] = null;
      continue;
    }
    const n = asNum(row[key]);
    if (n !== undefined) out[key] = Math.max(0, Math.min(300, Math.round(n * 10) / 10));
  }
  const totalFatG = asNum(totalFat);
  if (
    totalFatG !== undefined &&
    typeof out.saturated_fat_g === "number" &&
    typeof out.unsaturated_fat_g === "number" &&
    out.saturated_fat_g + out.unsaturated_fat_g > totalFatG * 1.15
  ) {
    out.saturated_fat_g = null;
    out.unsaturated_fat_g = null;
  }
  if (typeof row.omega_3_source === "boolean" || row.omega_3_source === null)
    out.omega_3_source = row.omega_3_source;
  for (const [key, max] of [
    ["alcohol_servings", 20],
    ["caffeine_mg", 2_000],
  ] as const) {
    const n = asNum(row[key]);
    if (n !== undefined) out[key] = Math.max(0, Math.min(max, Math.round(n * 10) / 10));
  }
  const caffeineTime = asStr(row.caffeine_time, 80);
  if (caffeineTime !== undefined) out.caffeine_time = caffeineTime;
  const quality = String(row.food_quality ?? "").toLowerCase();
  if (["mostly_whole", "mixed", "mostly_ultra_processed", "unknown"].includes(quality)) out.food_quality = quality;
  const provenance = coerceFoodProvenance(row, fallbackBasis as FoodBasis);
  out.confidence = provenance.confidence;
  out.basis = provenance.basis;
  // Provenance alone is not a pattern — only a block that carried at least one real
  // band or number is worth storing.
  return Object.keys(out).length > 2 ? out : null;
}

// ---- the stored blob -----------------------------------------------------------

export interface FoodCaptureInput {
  summary?: unknown;
  items?: unknown;
  ingredients?: unknown;
  kcal?: unknown;
  protein_g?: unknown;
  carbs_g?: unknown;
  fat_g?: unknown;
  fiber_g?: unknown;
  nutrition_pattern?: unknown;
  confidence?: unknown;
  basis?: unknown;
  notes?: unknown;
}

// Build the parsed_json blob for a capture path that stores an agent estimate
// DIRECTLY (chat's log_food, and the photo seed a vision-capable chat agent
// produced) — as opposed to the background enrichers, which MERGE over an existing
// blob and so apply these same coercions field by field.
//
// `summary` is resolved by the caller (each lane has its own fallback chain).
// `fallbackBasis` is that lane's honest default for how it got the numbers.
export function normalizeFoodCaptureParsed(
  input: FoodCaptureInput,
  opts: { summary: string; fallbackBasis: FoodBasis }
): Record<string, unknown> {
  const items = coerceFoodItems(input.items);
  const ingredients = coerceFoodIngredients(input.ingredients);
  // Totals build up from the components when the agent gave no meal-level number,
  // so fiber is no longer a top-down guess. A stated total always wins.
  const inferred = foodMacroTotalsFrom(input.ingredients) ?? foodMacroTotalsFrom(input.items);
  const parsed: Record<string, unknown> = { summary: opts.summary };
  if (items?.length) parsed.items = items;
  if (ingredients?.length) parsed.ingredients = ingredients;
  for (const key of FOOD_MACRO_KEYS) {
    const n = asNum(input[key] ?? inferred?.[key]);
    parsed[key] = n === undefined ? null : clampFoodMacro(key, n);
  }
  const provenance = coerceFoodProvenance(input, opts.fallbackBasis);
  parsed.confidence = provenance.confidence;
  parsed.basis = provenance.basis;
  const pattern = coerceNutritionPattern(input.nutrition_pattern, provenance.basis, parsed.fat_g);
  if (pattern) parsed.nutrition_pattern = pattern;
  parsed.notes = asStr(input.notes) ?? null;
  return parsed;
}

// ---- a person's ingredient-row edit ------------------------------------------
//
// The meal card lets the athlete fix a logged meal in place: change a row's grams,
// add a row, remove a row. The note's totals then follow from the rows with NO agent
// turn — the arithmetic below is the whole of it, and it lives here beside the row
// shape it edits so the capture contract stays the one place the shape is known.
//
// THE RULES (each one deterministic):
//   1. A row's macros SCALE with its quantity, from the row's OWN estimate. The
//      reference estimate is the stored twin (matched by item name AND amount first,
//      then by item name alone — first unused stored row either way, so reordering
//      two same-named rows never swaps their estimates), else the edited row's own
//      macros at its own amount. "205 g" → "250 g" multiplies every macro by
//      250/205; "2 eggs" → "3 eggs" by 3/2. Units must agree after normalization
//      (g/kg/oz/lb → g, ml/l → ml, a count word → itself); a quantity that cannot be compared keeps the old macros and the row
//      reads low confidence, because its numbers no longer describe its amount.
//   2. Macros a person TYPES win: an edited row whose macros differ from its stored
//      twin's is taken as stated (a label read, say) and never re-scaled.
//   3. A row the person ADDED or CHANGED that has no nutrition — typically a row they
//      just typed in — stays on the meal flagged `confidence: "low"` and contributes
//      nothing, so the totals are still the sum of what is known. There is no food
//      table in Cairn to look an unknown food up in, and inventing a number here would
//      be exactly the estimate-dressed-as-measurement foodCapture exists to prevent. A
//      row the person did not touch (the agent's "salt, a pinch" left at null on
//      purpose) is not re-judged by an unrelated edit.
//   4. The meal total is the rows plus whatever the stored total carried BEYOND the
//      stored rows (the "unitemized" part — cooking oil an agent counted at meal
//      level, or a whole meal-level estimate on a note whose rows carry no macros).
//      That remainder is never negative: when the stored rows already summed past the
//      stored total, the rows are the finer truth. A macro neither the rows nor the
//      stored total ever carried stays null, never 0.
//   5. The remainder belongs to the stored rows that carry no estimate of their own
//      for that macro — all of it to a lone such row, else split by amount when every
//      one of them states a comparable amount (all grams, say). A share that can be
//      placed follows its row: it scales with the row's quantity, leaves with the row,
//      and leaves when the person types that row's own number (so it is never counted
//      twice). A share that cannot be placed stays in the remainder, and a quantity
//      change it could not follow is reported (`unfollowed`) and reads low confidence.
//   6. An EMPTY replacement list clears the breakdown only: the rows go, the meal
//      totals stay exactly as stored. Deleting the note is how "nothing was eaten" is
//      said.

export interface FoodIngredientRow extends FoodIngredient {
  // Set only by a person's edit, and only to "low": the row has no nutrition, or
  // its quantity changed in a way its old estimate cannot be scaled to.
  confidence?: FoodConfidence;
}

export interface FoodQuantity {
  value: number;
  unit: string;
}

const MASS_TO_G: Record<string, number> = {
  g: 1,
  gr: 1,
  gram: 1,
  grams: 1,
  kg: 1000,
  kilogram: 1000,
  kilograms: 1000,
  oz: 28.3495,
  ounce: 28.3495,
  ounces: 28.3495,
  lb: 453.592,
  lbs: 453.592,
  pound: 453.592,
  pounds: 453.592,
};
const VOLUME_TO_ML: Record<string, number> = {
  ml: 1,
  milliliter: 1,
  milliliters: 1,
  millilitre: 1,
  millilitres: 1,
  l: 1000,
  liter: 1000,
  liters: 1000,
  litre: 1000,
  litres: 1000,
};

// Read a free-text amount into a comparable quantity. PURE. Mass normalizes to
// grams, volume to millilitres, anything else to its first word as a count unit
// ("2 eggs" → {2, "egg"}). Null when the amount does not start with a number.
export function parseFoodQuantity(amount: unknown): FoodQuantity | null {
  const s = String(amount ?? "")
    .trim()
    .toLowerCase()
    .replace(/^(~|about|approx\.?|approximately|around)\s*/, "");
  const m = s.match(/^(\d+(?:[.,]\d+)?)(?:\s*\/\s*(\d+))?\s*([a-z]+)?/);
  if (!m) return null;
  let value = Number(m[1].replace(",", "."));
  if (m[2]) value = value / Number(m[2]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const word = m[3] ?? "";
  if (word in MASS_TO_G) return { value: value * MASS_TO_G[word], unit: "g" };
  if (word in VOLUME_TO_ML) return { value: value * VOLUME_TO_ML[word], unit: "ml" };
  // A count word: fold a plain plural so "1 egg" and "3 eggs" compare.
  const unit = word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word;
  return { value, unit: unit || "unit" };
}

function formatGrams(g: number): string {
  return `${Math.round(g * 10) / 10} g`;
}

function rowMacros(row: Record<string, unknown> | null | undefined): Partial<Record<FoodMacroKey, number>> {
  const out: Partial<Record<FoodMacroKey, number>> = {};
  if (!row) return out;
  for (const key of FOOD_MACRO_KEYS) {
    const n = asNum(row[key]);
    if (n !== undefined) out[key] = n;
  }
  return out;
}

function itemKey(item: unknown): string {
  return String(item ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export interface FoodIngredientRecompute {
  ingredients: FoodIngredientRow[];
  // Only the macros the meal carries: a key absent here stays whatever it was
  // (null), never becomes 0.
  totals: Partial<Record<FoodMacroKey, number>>;
  // Rows the person added or changed that carry no kcal estimate (rule 3) — the note
  // reads low confidence while any remain. Untouched rows never count.
  unestimated: number;
  // Rows whose macros were scaled to a new quantity (rule 1).
  scaled: number;
  // Rows whose quantity changed but whose kcal the total could not follow: no estimate
  // of their own, and no remainder share that could be placed on them (rule 5).
  unfollowed: number;
  // The edit removed every row: the meal totals are the stored ones, unchanged (rule 6).
  cleared: boolean;
}

function amountKey(amount: unknown): string {
  return String(amount ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

// Whether two free-text amounts describe the same quantity ("200 g" and "200g" do).
function sameAmount(a: unknown, b: unknown): boolean {
  const qa = parseFoodQuantity(a);
  const qb = parseFoodQuantity(b);
  if (qa && qb) return qa.unit === qb.unit && Math.abs(qa.value - qb.value) <= 1e-6;
  return amountKey(a) === amountKey(b);
}

// Ratio new/old when both amounts parse to the same unit; null when they cannot be compared.
function quantityRatio(from: unknown, to: unknown): number | null {
  const a = parseFoodQuantity(from);
  const b = parseFoodQuantity(to);
  return a && b && a.unit === b.unit ? b.value / a.value : null;
}

/**
 * Apply a person's replacement ingredient list over the stored meal (rules above).
 * PURE. `previous` is the stored parsed blob (its `ingredients` + meal totals);
 * `edits` is the full new row list — send every row that should remain, in order.
 * Each edit row is the stored row shape plus an optional numeric `grams`, which
 * sets the amount to "<grams> g".
 */
export function recomputeFoodIngredients(
  previous: { ingredients?: unknown } & Partial<Record<FoodMacroKey, unknown>>,
  edits: unknown
): FoodIngredientRecompute {
  // Coerce the stored rows ONE AT A TIME, so a raw row the coercion drops cannot shift
  // an earlier edit's "low" (which coerceFoodIngredients does not read — agents never
  // send one) onto its neighbour.
  const rawStored = Array.isArray(previous?.ingredients)
    ? (previous.ingredients as unknown[]).slice(0, MAX_INGREDIENTS)
    : [];
  const stored: FoodIngredientRow[] = [];
  for (const raw of rawStored) {
    const row = coerceFoodIngredients([raw])?.[0] as FoodIngredientRow | undefined;
    if (!row) continue;
    if (raw && typeof raw === "object" && (raw as Record<string, unknown>).confidence === "low") row.confidence = "low";
    stored.push(row);
  }

  // Rule 4/5: the unitemized remainder per macro, and each stored row's placeable share of it.
  const storedTotal: Partial<Record<FoodMacroKey, number>> = {};
  const remainder: Partial<Record<FoodMacroKey, number>> = {};
  const shareOf: Partial<Record<FoodMacroKey, Map<number, number>>> = {};
  for (const key of FOOD_MACRO_KEYS) {
    const total = asNum(previous?.[key]);
    if (total !== undefined) storedTotal[key] = total;
    const prevSum = stored.reduce((sum, row) => sum + (row[key] ?? 0), 0);
    const r = total === undefined ? 0 : Math.max(0, total - prevSum);
    remainder[key] = r;
    const without = stored.map((row, i) => ({ row, i })).filter(({ row }) => row[key] === undefined);
    const shares = new Map<number, number>();
    if (r > 0 && without.length === 1) shares.set(without[0].i, 1);
    else if (r > 0 && without.length > 1) {
      const qty = without.map(({ row }) => parseFoodQuantity(row.amount));
      const unit = qty[0]?.unit;
      if (qty.every((q) => q && q.unit === unit)) {
        const sum = qty.reduce((acc, q) => acc + (q as FoodQuantity).value, 0);
        if (sum > 0) without.forEach(({ i }, j) => shares.set(i, (qty[j] as FoodQuantity).value / sum));
      }
    }
    shareOf[key] = shares;
  }

  const used = new Set<number>();
  const rawEdits = Array.isArray(edits) ? edits.slice(0, MAX_INGREDIENTS) : [];
  const rows: FoodIngredientRow[] = [];
  const delta: Partial<Record<FoodMacroKey, number>> = {};
  const addDelta = (key: FoodMacroKey, n: number) => {
    delta[key] = (delta[key] ?? 0) + n;
  };
  let unestimated = 0;
  let scaled = 0;
  let unfollowed = 0;

  for (const raw of rawEdits) {
    const base = coerceFoodIngredients([raw])?.[0];
    if (!base) continue;
    const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    // The stored twin: same item AND same amount first, then same item alone.
    const sameItem = (row: FoodIngredientRow, i: number) => !used.has(i) && itemKey(row.item) === itemKey(base.item);
    let twinIndex =
      base.amount !== undefined
        ? stored.findIndex((row, i) => sameItem(row, i) && amountKey(row.amount) === amountKey(base.amount))
        : -1;
    if (twinIndex < 0) twinIndex = stored.findIndex(sameItem);
    const twin = twinIndex >= 0 ? stored[twinIndex] : null;
    if (twinIndex >= 0) used.add(twinIndex);

    const grams = asNum(src.grams);
    const amount =
      grams !== undefined && grams > 0 ? formatGrams(Math.min(grams, 5000)) : (base.amount ?? twin?.amount);
    const editMacros = rowMacros(base as unknown as Record<string, unknown>);
    const twinMacros = rowMacros(twin as unknown as Record<string, unknown>);
    const hasEditMacros = Object.keys(editMacros).length > 0;
    const hasTwinMacros = Object.keys(twinMacros).length > 0;
    const statedByPerson =
      !!twin &&
      hasEditMacros &&
      FOOD_MACRO_KEYS.some((key) => editMacros[key] !== undefined && editMacros[key] !== twinMacros[key]);
    const amountChanged = !!twin && !sameAmount(twin.amount, amount);

    // The estimate a quantity change scales FROM.
    const ref = statedByPerson
      ? null
      : hasTwinMacros
        ? { amount: twin?.amount, macros: twinMacros, basis: twin?.basis }
        : hasEditMacros
          ? { amount: base.amount, macros: editMacros, basis: base.basis }
          : null;
    const refQty = parseFoodQuantity(ref?.amount);
    const newQty = parseFoodQuantity(amount);
    // A brand-new row that states its macros but no amount of its own describes the
    // grams it was given; there is nothing to scale from.
    const ownUnstatedRef = !!ref && !hasTwinMacros && !String(base.amount ?? "").trim();
    const quantityChanged = !!ref && !ownUnstatedRef && !sameAmount(ref.amount, amount);

    const row: FoodIngredientRow = { item: base.item };
    if (amount) row.amount = amount;
    let macros: Partial<Record<FoodMacroKey, number>>;
    let basis: FoodBasis | undefined;
    let low = false;
    if (statedByPerson) {
      macros = editMacros;
      basis = base.basis ?? "user_report";
    } else if (ref && quantityChanged) {
      if (refQty && newQty && refQty.unit === newQty.unit) {
        const ratio = newQty.value / refQty.value;
        macros = {};
        for (const key of FOOD_MACRO_KEYS) {
          const n = ref.macros[key];
          if (n !== undefined) macros[key] = clampIngredientMacro(key, n * ratio);
        }
        scaled++;
      } else {
        macros = ref.macros;
        low = true; // the old estimate no longer describes this amount
      }
      basis = "user_report"; // the quantity is now the person's own
    } else {
      macros = hasEditMacros ? editMacros : twinMacros;
      basis = amountChanged ? "user_report" : (base.basis ?? twin?.basis);
      // Nothing re-estimated this row, so an earlier "low" still describes it.
      if (twin?.confidence === "low") low = true;
    }
    for (const key of FOOD_MACRO_KEYS) if (macros[key] !== undefined) row[key] = macros[key];

    // Rule 5: the remainder share this stored row carried, for each macro it has no
    // number of its own for, follows the edit.
    let kcalFollowed = false;
    if (twin) {
      const ratio = amountChanged ? quantityRatio(twin.amount, amount) : 1;
      for (const key of FOOD_MACRO_KEYS) {
        if (twinMacros[key] !== undefined) continue;
        const share = shareOf[key]?.get(twinIndex);
        const r = remainder[key] ?? 0;
        if (share === undefined || !(r > 0)) continue;
        if (row[key] !== undefined)
          addDelta(key, -r * share); // now itemized: counted once
        else if (ratio != null) {
          addDelta(key, r * share * (ratio - 1));
          if (key === "kcal") kcalFollowed = true;
        }
      }
    }

    if (row.kcal === undefined && !kcalFollowed && (!twin || amountChanged)) {
      unestimated++;
      low = true;
      if (twin && amountChanged) unfollowed++;
    }
    if (basis) row.basis = basis;
    if (low) row.confidence = "low";
    rows.push(row);
  }

  // Rule 6: every row removed clears the breakdown, never the meal.
  if (!rows.length) {
    return { ingredients: [], totals: { ...storedTotal }, unestimated: 0, scaled: 0, unfollowed: 0, cleared: true };
  }

  // Rule 5: a stored row the edit removed takes its placeable share with it.
  stored.forEach((_row, i) => {
    if (used.has(i)) return;
    for (const key of FOOD_MACRO_KEYS) {
      const share = shareOf[key]?.get(i);
      if (share !== undefined) addDelta(key, -(remainder[key] ?? 0) * share);
    }
  });

  const totals: Partial<Record<FoodMacroKey, number>> = {};
  for (const key of FOOD_MACRO_KEYS) {
    const carried = rows.filter((row) => row[key] !== undefined);
    if (!carried.length && storedTotal[key] === undefined) continue;
    const unitemized = Math.max(0, (remainder[key] ?? 0) + (delta[key] ?? 0));
    totals[key] = unitemized + carried.reduce((sum, row) => sum + (row[key] ?? 0), 0);
  }
  return { ingredients: rows, totals, unestimated, scaled, unfollowed, cleared: false };
}

// ---- the athlete's own lines, before (or without) any estimate ----------------
//
// A pasted meal of six lines is six things eaten, whether or not an agent ever reads
// it. When no estimate exists yet — enrichment off, no agent reachable, or simply not
// run yet — the words are split deterministically into rows so the meal card shows
// what was eaten at once:
//   - each non-empty line (a leading bullet or "1." dropped) is one row; a single line
//     is split on commas/semicolons instead ("oats 60 g, milk 250 ml, a banana"), but
//     never inside a number ("1,5 kg");
//   - a line that is only a meal heading ("Breakfast:") is not a row, and a short
//     lead-in before a colon ("Log lunch: …", "I had: …") is not part of the first one;
//   - a quantity the athlete wrote — leading ("60 g oats", "2 eggs") or trailing
//     ("oats 60g", "rice - 150 g", "chicken (205 g)", "toast x2") — goes into `amount`
//     as they wrote it; the rest of their words is the item;
//   - NO macros are invented. The rows carry no numbers; the meal reads
//     `confidence: "low"`, `basis: "user_report"` (the items and amounts are the
//     athlete's own words). A later agent estimate replaces the rows and fills the
//     numbers — unless a person has edited the meal, which locks it (repo/nutrition.ts).

// Units a written quantity may carry: parseFoodQuantity's mass and volume words, plus
// the household measures people actually type.
const FOOD_UNIT_WORDS = [
  ...Object.keys(MASS_TO_G),
  ...Object.keys(VOLUME_TO_ML),
  "cup",
  "cups",
  "tbsp",
  "tsp",
  "tablespoon",
  "tablespoons",
  "teaspoon",
  "teaspoons",
  "slice",
  "slices",
  "scoop",
  "scoops",
  "piece",
  "pieces",
  "pc",
  "pcs",
  "serving",
  "servings",
  "handful",
  "handfuls",
  "can",
  "cans",
  "bowl",
  "bowls",
  "glass",
  "glasses",
  "bar",
  "bars",
];
const UNIT_RE = `(?:${FOOD_UNIT_WORDS.join("|")})`;
const NUM_RE = String.raw`(?:~\s*)?\d+(?:[.,]\d+)?(?:\s*\/\s*\d+)?`;
const LEADING_UNIT = new RegExp(String.raw`^(${NUM_RE}\s*${UNIT_RE})\.?(?:\s+of)?\s+(.+)$`, "i");
const LEADING_COUNT = new RegExp(String.raw`^(${NUM_RE}|½|¼|¾)\s+(.+)$`, "i");
const TRAILING_UNIT = new RegExp(String.raw`^(.+?)[\s,:\-–—(]+(${NUM_RE}\s*${UNIT_RE})\.?\)?$`, "i");
const TRAILING_TIMES = /^(.+?)\s*[x×]\s*(\d+)$/i;
const BULLET_RE = /^\s*(?:[-*•·–—]+|\d+[.)])\s+/;
const MEAL_HEADING_RE = /^(?:breakfast|brunch|lunch|dinner|supper|snacks?|meal|pre-?workout|post-?workout)\s*:?\s*$/i;
const LEAD_IN_RE = /^[^:\d\n]{1,40}:\s*(?=\S)/;
const SPOKEN_LEAD_RE =
  /^(?:i\s+)?(?:just\s+)?(?:had|ate|eaten|log(?:ged)?)\b(?:\s+(?:for\s+)?(?:breakfast|brunch|lunch|dinner|supper|a\s+snack))?\s*:?\s*/i;

function foodRowFromWords(words: string): FoodIngredient | null {
  const text = words.replace(/\s+/g, " ").trim();
  if (!text || MEAL_HEADING_RE.test(text)) return null;
  const row = (item: string, amount?: string): FoodIngredient | null => {
    const it = item.replace(/^[\s,:\-–—]+|[\s,:\-–—]+$/g, "").slice(0, TEXT_CAP);
    if (!it) return amount ? { item: amount.slice(0, TEXT_CAP) } : null;
    return amount ? { item: it, amount: amount.trim().slice(0, TEXT_CAP) } : { item: it };
  };
  let m = text.match(LEADING_UNIT);
  if (m) return row(m[2], m[1]);
  m = text.match(TRAILING_UNIT);
  if (m) return row(m[1], m[2]);
  m = text.match(TRAILING_TIMES);
  if (m) return row(m[1], m[2]);
  m = text.match(LEADING_COUNT);
  if (m) return row(m[2], m[1]);
  return row(text);
}

/**
 * Split an athlete's own meal words into ingredient rows — one per line, bullet or
 * (on a single line) comma-list item — with the quantity they wrote as `amount`.
 * PURE, deterministic, no macros. Rules above. Empty when there is nothing to split.
 */
export function foodRowsFromWords(text: unknown): FoodIngredient[] {
  const raw = String(text ?? "").replace(/\r\n?/g, "\n");
  let lines = raw
    .split("\n")
    .map((line) => line.replace(BULLET_RE, "").trim())
    .filter((line) => line && !MEAL_HEADING_RE.test(line));
  if (!lines.length) return [];
  // A short lead-in on the first line ("Log lunch: …", "I had: …") is not something eaten.
  const first = lines[0].replace(LEAD_IN_RE, "").replace(SPOKEN_LEAD_RE, "").trim();
  lines = first ? [first, ...lines.slice(1)] : lines.slice(1);
  const segments =
    lines.length === 1
      ? lines[0]
          .split(/[;,](?!\d)/)
          .map((part) => part.trim())
          .filter(Boolean)
      : lines;
  return segments
    .map(foodRowFromWords)
    .filter((row): row is FoodIngredient => !!row)
    .slice(0, MAX_INGREDIENTS);
}

/** True when a stored blob carries no estimate at all: no rows, no items, no numbers. */
export function foodParsedHasNoEstimate(parsed: unknown): boolean {
  if (!parsed || typeof parsed !== "object") return true;
  const row = parsed as Record<string, unknown>;
  if (Array.isArray(row.ingredients) && row.ingredients.length) return false;
  if (Array.isArray(row.items) && row.items.length) return false;
  return FOOD_MACRO_KEYS.every((key) => asNum(row[key]) === undefined);
}

/**
 * The words-only capture: when `parsed` carries no estimate, the athlete's own text
 * becomes rows (foodRowsFromWords) with no macros, `confidence: "low"` and
 * `basis: "user_report"`. Anything already in `parsed` (a summary) is kept. Returns
 * `parsed` untouched when it already carries an estimate or the text has no rows.
 */
export function withWordRows<T extends Record<string, unknown> | null | undefined>(
  parsed: T,
  text: unknown
): T | Record<string, unknown> {
  if (!foodParsedHasNoEstimate(parsed)) return parsed;
  const rows = foodRowsFromWords(text);
  if (!rows.length) return parsed;
  return {
    ...(parsed ?? {}),
    ingredients: rows,
    confidence: "low",
    basis: "user_report",
  };
}
