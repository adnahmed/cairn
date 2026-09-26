// @ts-check
// The meal card's pure shaping (docs/V2-PLAN.md wave 2, stream B). A logged meal is
// one row per item in the src/foodCapture.ts ingredient shape — `item`, `amount` as
// its own field, per-row macros and an optional per-row `basis`. This turns a stored
// food note into rows the card can edit, rescales a row when its grams change, and
// works out the totals the card shows before the server answers.
//
// The server owns the numbers. The optimistic total is the server's stored total
// moved by exactly what the edits changed (never a fresh sum that could disagree
// with the stored meal on first paint), and it is replaced by the totals the PUT
// returns. A row whose amount carries no weight ("2 eggs") takes grams, but its
// macros are not rescaled: there is no per-gram figure to scale from.
{
  type Row = ClientMealCardRow;
  type Totals = ClientMealCardTotals;
  type MacroKey = ClientMealCardMacroKey;

  const MACRO_KEYS: readonly MacroKey[] = ["kcal", "protein_g", "carbs_g", "fat_g", "fiber_g"];
  const MAX_GRAMS = 5000;
  const GRAMS_PER_UNIT: Record<string, number> = {
    g: 1,
    gr: 1,
    gram: 1,
    grams: 1,
    kg: 1000,
    oz: 28.35,
    ounce: 28.35,
    ounces: 28.35,
  };

  // The food-capture contract's own basis values, in the athlete's register — how a
  // number was obtained, never a grade.
  const BASIS_WORDS: Record<string, string> = {
    label: "read off the label",
    user_report: "as you said",
    photo: "read from the photo",
    estimated_from_foods: "estimated from usual servings",
  };

  function record(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  }

  function num(value: unknown): number | null {
    if (value === null || value === undefined || value === "") return null;
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  function text(value: unknown): string {
    return value === null || value === undefined ? "" : String(value).trim();
  }

  /** Grams in an amount ("205 g", "0.2 kg", "6 oz"), or null when it states no weight. */
  function gramsFromAmount(amount: unknown): number | null {
    const match = /^~?\s*(\d+(?:[.,]\d+)?)\s*(g|gr|grams?|kg|oz|ounces?)\.?$/i.exec(text(amount));
    if (!match) return null;
    const value = Number(match[1].replace(",", ".")) * (GRAMS_PER_UNIT[match[2].toLowerCase()] ?? 0);
    return Number.isFinite(value) && value > 0 ? Math.round(value * 10) / 10 : null;
  }

  /** What a person typed into a grams field, or null when it is not a usable weight. */
  function parseGramsInput(value: unknown): number | null {
    const raw = text(value).replace(",", ".");
    if (!/^\d*\.?\d+$|^\d+\.$/.test(raw)) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 && n <= MAX_GRAMS ? Math.round(n * 10) / 10 : null;
  }

  function formatGrams(grams: number | null): string {
    if (grams == null) return "";
    return String(Math.round(grams * 10) / 10);
  }

  function parsedOf(note: unknown): Record<string, unknown> {
    const row = record(note);
    let parsed: unknown = row.parsed;
    if (typeof parsed === "string" || ((parsed == null || typeof parsed !== "object") && row.parsed_json)) {
      try {
        parsed = JSON.parse(String(typeof parsed === "string" ? parsed : row.parsed_json));
      } catch {
        parsed = null;
      }
    }
    return record(parsed);
  }

  function baseMacros(raw: Record<string, unknown>): Record<MacroKey, number | null> {
    const out = {} as Record<MacroKey, number | null>;
    for (const key of MACRO_KEYS) out[key] = num(raw[key]);
    return out;
  }

  function rowFrom(raw: unknown, key: string): Row | null {
    if (typeof raw === "string") return raw.trim() ? rowFrom({ item: raw }, key) : null;
    const r = record(raw);
    const item = text(r.item ?? r.name ?? r.food);
    if (!item) return null;
    const amount = text(r.amount ?? r.qty ?? r.quantity ?? r.portion);
    const grams = gramsFromAmount(amount);
    const basis = text(r.basis);
    return {
      key,
      item,
      amount,
      baseGrams: grams,
      grams,
      base: baseMacros(r),
      basis: basis || null,
      added: false,
      edited: false,
    };
  }

  /**
   * The card's rows from a stored food note's `ingredients`. A bare `items` list (the
   * older photo shape) is not rows: it carries no per-item numbers to edit, so a
   * note with only that keeps its read-only line.
   */
  function mealCardRows(note: unknown): Row[] {
    const parsed = parsedOf(note);
    const source = Array.isArray(parsed.ingredients) ? parsed.ingredients : [];
    return source.map((raw, i) => rowFrom(raw, `r${i}`)).filter((row): row is Row => !!row);
  }

  /** The meal's stored totals, as the server wrote them. */
  function storedTotals(note: unknown): Totals {
    return baseMacros(parsedOf(note)) as Totals;
  }

  /** A row's macros at its current grams: scaled only when both weights are known. */
  function rowMacros(row: Row): Record<MacroKey, number | null> {
    const scale = row.baseGrams && row.grams != null && !row.added ? row.grams / row.baseGrams : 1;
    const out = {} as Record<MacroKey, number | null>;
    for (const key of MACRO_KEYS) {
      const base = row.base[key];
      out[key] = base == null ? null : Math.round(base * scale * 10) / 10;
    }
    return out;
  }

  function sumRows(rows: readonly Row[], key: MacroKey): number | null {
    let total: number | null = null;
    for (const row of rows) {
      const value = rowMacros(row)[key];
      if (value != null) total = (total ?? 0) + value;
    }
    return total;
  }

  /**
   * The totals to show while an edit is unsaved: the stored total moved by what the
   * edits changed. A key the meal never stored falls back to the rows' own sum.
   */
  function optimisticTotals(stored: Totals, original: readonly Row[], current: readonly Row[]): Totals {
    const out = {} as Totals;
    for (const key of MACRO_KEYS) {
      const now = sumRows(current, key);
      const before = sumRows(original, key);
      const base = stored[key];
      if (base == null) out[key] = now == null ? null : Math.round(now);
      else out[key] = Math.max(0, Math.round(base + (now ?? 0) - (before ?? 0)));
    }
    return out;
  }

  /** One row in the PUT body, in the foodCapture.ts ingredient shape. */
  function rowBody(row: Row): Record<string, unknown> {
    const macros = rowMacros(row);
    const grams = row.grams != null && row.grams !== row.baseGrams;
    const body: Record<string, unknown> = {
      item: row.item,
      amount: grams || (row.added && row.grams != null) ? `${formatGrams(row.grams)} g` : row.amount,
    };
    for (const key of MACRO_KEYS) body[key] = macros[key];
    // A weight the athlete typed is a stated quantity (foodCapture.ts: "user_report").
    body.basis = row.added || (row.edited && row.baseGrams) ? "user_report" : row.basis;
    return body;
  }

  /** The rows a save would send: an added row with no name yet is not a row. */
  function savableRows(rows: readonly Row[]): Row[] {
    return rows.filter((row) => row.item.trim() !== "");
  }

  /** True when the rows differ from what the server last stored. */
  function rowsChanged(original: readonly Row[], rows: readonly Row[]): boolean {
    const current = savableRows(rows);
    if (original.length !== current.length) return true;
    return current.some((row, i) => {
      const was = original[i];
      return row.key !== was.key || row.item !== was.item || row.grams !== was.grams;
    });
  }

  function basisWords(basis: unknown): string {
    return BASIS_WORDS[text(basis)] || "";
  }

  function confidenceWords(confidence: unknown): string {
    const c = text(confidence);
    return c === "low" || c === "medium" || c === "high" ? `${c} confidence` : "";
  }

  /** How the meal's numbers were obtained, as one quiet line ("" when unknown). */
  function provenanceLine(note: unknown): string {
    const parsed = parsedOf(note);
    const bits = [basisWords(parsed.basis), confidenceWords(parsed.confidence)].filter(Boolean);
    const line = bits.join(" · ");
    return line ? line.charAt(0).toUpperCase() + line.slice(1) : "";
  }

  /** The row's own basis in words, only when it differs from the meal's. */
  function rowBasisLine(row: Row, mealBasis: unknown): string {
    if (!row.basis || row.basis === text(mealBasis)) return "";
    return basisWords(row.basis);
  }

  function mealCardModel(note: unknown): ClientMealCardModel {
    const row = record(note);
    const id = Number(row.id);
    const parsed = parsedOf(note);
    return {
      id: Number.isSafeInteger(id) && id > 0 ? id : null,
      rows: mealCardRows(note),
      totals: storedTotals(note),
      basis: text(parsed.basis) || null,
      provenance: provenanceLine(note),
    };
  }

  const CAIRN_MEAL_CARD_MODEL = {
    MACRO_KEYS,
    gramsFromAmount,
    parseGramsInput,
    formatGrams,
    mealCardModel,
    mealCardRows,
    storedTotals,
    rowMacros,
    optimisticTotals,
    rowBody,
    rowsChanged,
    savableRows,
    rowBasisLine,
    basisWords,
    confidenceWords,
  };

  Object.assign(globalThis, { CairnMealCardModel: CAIRN_MEAL_CARD_MODEL });
}
