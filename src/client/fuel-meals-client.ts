// @ts-check
// Fuel — the day's logged meals (docs/V2-PLAN.md wave 2). The view: one quiet row per
// meal (what it was, when, its estimate), which opens into the meal card
// (meal-card-*.ts) where the items are corrected in place, plus a Remove. A meal
// with no items to adjust (a whole-meal entry, an estimate that did not finish)
// opens into a small totals correction instead: what it was, its slot and its
// numbers, protein first, saved with one PUT. A meal still being estimated says so
// and opens into nothing to edit yet. Pure renderers
// over CairnFuelTodayModel's meal models; fuel-meals-controller.ts wires them.
{
  type Meal = ClientFuelMeal;

  function numsHtml(meal: Meal): string {
    const text = CairnFuelTodayModel.mealNumsText(meal);
    if (meal.pending) return `<span class="fuel-meal-nums is-pending">estimating…</span>`;
    return `<span class="fuel-meal-nums">${escHtml(text || "not estimated")}</span>`;
  }

  /** The head's text column: name, meal/time words. The numbers sit beside it. */
  function headMainHtml(meal: Meal): string {
    return `<span class="fuel-meal-name">${escHtml(meal.title)}</span>
        ${meal.meta ? `<span class="fuel-meal-meta">${escHtml(meal.meta)}</span>` : ""}`;
  }

  // Protein first: it is the anchor. The keys are the PUT /food-notes/:id fields.
  const FIX_FIELDS = [
    ["protein_g", "Protein (g)"],
    ["kcal", "Energy (kcal)"],
    ["carbs_g", "Carbs (g)"],
    ["fat_g", "Fat (g)"],
    ["fiber_g", "Fiber (g)"],
  ] as const;
  const FIX_SLOTS = ["breakfast", "lunch", "dinner", "snack", "meal"] as const;

  function fixValue(value: unknown): string {
    if (value == null || value === "") return "";
    const n = Number(value);
    return Number.isFinite(n) ? String(Math.round(n * 10) / 10) : "";
  }

  /**
   * The totals correction for a settled meal with no items to adjust. The fields
   * start from what is stored; a blank number stays unknown (never a zero).
   */
  function fixFormHtml(meal: Meal): string {
    const id = `fuelMeal${meal.id}Fix`;
    const parsed = meal.note.parsed;
    // The athlete's own label (not one of the five) stays an option, chosen.
    const lower = meal.slot.toLowerCase();
    const known = FIX_SLOTS.some((slot) => slot === lower);
    const current = known ? lower : meal.slot || "meal";
    const slots = [...FIX_SLOTS, ...(known || !meal.slot ? [] : [meal.slot])]
      .map((slot) => {
        const label = CairnFuelTodayModel.mealLabel(slot) || slot;
        const selected = slot === current ? " selected" : "";
        return `<option value="${escAttr(slot)}"${selected}>${escHtml(label)}</option>`;
      })
      .join("");
    const nums = FIX_FIELDS.map(
      ([key, label]) => `<div class="field"><label for="${id}-${key}">${label}</label>
          <input id="${id}-${key}" type="number" inputmode="decimal" min="0" step="any" data-fuel-meal-fix-field="${key}" value="${escAttr(fixValue(parsed[key]))}"></div>`
    ).join("");
    return `<div class="fuel-meal-fix" data-fuel-meal-fix>
        <div class="field"><label for="${id}-summary">What it was</label>
          <input id="${id}-summary" type="text" maxlength="200" data-fuel-meal-fix-field="summary" value="${escAttr(meal.title)}"></div>
        <div class="field"><label for="${id}-meal">Meal</label>
          <select id="${id}-meal" data-fuel-meal-fix-field="meal">${slots}</select></div>
        <div class="fuel-meal-fix-nums">${nums}</div>
        <div class="fuel-meal-fix-actions">
          <button class="pillbtn pill-accent" type="button" data-fuel-meals-fix>Save</button>
        </div>
      </div>`;
  }

  function fixNoteHtml(meal: Meal): string {
    const words = meal.failed
      ? "The estimate for this one didn't finish. Enter what you know and it counts toward the day."
      : "Logged as one whole meal. Its numbers can be corrected here.";
    return `<p class="fuel-meal-note">${words}</p>`;
  }

  function panelBodyHtml(meal: Meal): string {
    const raw = meal.raw ? `<p class="fuel-meal-raw">As logged: “${escHtml(meal.raw)}”</p>` : "";
    const card = meal.editable
      ? `<div class="fuel-meal-card" data-fuel-meal-card></div>`
      : meal.pending
        ? `<p class="fuel-meal-note" role="status">Still being estimated. Its items appear here once it settles.</p>`
        : `${fixNoteHtml(meal)}${fixFormHtml(meal)}`;
    return `${card}${raw}
      <div class="fuel-meal-actions">
        <button class="linkbtn linkbtn-quiet fuel-meal-remove" type="button" data-fuel-meals-remove>Remove this meal</button>
      </div>`;
  }

  /**
   * One meal: a disclosure head over its panel. The panel opens through the grid-rows
   * 0fr→1fr pattern (`.fuel-meal.is-open`), so no height is ever hand-animated and a
   * closed panel is out of the tab order. `enter` settles a just-arrived meal in.
   */
  function mealHtml(meal: Meal, opts: { enter?: boolean } = {}): string {
    const panelId = `fuelMeal${meal.id}Panel`;
    return `<li class="fuel-meal${opts.enter ? " settle-in" : ""}" data-fuel-meal="${meal.id}">
      <button class="fuel-meal-head" type="button" data-fuel-meals-toggle aria-expanded="false" aria-controls="${panelId}">
        <span class="fuel-meal-art" aria-hidden="true">${art("food", meal.title)}</span>
        <span class="fuel-meal-main">${headMainHtml(meal)}</span>
        ${numsHtml(meal)}
        <span class="fuel-meal-chev" aria-hidden="true">›</span>
      </button>
      <div class="fuel-meal-panel" id="${panelId}"><div class="fuel-meal-panel-in">${panelBodyHtml(meal)}</div></div>
    </li>`;
  }

  function emptyHtml(isToday: boolean): string {
    return isToday ? "" : `<p class="fuel-meals-empty">No meals were logged that day.</p>`;
  }

  function listHtml(meals: readonly Meal[], opts: { isToday?: boolean } = {}): string {
    if (!meals.length) return emptyHtml(opts.isToday !== false);
    return `<section class="fuel-meals reveal" style="--i:1" aria-label="Meals logged">
      <h2 class="lbl fuel-meals-title">Meals</h2>
      <ul class="fuel-meals-list">${meals.map((meal) => mealHtml(meal)).join("")}</ul>
    </section>`;
  }

  function errorHtml(): string {
    return `<p class="fuel-meals-empty" role="status">The meals couldn't be read just now.</p>`;
  }

  const CAIRN_FUEL_MEALS = {
    listHtml,
    mealHtml,
    headMainHtml,
    numsHtml,
    fixFormHtml,
    FIX_FIELDS,
    emptyHtml,
    errorHtml,
  };

  Object.assign(globalThis, { CairnFuelMeals: CAIRN_FUEL_MEALS });
}
