// @ts-check
// The meal card's controller (docs/V2-PLAN.md wave 2, stream B). `mountMealCard(host,
// deps)` paints a logged meal into `host` as editable rows and wires them through
// one delegated listener per event type (CairnUiActions.mount, so mounting again on
// the same host never doubles a save).
//
// Editing a row's grams moves the totals at once — the stored total shifted by what
// the edit changed — and Save sends every row, in the foodCapture.ts ingredient
// shape, as ONE `PUT /api/food-notes/:id` with body `{ingredients: [...]}`. The server
// recomputes the note's totals from those rows and the card then prints the totals
// the response carries, so the server's numbers always win. A failed save keeps
// every edit in place and says so; nothing is lost and nothing is retried behind the
// athlete's back.
{
  type Row = ClientMealCardRow;
  type Totals = ClientMealCardTotals;
  type Deps = ClientMealCardDeps;

  const model = (): CairnMealCardModelApi => CairnMealCardModel;
  const view = (): Window["CairnMealCard"] => CairnMealCard;

  const COPY = {
    saving: "Saving…",
    saved: "Saved",
    failed: "Not saved — your changes are still here.",
    toastFailed: "Couldn't save that meal",
  };

  function copyRow(row: Row): Row {
    return { ...row, base: { ...row.base } };
  }

  /** The rows as they now stand on the server: each one's weight and estimate become its base. */
  function rebase(rows: readonly Row[]): Row[] {
    return rows.map((row) => ({
      ...row,
      amount: row.grams != null && row.grams !== row.baseGrams ? `${model().formatGrams(row.grams)} g` : row.amount,
      baseGrams: row.grams,
      base: model().rowMacros(row),
      added: false,
      edited: false,
    }));
  }

  function responseError(result: unknown): string | null {
    if (!result || typeof result !== "object") return COPY.failed;
    const r = result as { ok?: unknown; error?: unknown };
    if (r.ok === false || r.error) return typeof r.error === "string" && r.error.trim() ? r.error.trim() : COPY.failed;
    return null;
  }

  function mountMealCard(host: Element, deps: Deps): () => void {
    const first = model().mealCardModel(deps.note);
    const id = first.id;
    const mealBasis = first.basis;
    let stored: Totals = first.totals;
    let original: Row[] = first.rows.map(copyRow);
    let rows: Row[] = first.rows.map(copyRow);
    let revision = 0;
    let busy = false;
    let added = 0;
    let alive = true;

    const q = <T extends Element = HTMLElement>(selector: string): T | null => host.querySelector<T>(selector);
    const rowByKey = (key: string | undefined): Row | undefined => rows.find((row) => row.key === key);
    const rowKeyOf = (el: Element): string | undefined =>
      el.closest<HTMLElement>("[data-meal-card-row]")?.dataset.mealCardRow;

    function paint(): void {
      host.innerHTML = view().mealCardHtml(
        { id, rows, totals: stored, basis: mealBasis, provenance: first.provenance },
        { totals: deps.totals }
      );
    }

    function currentTotals(): Totals {
      return model().optimisticTotals(stored, original, model().savableRows(rows));
    }

    function dirty(): boolean {
      return model().rowsChanged(original, rows);
    }

    function setStatus(text: string): void {
      const status = q(".meal-card-status");
      if (status) status.textContent = text;
    }

    /** Totals, Save and the single-row guard, from the current rows. No markup is rebuilt. */
    function sync(opts: { saved?: boolean } = {}): void {
      const totals = opts.saved ? stored : currentTotals();
      const changed = dirty();
      const line = q(".meal-card-totals");
      if (line) {
        const text = view().totalsText(totals);
        line.textContent = text;
        line.hidden = !text;
        line.classList.toggle("is-unsaved", changed);
      }
      const save = q<HTMLButtonElement>("[data-meal-card-save]");
      if (save) save.disabled = busy || !changed;
      q(".meal-card-rows")?.classList.toggle("is-single", rows.length === 1);
      deps.onTotals?.(totals, { saved: !!opts.saved, unsaved: changed });
    }

    function paintRowNutri(row: Row): void {
      const nutri = host.querySelector(`[data-meal-card-row="${row.key}"] .meal-card-nutri`);
      if (nutri) nutri.textContent = view().rowNutriText(row);
    }

    function onGrams(input: HTMLElement): void {
      const row = rowByKey(rowKeyOf(input));
      if (!row) return;
      const raw = (input as HTMLInputElement).value;
      const grams = model().parseGramsInput(raw);
      const blank = raw.trim() === "";
      input.toggleAttribute("aria-invalid", !blank && grams == null);
      // A cleared field means "as logged", never zero grams.
      const next = grams ?? (blank ? row.baseGrams : row.grams);
      if (next === row.grams) return;
      row.grams = next;
      row.edited = next !== row.baseGrams;
      revision++;
      paintRowNutri(row);
      setStatus("");
      sync();
    }

    function onName(input: HTMLElement): void {
      const row = rowByKey(rowKeyOf(input));
      if (!row) return;
      row.item = (input as HTMLInputElement).value.trim().slice(0, 80);
      revision++;
      setStatus("");
      sync();
    }

    function onAdd(): void {
      added += 1;
      const row: Row = {
        key: `n${added}`,
        item: "",
        amount: "",
        baseGrams: null,
        grams: null,
        base: { kcal: null, protein_g: null, carbs_g: null, fat_g: null, fiber_g: null },
        basis: null,
        added: true,
        edited: false,
      };
      rows.push(row);
      revision++;
      const list = q(".meal-card-rows");
      if (!list) return;
      list.insertAdjacentHTML("beforeend", view().rowHtml(row, { mealBasis }));
      const li = host.querySelector<HTMLElement>(`[data-meal-card-row="${row.key}"]`);
      if (li && !deps.reducedMotion?.()) {
        // Start from a closed box so expandEl eases it open (docs/DESIGN.md "Height changes").
        li.style.height = "0px";
        li.style.opacity = "0";
        li.style.overflow = "hidden";
        li.style.transition = "height var(--dur-2) var(--ease),opacity var(--dur-1) var(--ease)";
        deps.expandEl?.(li);
      }
      li?.querySelector<HTMLInputElement>("[data-meal-card-name]")?.focus();
      sync();
    }

    function onRemove(button: HTMLElement): void {
      const key = rowKeyOf(button);
      if (!key || rows.length <= 1) return;
      rows = rows.filter((row) => row.key !== key);
      revision++;
      const li = host.querySelector<HTMLElement>(`[data-meal-card-row="${key}"]`);
      q<HTMLButtonElement>("[data-meal-card-add]")?.focus();
      if (li) {
        li.removeAttribute("data-meal-card-row");
        if (deps.collapseEl) deps.collapseEl(li, () => li.remove());
        else li.remove();
      }
      setStatus("");
      sync();
    }

    async function onSave(): Promise<void> {
      if (busy || id == null || !dirty()) return;
      busy = true;
      const startedAt = revision;
      const sent = model().savableRows(rows).map(copyRow);
      const save = q<HTMLButtonElement>("[data-meal-card-save]");
      if (save) {
        save.disabled = true;
        save.setAttribute("aria-busy", "true");
      }
      setStatus(COPY.saving);
      let result: unknown;
      let error: string | null = null;
      try {
        result = await deps.api(`/food-notes/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ingredients: sent.map(model().rowBody) }),
        });
        error = responseError(result);
      } catch {
        error = COPY.failed;
      }
      busy = false;
      if (!alive || !host.isConnected) return;
      q("[data-meal-card-save]")?.removeAttribute("aria-busy");
      if (error) {
        setStatus(error);
        if (error === COPY.failed) deps.toast?.(COPY.toastFailed);
        sync();
        return;
      }
      const next = model().mealCardModel(result);
      stored = next.totals;
      if (revision === startedAt && next.rows.length) {
        // Nothing moved while the save was in flight: print the rows as the server
        // now holds them.
        original = next.rows.map(copyRow);
        rows = next.rows.map(copyRow);
        paint();
      } else {
        // The athlete kept typing: keep their newer edits and measure them from
        // what was just saved.
        original = rebase(sent);
      }
      setStatus(COPY.saved);
      sync({ saved: !dirty() });
      const line = q(".meal-card-totals");
      if (line && !deps.reducedMotion?.()) {
        line.classList.remove("is-settled");
        void (line as HTMLElement).offsetWidth;
        line.classList.add("is-settled");
      }
      deps.onSaved?.(result);
    }

    paint();
    sync({ saved: true });

    const teardown = CairnUiActions.mount(host, "meal-card", ({ delegate }) => {
      delegate("input", {
        "meal-card-grams": (el) => onGrams(el),
        "meal-card-name": (el) => onName(el),
      });
      delegate("click", {
        "meal-card-add": () => onAdd(),
        "meal-card-remove": (el) => onRemove(el),
        "meal-card-save": () => void onSave(),
      });
      delegate("keydown", {
        "meal-card-grams": (_el, event) => {
          if ((event as KeyboardEvent).key === "Enter") void onSave();
        },
        "meal-card-name": (_el, event) => {
          if ((event as KeyboardEvent).key === "Enter") void onSave();
        },
      });
      return () => {
        alive = false;
      };
    });
    return teardown;
  }

  const CAIRN_MEAL_CARD_CONTROLLER = {
    mount: mountMealCard,
  };

  Object.assign(globalThis, { CairnMealCardController: CAIRN_MEAL_CARD_CONTROLLER });
}
