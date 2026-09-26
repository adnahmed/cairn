// @ts-check
// Food note detail modal controller: food-note detail rendering, correction and removal.
// The items are the meal card (meal-card-controller.ts): read-only portions in words
// until Edit opens the gram fields, then corrected in place with one PUT, and the
// sheet's hero follows the card's totals — optimistic while editing, the server's
// once saved.

type FoodDetailControllerRecord = Record<string, unknown>;
type FoodDetailIngredientRow = FoodDetailControllerRecord & {
  item?: string;
  amount?: string;
};
type FoodDetailParsedNote = FoodDetailControllerRecord & {
  summary?: string;
  kcal?: unknown;
  protein_g?: unknown;
  carbs_g?: unknown;
  fat_g?: unknown;
  fiber_g?: unknown;
  notes?: string;
};
type FoodDetailNoteRow = FoodDetailControllerRecord & {
  id?: string | number;
  raw?: string;
  raw_text?: string;
  raw_output?: string;
  created_at?: string;
  eaten_at?: string | null;
};
type FoodDetailFoodNoteApi = {
  foodIngredients(parsed: unknown): FoodDetailIngredientRow[];
  foodItemsText(parsed: unknown): string;
  foodMacroText(row: unknown, options?: { kcal?: boolean; short?: boolean }): string;
  foodTitleFromIngredients(parsed: unknown): string;
  ingredientLabel(row: FoodDetailIngredientRow): string;
  parsedNote(row: FoodDetailNoteRow): FoodDetailParsedNote | null;
  noteEntryInner?(note: FoodDetailControllerRecord): string;
};
type FoodDetailControllerDeps = {
  // `_notesById` is the Me log's note cache (me-health-log-renderer.ts): a saved
  // correction is written back into it so reopening the entry opens the saved meal.
  state: { _goal?: FoodDetailControllerRecord | null; _notesById?: Record<string, unknown> | null };
  api(path: string, opts?: RequestInit & { headers?: Record<string, string> }): Promise<unknown>;
  art(kind: string, ...args: unknown[]): string;
  artEnabled(): boolean;
  artImg(kind: string, query: unknown, className?: string, svg?: string | null): string;
  closeDetail(instant?: boolean): void;
  escapeHtml(value: unknown): string;
  foodNote: FoodDetailFoodNoteApi;
  foodNum(value: unknown): number | null;
  formatFoodNum(value: unknown): string;
  mountDetail(html: string, photoSrc?: string | null): HTMLElement;
  openDetailFrom(fromEl: Element | null | undefined, build: () => unknown): void;
  runCountUps(scope?: ParentNode | null, options?: { snap?: boolean }): void;
  toast(message: string): void;
  wireDetailCommon(): void;
  withToken(path: string): string;
  // The meal card's motion and cache helpers. Optional: the shell's deps factory
  // may pass them, otherwise the shared primitives are used.
  expandEl?(el: Element): void;
  collapseEl?(el: Element, done: () => void): void;
  reducedMotion?(): boolean;
  swrInvalidate?(key: string): void;
};

(() => {
  type Macro = [string, unknown];
  type Totals = ClientMealCardTotals;

  // Bar WIDTHS compare energy contribution (kcal/g: protein 4, carbs 4, fat 9, fiber 2) so fat's
  // denser calories aren't visually underweighted; the "Ng" labels stay grams, the honest unit to read.
  const MACRO_KCAL_PER_G: Record<string, number> = { Protein: 4, Carbs: 4, Fat: 9, Fiber: 2 };

  function foodDetailRecord(value: unknown): FoodDetailControllerRecord {
    return value && typeof value === "object" ? value as FoodDetailControllerRecord : {};
  }

  function foodDetailString(value: unknown, fallback = ""): string {
    return typeof value === "string" ? value : fallback;
  }

  function foodDetailNumber(value: unknown, fallback = 0): number {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function macroList(totals: FoodDetailParsedNote | Totals | null): Macro[] {
    if (!totals) return [];
    const list: Macro[] = [["Protein", totals.protein_g], ["Carbs", totals.carbs_g], ["Fat", totals.fat_g], ["Fiber", totals.fiber_g]];
    return list.filter(([, value]) => value != null && value !== "" && !Number.isNaN(Number(value)));
  }

  function macroBarsHtml(macros: Macro[], deps: FoodDetailControllerDeps): string {
    const macroKcal = ([label, value]: Macro) => Number(value) * (MACRO_KCAL_PER_G[label] ?? 0);
    const maxMacroKcal = Math.max(1, ...macros.map(macroKcal));
    return macros.map(([label, value]) => `
        <div class="macrobar">
          <div class="macrobar-top"><span class="lbl">${label}</span><span class="macrobar-val">${deps.escapeHtml(deps.formatFoodNum(value))}g</span></div>
          <div class="macrobar-track"><div class="macrobar-fill barfill" style="width:${Math.max(3, Math.round((macroKcal([label, value]) / maxMacroKcal) * 100))}%"></div></div>
        </div>`).join("");
  }

  function contextLine(kcal: number, target: number, time: string): string {
    const bits: string[] = [];
    if (kcal && target) bits.push(`${Math.round((kcal / target) * 100)}% of the day`);
    if (time) bits.push(time);
    return bits.join(" · ");
  }

  // The hero's one number format — the count-up's own (ui-feedback-client.ts runCountUps).
  const heroKcal = (kcal: number): string => Math.round(kcal).toLocaleString();

  /**
   * Repaint the sheet's hero from the meal card's totals (no count-up: it is a
   * correction). The numeral is swapped for a fresh node, so an opening count-up
   * still running on the old one stops (it only ticks while its node is connected)
   * and can never land its last frame over the edited total.
   */
  function applyTotals(el: HTMLElement, totals: Totals, target: number, time: string, deps: FoodDetailControllerDeps): void {
    const kcal = totals.kcal ?? 0;
    const kcalEl = el.querySelector<HTMLElement>(".detail-kcal");
    const num = kcalEl?.querySelector<HTMLElement>(".detail-num");
    if (kcalEl && num) {
      kcalEl.hidden = !kcal;
      const fresh = num.cloneNode(false) as HTMLElement;
      fresh.dataset.cu = String(kcal);
      fresh.textContent = heroKcal(kcal);
      num.replaceWith(fresh);
    }
    const ctx = el.querySelector<HTMLElement>(".detail-ctx");
    if (ctx) {
      const line = contextLine(kcal, target, time);
      ctx.textContent = line;
      ctx.hidden = !line;
    }
    const bars = el.querySelector<HTMLElement>(".detail-macros");
    if (bars) {
      const macros = macroList(totals);
      bars.innerHTML = macroBarsHtml(macros, deps);
      bars.hidden = !macros.length;
    }
  }

  function mountMealCard(el: HTMLElement, row: FoodDetailNoteRow, target: number, time: string, deps: FoodDetailControllerDeps): void {
    const host = el.querySelector("[data-fdet-meal]");
    if (!host) return;
    const invalidate = deps.swrInvalidate ?? ((key: string) => swrInvalidate(key));
    // The card reports its stored totals once as it mounts: the hero already shows
    // them (counting up), so only a later change repaints it.
    let opened = false;
    CairnMealCardController.mount(host, {
      note: row,
      api: deps.api,
      toast: deps.toast,
      expandEl: deps.expandEl ?? ((node) => CairnUiMotion.expandEl(node)),
      collapseEl: deps.collapseEl ?? ((node, done) => CairnUiMotion.collapseEl(node, done)),
      reducedMotion: deps.reducedMotion ?? (() => reducedMotion()),
      totals: false,
      onTotals: (totals) => {
        if (!opened) {
          opened = true;
          return;
        }
        applyTotals(el, totals, target, time, deps);
      },
      onSaved: (note) => {
        // The Me log card for this note reprints from the saved row, the log's note
        // cache takes the saved row (so the entry reopens as saved); Fuel and the
        // intake reads refetch.
        const entry = document.querySelector(`.fnent[data-noteid="${row.id}"]`);
        const inner = deps.foodNote.noteEntryInner;
        if (entry && inner && note && typeof note === "object") entry.innerHTML = inner(note as FoodDetailControllerRecord);
        const cache = deps.state._notesById;
        if (cache && note && typeof note === "object") cache[String(row.id)] = note;
        invalidate("progress:energy");
        invalidate("progress:intake");
      },
    });
  }

  async function openFoodDetail(note: unknown, fromTile: Element | null | undefined, deps: FoodDetailControllerDeps): Promise<void> {
    const row = foodDetailRecord(note) as FoodDetailNoteRow;
    const parsed = deps.foodNote.parsedNote(row);
    const text = row.raw || row.raw_text || row.raw_output || "";
    const title = (parsed && parsed.summary) || deps.foodNote.foodTitleFromIngredients(parsed) || text || "Food note";
    const kcal = deps.foodNum(parsed?.kcal) || 0;
    const macros = macroList(parsed);
    // Editable items: the meal card, whenever the note carries ingredient rows.
    const editable = CairnMealCardModel.mealCardRows(row).length > 0 && CairnMealCardModel.mealCardModel(row).id != null;
    const ingredients = deps.foodNote.foodIngredients(parsed);
    const items = editable
      ? ""
      : ingredients.length ? ingredients.map((ingredient) => deps.foodNote.ingredientLabel(ingredient)).join(", ") : deps.foodNote.foodItemsText(parsed);
    // When they said they ate it beats when the row happened to be written — those
    // are the same moment for a meal logged as it happens and hours apart for one
    // remembered later. Both are "HH:MM", so the sheet keeps a single clock register.
    // Neither present simply means this line says nothing; there is no empty slot.
    const time = foodDetailString(row.eaten_at) || foodDetailString(row.created_at).slice(11, 16);

    if (kcal && !deps.state._goal) {
      try {
        deps.state._goal = foodDetailRecord(await deps.api("/goal"));
      } catch {
        deps.state._goal = null;
      }
    }
    const target = foodDetailNumber(foodDetailRecord(deps.state._goal?.recommended).target_intake_kcal);
    const ctx = contextLine(kcal, target, time);

    const query = String(text || title || "Food note");
    const svg = deps.art("food", query);
    const photoSrc = deps.artEnabled() && query
      ? deps.withToken(`/api/art?kind=food&q=${encodeURIComponent(String(query).trim().slice(0, 120))}`)
      : "";

    deps.openDetailFrom(fromTile, () => {
      const el = deps.mountDetail(`
      <div class="detail-art"><div class="detail-art-zoom">${deps.artImg("food", query, "artile-xl", svg)}</div></div>
      <h2 class="detail-title">${deps.escapeHtml(title)}</h2>
      ${items ? `<div class="detail-items">${deps.escapeHtml(items)}</div>` : ""}
      <div class="detail-kcal"${kcal ? "" : " hidden"}><span class="numeral detail-num" data-cu="${kcal}">0</span><span class="detail-unit lbl">cal</span></div>
      <div class="detail-ctx lbl"${ctx ? "" : " hidden"}>${deps.escapeHtml(ctx)}</div>
      <div class="detail-macros"${macros.length ? "" : " hidden"}>${macroBarsHtml(macros, deps)}</div>
      ${editable
        ? `<div class="detail-section fdet-meal" data-fdet-meal></div>`
        : ingredients.length ? `<div class="detail-section"><div class="lbl">Ingredients</div><div class="ing-breakdown">${ingredients.map((ingredient) => `
        <div class="ing-row">
          <div class="ing-main">
            <span>${deps.escapeHtml(ingredient.item)}</span>
            ${ingredient.amount ? `<small>${deps.escapeHtml(ingredient.amount)}</small>` : ""}
          </div>
          <div class="ing-nutri">${deps.escapeHtml(deps.foodNote.foodMacroText(ingredient, { kcal: true, short: true }) || "estimated")}</div>
        </div>`).join("")}</div></div>` : ""}
      ${text && text !== title ? `<div class="detail-section"><div class="lbl">As logged</div><div class="detail-body">“${deps.escapeHtml(text)}”</div></div>` : ""}
      ${parsed?.notes ? `<div class="detail-section"><div class="detail-body fdet-note">${deps.escapeHtml(parsed.notes)}</div></div>` : ""}
      <div class="detail-actions">
        <button class="pillbtn pill-warn" type="button" data-remove>Remove</button>
        <button class="pillbtn" type="button" data-close>Close</button>
      </div>`, photoSrc);
      deps.runCountUps(el);
      deps.wireDetailCommon();
      if (editable) mountMealCard(el, row, target, time, deps);
      el.querySelector("[data-remove]")?.addEventListener("click", async () => {
        try {
          const result = foodDetailRecord(await deps.api(`/food-notes/${row.id}`, { method: "DELETE" }));
          if (result && result.error) throw new Error(String(result.error));
          deps.toast("Removed");
          deps.closeDetail(true);
          document.querySelector(`.fnent[data-noteid="${row.id}"]`)?.remove();
        } catch {
          deps.toast("Couldn't remove");
        }
      });
    });
  }

  const CAIRN_FOOD_DETAIL_CONTROLLER = {
    openFoodDetail,
  };

  Object.assign(globalThis, { CairnFoodDetailController: CAIRN_FOOD_DETAIL_CONTROLLER });

  if (typeof window !== "undefined") {
    window.CairnFoodDetailController = CAIRN_FOOD_DETAIL_CONTROLLER;
  }
})();
