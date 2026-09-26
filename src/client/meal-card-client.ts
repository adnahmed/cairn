// @ts-check
// The meal card's view (docs/V2-PLAN.md wave 2, stream B; docs/DESIGN.md
// "Component architecture"). One row per item in the src/foodCapture.ts ingredient
// shape, each with its grams in a decimal field, a remove button and the row's own
// estimate; an add button; the meal's totals; and one Save. How the numbers were
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

  /**
   * The whole card. `totals:false` leaves the total to the host (the food detail
   * sheet prints its own hero and takes the card's live totals through onTotals).
   */
  function mealCardHtml(m: ClientMealCardModel, opts: { totals?: boolean } = {}): string {
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
        <button class="pillbtn pill-accent meal-card-save" type="button" data-meal-card-save disabled>Save</button>
      </div>
    </section>`;
  }

  const CAIRN_MEAL_CARD = {
    mealCardHtml,
    rowHtml,
    rowMainHtml,
    rowNutriText,
    totalsText,
  };

  Object.assign(globalThis, { CairnMealCard: CAIRN_MEAL_CARD });
}
