// @ts-check
// Fuel — the day's logged meals, the controller (docs/V2-PLAN.md wave 2).
// `mount(host, deps)` paints the day's meals (GET /api/nutrition/day, the same SWR key
// fuel-today reads) and keeps them current by id: a re-read moves, updates, adds and
// removes rows without repainting the list, so a meal card open mid-edit keeps its
// node, its focus and its unsaved grams. Opening a meal mounts the meal card
// (CairnMealCardController) into its panel: a row's grams are corrected there with
// one PUT and the head follows the card's live totals. A meal with no items to
// adjust opens into the totals correction instead (what it was, its slot, its
// numbers), also one PUT. Remove deletes the note after a second tap. A
// still-estimating meal is watched until it settles; a watch that gives up (the poll
// fallback caps out) re-reads and watches again, a bounded number of times.
{
  type Deps = ClientFuelMealsDeps;
  type Meal = ClientFuelMeal;

  /** How many times one still-estimating meal is watched before the surface rests. */
  const MAX_WATCH_ROUNDS = 6;

  function isDay(value: unknown): boolean {
    return !!value && typeof value === "object" && Array.isArray((value as { entries?: unknown }).entries);
  }

  function fromHtml(html: string): HTMLElement | null {
    const box = document.createElement("ul");
    box.innerHTML = html;
    return box.firstElementChild as HTMLElement | null;
  }

  function mountFuelMeals(host: Element, deps: Deps): ClientFuelRefreshHandle {
    const key = CairnFuelTodayController.dayKey(deps.date);
    const path = `/nutrition/day?date=${encodeURIComponent(deps.date)}`;
    const isToday = deps.date === deps.today;
    let generation = 0;
    let loaded = false;
    let current: Meal[] = [];
    // id -> what the row last printed, and id -> its mounted meal card's teardown.
    const sigs = new Map<number, string>();
    const cards = new Map<number, () => void>();
    const watched = new Set<number>();
    const rounds = new Map<number, number>();

    const live = (gen: number): boolean => gen === generation && host.isConnected;
    const rowEl = (id: number): HTMLElement | null =>
      Array.from(host.querySelectorAll<HTMLElement>("[data-fuel-meal]")).find(
        (el) => Number(el.dataset.fuelMeal) === id && !el.hasAttribute("data-fuel-meal-leaving")
      ) ?? null;
    const list = (): Element | null => host.querySelector(".fuel-meals-list");

    function dropCard(id: number): void {
      cards.get(id)?.();
      cards.delete(id);
    }

    function paintAll(meals: readonly Meal[]): void {
      for (const id of [...cards.keys()]) dropCard(id);
      sigs.clear();
      host.innerHTML = meals.length ? CairnFuelMeals.listHtml(meals, { isToday }) : CairnFuelMeals.emptyHtml(isToday);
      for (const meal of meals) sigs.set(meal.id, meal.sig);
    }

    function leave(el: HTMLElement, id: number): void {
      el.setAttribute("data-fuel-meal-leaving", "1");
      dropCard(id);
      sigs.delete(id);
      const done = (): void => {
        el.remove();
        // The last meal gone: the list gives way to the day's own empty state.
        if (!host.querySelector("[data-fuel-meal]:not([data-fuel-meal-leaving])")) paintAll([]);
      };
      if (deps.collapseEl && !deps.reducedMotion()) deps.collapseEl(el, done);
      else done();
    }

    // Update an open row in place: the head reprints and the panel stays, so a card
    // mid-edit keeps its node. A panel with no card yet (the meal was still being
    // estimated) reprints, and gets its card if the meal is now editable.
    function refreshOpen(el: HTMLElement, meal: Meal): void {
      const fresh = fromHtml(CairnFuelMeals.mealHtml(meal));
      const main = el.querySelector(".fuel-meal-main");
      if (main) main.innerHTML = CairnFuelMeals.headMainHtml(meal);
      const nums = el.querySelector(".fuel-meal-nums");
      const freshNums = fresh?.querySelector(".fuel-meal-nums");
      if (nums && freshNums) nums.replaceWith(freshNums);
      if (cards.has(meal.id)) return;
      const panel = el.querySelector(".fuel-meal-panel-in");
      const freshPanel = fresh?.querySelector(".fuel-meal-panel-in");
      if (panel && freshPanel) panel.innerHTML = freshPanel.innerHTML;
      mountCard(el, meal);
    }

    function reconcile(meals: readonly Meal[]): void {
      const root = list();
      if (!root || !meals.length) {
        paintAll(meals);
        return;
      }
      const ids = new Set(meals.map((meal) => meal.id));
      for (const el of Array.from(host.querySelectorAll<HTMLElement>("[data-fuel-meal]"))) {
        const id = Number(el.dataset.fuelMeal);
        if (!el.hasAttribute("data-fuel-meal-leaving") && !ids.has(id)) leave(el, id);
      }
      let prev: Element | null = null;
      for (const meal of meals) {
        let el: HTMLElement | null = rowEl(meal.id);
        if (el && sigs.get(meal.id) !== meal.sig) {
          if (el.classList.contains("is-open")) refreshOpen(el, meal);
          else {
            const fresh = fromHtml(CairnFuelMeals.mealHtml(meal));
            dropCard(meal.id);
            if (fresh) el.replaceWith(fresh);
            el = fresh;
          }
        } else if (!el) {
          el = fromHtml(CairnFuelMeals.mealHtml(meal, { enter: !deps.reducedMotion() }));
        }
        sigs.set(meal.id, meal.sig);
        if (!el) continue;
        const staying: Element[] = Array.from(root.children).filter(
          (kid) => !kid.hasAttribute("data-fuel-meal-leaving")
        );
        const want: number = prev ? staying.indexOf(prev) + 1 : 0;
        if (staying[want] !== el) root.insertBefore(el, staying[want] ?? null);
        prev = el;
      }
    }

    function watchPending(meals: readonly Meal[]): void {
      if (!deps.watchEnrichment) return;
      for (const meal of meals) {
        if (!meal.pending || watched.has(meal.id)) continue;
        const round = rounds.get(meal.id) ?? 0;
        if (round >= MAX_WATCH_ROUNDS) continue;
        rounds.set(meal.id, round + 1);
        watched.add(meal.id);
        // Settled or given up, the watch is over: re-read, and a meal still
        // estimating is watched again on that paint.
        deps.watchEnrichment(meal.id, () => {
          watched.delete(meal.id);
          if (!host.isConnected) return;
          void refresh();
          deps.onChanged?.();
        });
      }
    }

    function paint(day: unknown): void {
      const meals = CairnFuelTodayModel.mealModels(day);
      current = meals;
      if (!loaded) paintAll(meals);
      else reconcile(meals);
      loaded = true;
      watchPending(meals);
    }

    function load(): Promise<void> {
      const gen = ++generation;
      const warm = deps.peekCached<unknown>(key);
      if (warm && isDay(warm.data)) paint(warm.data);
      return deps
        .cachedApi(path, { key })
        .then((data) => {
          if (live(gen) && isDay(data)) paint(data);
        })
        .catch(() => {
          if (live(gen) && !loaded) host.innerHTML = CairnFuelMeals.errorHtml();
        });
    }

    function refresh(): Promise<void> {
      deps.swrInvalidate(key);
      return load();
    }

    function mealFor(id: number): Meal | null {
      return current.find((meal) => meal.id === id) ?? null;
    }

    function mountCard(el: HTMLElement, meal: Meal): void {
      const slot = el.querySelector("[data-fuel-meal-card]");
      if (!slot || cards.has(meal.id) || !meal.editable) return;
      const nums = (): Element | null => el.querySelector(".fuel-meal-nums");
      cards.set(
        meal.id,
        CairnMealCardController.mount(slot, {
          note: meal.note,
          api: deps.api,
          toast: deps.toast,
          expandEl: deps.expandEl,
          collapseEl: deps.collapseEl,
          reducedMotion: deps.reducedMotion,
          // The head follows the card: a preview while editing, the server's once saved.
          onTotals: (totals) => {
            const target = nums();
            if (target) target.textContent = CairnFuelTodayModel.mealNumsText(totals) || "not estimated";
          },
          onSaved: () => {
            deps.swrInvalidate(key);
            deps.onChanged?.();
          },
        })
      );
    }

    function toggle(btn: HTMLElement): void {
      const el = btn.closest<HTMLElement>("[data-fuel-meal]");
      if (!el) return;
      const open = !el.classList.contains("is-open");
      el.classList.toggle("is-open", open);
      btn.setAttribute("aria-expanded", String(open));
      if (!open) return;
      const meal = mealFor(Number(el.dataset.fuelMeal));
      if (meal) mountCard(el, meal);
    }

    function fixBody(form: Element): Record<string, unknown> | null {
      const field = (name: string): HTMLInputElement | HTMLSelectElement | null =>
        form.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-fuel-meal-fix-field="${name}"]`);
      const body: Record<string, unknown> = {};
      const summary = String(field("summary")?.value ?? "").trim();
      if (summary) body.summary = summary;
      const slot = String(field("meal")?.value ?? "").trim();
      if (slot) body.meal = slot;
      for (const [key] of CairnFuelMeals.FIX_FIELDS) {
        const text = String(field(key)?.value ?? "").trim();
        if (!text) {
          body[key] = null; // blank is unknown, never a zero
          continue;
        }
        const n = Number(text);
        if (!Number.isFinite(n) || n < 0) return null;
        body[key] = n;
      }
      return body;
    }

    async function fix(btn: HTMLElement): Promise<void> {
      const el = btn.closest<HTMLElement>("[data-fuel-meal]");
      const id = Number(el?.dataset.fuelMeal);
      const form = el?.querySelector("[data-fuel-meal-fix]");
      if (!el || !id || !form || btn.hasAttribute("aria-busy")) return;
      const body = fixBody(form);
      if (!body) {
        deps.toast("Numbers only, and none below zero");
        return;
      }
      btn.setAttribute("aria-busy", "true");
      (btn as HTMLButtonElement).disabled = true;
      let result: unknown;
      try {
        result = await deps.api(`/food-notes/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } catch {
        result = null;
      }
      btn.removeAttribute("aria-busy");
      (btn as HTMLButtonElement).disabled = false;
      const r = result && typeof result === "object" ? (result as { error?: unknown }) : null;
      if (!r || r.error) {
        deps.toast("Couldn't save that meal");
        return;
      }
      deps.toast("Saved");
      await refresh();
      deps.onChanged?.();
    }

    async function remove(btn: HTMLElement): Promise<void> {
      const el = btn.closest<HTMLElement>("[data-fuel-meal]");
      const id = Number(el?.dataset.fuelMeal);
      if (!el || !id) return;
      const confirm = async (): Promise<void> => {
        let result: unknown;
        try {
          result = await deps.api(`/food-notes/${id}`, { method: "DELETE" });
        } catch {
          result = null;
        }
        const r = result && typeof result === "object" ? (result as { ok?: unknown; error?: unknown }) : null;
        if (!r || r.ok === false || r.error) {
          deps.toast("Couldn't remove that meal");
          return;
        }
        if (el.isConnected) leave(el, id);
        deps.toast("Removed");
        deps.swrInvalidate(key);
        deps.onChanged?.();
      };
      if (deps.armDelete) deps.armDelete(btn, confirm, { label: "Remove it?" });
      else await confirm();
    }

    const teardown = CairnUiActions.mount(host, "fuel-meals", ({ delegate }) => {
      delegate("click", {
        "fuel-meals-toggle": (el) => toggle(el),
        "fuel-meals-remove": (el) => remove(el),
        "fuel-meals-fix": (el) => fix(el),
      });
      void load();
      return () => {
        generation++;
        for (const id of [...cards.keys()]) dropCard(id);
      };
    });
    return Object.assign(teardown, { refresh });
  }

  const CAIRN_FUEL_MEALS_CONTROLLER = {
    mount: mountFuelMeals,
  };

  Object.assign(globalThis, { CairnFuelMealsController: CAIRN_FUEL_MEALS_CONTROLLER });
}
