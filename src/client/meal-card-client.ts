// @ts-check
// The meal card's view (docs/V2-PLAN.md wave 2, stream B; docs/DESIGN.md
// "Component architecture"). Approximate by default: the card first READS — one
// quiet line per item in the src/foodCapture.ts ingredient shape, its portion in
// words and a muted ~kcal — because the point of approximate logging is that nobody
// weighed it. An explicit Edit opens the editors: each row's grams in a decimal
// field, a remove button and the row's own estimate; an add button; the meal's
// totals; one Save and a Done/Cancel that closes them again. How the numbers were
// obtained is shown as words, never a grade. Pure renderers: every caller string
// goes through escHtml/escAttr, and the controller (meal-card-controller.ts) does
// the wiring.
{
  type Row = ClientMealCardRow;
  type Totals = ClientMealCardTotals;
  type Model = CairnMealCardModelApi;

  const model = (): Model => CairnMealCardModel;

  function round(value: number): string {
    return String(Math.round(value));
  }

  /** "640 kcal · 42 g protein · 8 g fiber · 60 g carbs · 20 g fat"; "" when nothing is known. */
  function totalsText(totals: Totals): string {
    const bits: string[] = [];
    if (totals.kcal != null) bits.push(`${round(totals.kcal)} kcal`);
    if (totals.protein_g != null) bits.push(`${round(totals.protein_g)} g protein`);
    if (totals.fiber_g != null) bits.push(`${round(totals.fiber_g)} g fiber`);
    if (totals.carbs_g != null) bits.push(`${round(totals.carbs_g)} g carbs`);
    if (totals.fat_g != null) bits.push(`${round(totals.fat_g)} g fat`);
    return bits.join(" · ");
  }

  /** The row's own estimate at its current grams ("~330 kcal · 62 g protein"). */
  function rowNutriText(row: Row): string {
    const macros = model().rowMacros(row);
    const bits: string[] = [];
    if (macros.kcal != null) bits.push(`~${round(macros.kcal)} kcal`);
    if (macros.protein_g != null) bits.push(`${round(macros.protein_g)} g protein`);
    return bits.length ? bits.join(" · ") : "not estimated";
  }

  function rowNameHtml(row: Row): string {
    if (row.added) {
      return `<input class="meal-card-name" type="text" data-meal-card-name value="${escAttr(row.item)}"
        maxlength="80" autocomplete="off" placeholder="What was it?" aria-label="Item name">`;
    }
    return `<span class="meal-card-item">${escHtml(row.item)}</span>`;
  }

  function amountHtml(row: Row): string {
    // The stated amount stays visible when it is not a weight ("2 eggs"), so the
    // grams field never hides what was actually logged.
    if (!row.amount || row.baseGrams != null) return "";
    return `<span class="meal-card-amount">${escHtml(row.amount)}</span>`;
  }

  /** The row's text column: name, estimate, stated amount and provenance words. */
  function rowMainHtml(row: Row, opts: { mealBasis?: unknown } = {}): string {
    const note = model().rowNoteLine(row, opts.mealBasis);
    return `${rowNameHtml(row)}
        <span class="meal-card-nutri">${escHtml(rowNutriText(row))}</span>
        ${amountHtml(row)}
        ${note ? `<span class="meal-card-basis">${escHtml(note)}</span>` : ""}`;
  }

  function rowHtml(row: Row, opts: { mealBasis?: unknown } = {}): string {
    const name = row.item || "this item";
    return `<li class="meal-card-row${row.added ? " is-added" : ""}" data-meal-card-row="${escAttr(row.key)}">
      <div class="meal-card-main">${rowMainHtml(row, opts)}</div>
      <label class="meal-card-grams">
        <input class="meal-card-grams-input" type="text" inputmode="decimal" autocomplete="off"
          enterkeyhint="done" data-meal-card-grams value="${escAttr(model().formatGrams(row.grams))}"
          placeholder="—" aria-label="${escAttr(`Grams of ${name}`)}">
        <span class="meal-card-unit" aria-hidden="true">g</span>
      </label>
      <button class="meal-card-remove" type="button" data-meal-card-remove
        aria-label="${escAttr(`Remove ${name}`)}"><span aria-hidden="true">×</span></button>
    </li>`;
  }

  function rowsHtml(rows: readonly Row[], mealBasis: unknown): string {
    return rows.map((row) => rowHtml(row, { mealBasis })).join("");
  }

  /** The row's own estimate as one muted number ("~330 kcal"); "" when it has none. */
  function rowKcalText(row: Row): string {
    const kcal = model().rowMacros(row).kcal;
    return kcal != null && kcal > 0 ? `~${round(kcal)} kcal` : "";
  }

  /** A macro in grams for reading: whole above 10, one decimal below, never "0.0". */
  function macroG(value: number): string {
    return value >= 10 ? String(Math.round(value)) : String(Math.round(value * 10) / 10);
  }

  /**
   * "24 g P · 1 g C · 14 g F · 0 g fiber": only the macros the row actually carries.
   * A null is unknown and is left out, never printed as "0 g".
   */
  function rowMacroText(row: Row): string {
    const m = model().rowMacros(row);
    const bits: string[] = [];
    if (m.protein_g != null) bits.push(`${macroG(m.protein_g)} g P`);
    if (m.carbs_g != null) bits.push(`${macroG(m.carbs_g)} g C`);
    if (m.fat_g != null) bits.push(`${macroG(m.fat_g)} g F`);
    if (m.fiber_g != null) bits.push(`${macroG(m.fiber_g)} g fiber`);
    return bits.join(" · ");
  }

  /**
   * The meal's macro split at rest: a slim bar of protein / carbs / fat by their share
   * of the meal's energy, then the grams as words, fiber as text. Only what the meal
   * carries is drawn; with fewer than two of P/C/F known there is no split to show.
   */
  function macroSplitHtml(totals: Totals): string {
    const parts = [
      { cls: "p", label: "protein", g: totals.protein_g, kcalPerG: 4 },
      { cls: "c", label: "carbs", g: totals.carbs_g, kcalPerG: 4 },
      { cls: "f", label: "fat", g: totals.fat_g, kcalPerG: 9 },
    ];
    const known = parts.filter((part) => part.g != null);
    const words = [
      ...known.map((part) => `${macroG(part.g as number)} g ${part.label}`),
      ...(totals.fiber_g != null ? [`${macroG(totals.fiber_g)} g fiber`] : []),
    ];
    if (!words.length) return "";
    const energy = known.reduce((sum, part) => sum + (part.g as number) * part.kcalPerG, 0);
    const bar =
      known.length >= 2 && energy > 0
        ? `<span class="meal-card-split-bar" aria-hidden="true">${known
            .filter((part) => (part.g as number) > 0)
            .map(
              (part) =>
                `<span class="meal-card-split-seg is-${part.cls}" style="--frac:${Math.round(((part.g as number) * part.kcalPerG * 1000) / energy)}"></span>`
            )
            .join("")}</span>`
        : "";
    return `<div class="meal-card-split" role="group" aria-label="Meal macros">${bar}<p class="meal-card-split-text">${escHtml(words.join(" · "))}</p></div>`;
  }

  /** One read-only line: the item, its portion in words, a muted ~kcal, then its macros. */
  function readRowHtml(row: Row): string {
    const portion = model().portionWords(row.amount);
    const kcal = rowKcalText(row);
    const macros = rowMacroText(row);
    return `<li class="meal-card-row is-read" data-meal-card-row="${escAttr(row.key)}">
      <span class="meal-card-item">${escHtml(row.item)}</span>${
        portion ? `<span class="meal-card-amount">${escHtml(portion)}</span>` : ""
      }${kcal ? `<span class="meal-card-nutri">${escHtml(kcal)}</span>` : ""}${
        macros ? `<span class="meal-card-macros">${escHtml(macros)}</span>` : ""
      }
    </li>`;
  }

  /** The card at rest: what was eaten, approximately, and one Edit. */
  function readCardHtml(m: ClientMealCardModel): string {
    return `<section class="meal-card is-read" data-meal-card="${escAttr(m.id ?? "")}" aria-label="Items in this meal">
      <div class="meal-card-head">
        <span class="lbl">Items</span>
        <span class="meal-card-prov"${m.provenance ? "" : " hidden"}>${escHtml(m.provenance)}</span>
        <button class="linkbtn linkbtn-quiet meal-card-edit" type="button" data-meal-card-edit
          aria-label="Edit the items in this meal">Edit</button>
      </div>
      ${macroSplitHtml(m.totals)}
      <ul class="meal-card-rows is-read">${m.rows.map(readRowHtml).join("")}</ul>
      <p class="meal-card-status" role="status" aria-live="polite"></p>
    </section>`;
  }

  /**
   * The whole card. `totals:false` leaves the total to the host (the food detail
   * sheet prints its own hero and takes the card's live totals through onTotals).
   */
  function mealCardHtml(m: ClientMealCardModel, opts: { totals?: boolean; editing?: boolean } = {}): string {
    if (!opts.editing) return readCardHtml(m);
    const showTotals = opts.totals !== false;
    const totals = totalsText(m.totals);
    return `<section class="meal-card" data-meal-card="${escAttr(m.id ?? "")}" aria-label="Items in this meal">
      <div class="meal-card-head">
        <span class="lbl">Items</span>
        <span class="meal-card-prov"${m.provenance ? "" : " hidden"}>${escHtml(m.provenance)}</span>
      </div>
      <ul class="meal-card-rows${m.rows.length === 1 ? " is-single" : ""}">${rowsHtml(m.rows, m.basis)}</ul>
      <button class="linkbtn-quiet meal-card-add" type="button" data-meal-card-add>Add an item</button>
      ${showTotals ? `<p class="meal-card-totals"${totals ? "" : " hidden"}>${escHtml(totals)}</p>` : ""}
      <div class="meal-card-foot">
        <p class="meal-card-status" role="status" aria-live="polite"></p>
        <button class="linkbtn linkbtn-quiet meal-card-done" type="button" data-meal-card-done>Done</button>
        <button class="pillbtn pill-accent meal-card-save" type="button" data-meal-card-save disabled>Save</button>
      </div>
    </section>`;
  }

  const CAIRN_MEAL_CARD = {
    mealCardHtml,
    readRowHtml,
    rowKcalText,
    rowMacroText,
    macroSplitHtml,
    rowHtml,
    rowMainHtml,
    rowNutriText,
    totalsText,
  };

  Object.assign(globalThis, { CairnMealCard: CAIRN_MEAL_CARD });
}
