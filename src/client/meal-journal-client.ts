// @ts-check
// The meal-plan journal inside Fuel's history fold (lazy "meals" bundle): the current
// plan, its earlier weeks, and the Hold/Undo on a meal decision. Fuel paints the fold
// eagerly (coach-meals-screen.ts) and reaches this through withBundle("meals").

type MealJournalPeek = SwrPeek<import("../contracts/client-api.js").ClientMealPlan[]> | null;

(() => {
  // Hold (a change still waiting) and Undo (one that landed) both go through the
  // durable decision rollback. A later accepted plan intentionally wins over an
  // older rollback: the response confirms the decision was reverted, not that its
  // prior plan became current, so the Undo confirmation stays truthful under that race.
  function wireMealDecisionActions(host: Element): void {
    const after = async (): Promise<void> => {
      swrInvalidate(MEALS_KEY);
      await repaintMealHistory();
    };
    CairnDecisionUndoController.mount(
      host,
      { api, toast },
      {
        "meal-decision-hold": {
          reason: "hold on — keep my current meal plan",
          success: "Held — your current meals stay",
          stale: "That meal change can no longer be held.",
          failed: "Could not hold that meal change",
          after,
        },
        "meal-decision-undo": {
          reason: "undo from the meal plan",
          success: "Undo recorded — showing your current meals",
          stale: "That meal change can no longer be undone.",
          failed: "Could not undo that meal change",
          after,
        },
      },
      "meal-decision"
    );
  }

  function paintMealJournal(token: number, slot: HTMLElement, peek: MealJournalPeek): Promise<unknown> {
    let mealPrefs = String(
      peekCached<import("../contracts/client-api.js").ClientSettingsResponse>(MEALS_SETTINGS_KEY)?.data?.settings
        ?.meal_prefs || ""
    );
    cachedApi("/settings", {
      key: MEALS_SETTINGS_KEY,
      onUpgrade: (data) => {
        mealPrefs = String(data.settings?.meal_prefs || "");
      },
    }).catch(() => {});
    return paintSWR({
      key: MEALS_KEY,
      path: "/mealplans?limit=12",
      peek,
      token,
      tab: "plan",
      render: (plansRes) => {
        if (slot.isConnected) paintMealsBody(slot, plansRes || [], mealPrefs);
      },
    });
  }

  // Build + wire the meal-plan journal from a plans list (+ verbatim meal prefs) into
  // the history slot. Called on a warm peek and again on a changed revalidate; the
  // inner wiring re-queries the freshly written DOM each time.
  function paintMealsBody(slot: HTMLElement, plans: unknown, mealPrefs: string): void {
    const current = CairnMealPlan.currentMealPlan(plans);
    const upcoming = Array.isArray(plans)
      ? plans.find((plan) => {
          const row = plan && typeof plan === "object" ? (plan as Record<string, any>) : {};
          return row.status === "draft" && ["announced", "pending"].includes(String(row.autonomy?.status));
        })
      : null;
    const currentPlan =
      current && (typeof current.id === "string" || typeof current.id === "number")
        ? (current as Record<string, unknown> & { id: string | number })
        : null;
    let shopChecked = new Set<unknown>();
    try {
      if (currentPlan) shopChecked = new Set(JSON.parse(localStorage.getItem(`shop:${currentPlan.id}`) || "[]"));
    } catch {
      /* a ticked shopping list is a convenience */
    }
    const painted = CairnMealPlan.mealPlannerBodyHtml(current, mealPrefs, {
      checkedShopping: shopChecked,
      verified: currentPlan ? CairnMealPlannerController.verifiedForPlan(currentPlan.id) : null,
      upcoming,
    });
    slot.innerHTML = `${painted.html}<h3 class="lbl fuel-history-h">Earlier weeks</h3><div id="mealHist"></div>`;
    runCountUps(slot);
    CairnMealPlannerController.renderMealPlans(plans, "#mealHist", () => repaintMealHistory());
    CairnMealPlannerController.wireMealPlannerBody(currentPlan, painted.context);
    wireMealDecisionActions(slot);
    if (currentPlan) loadMealProvenance();
  }

  const CAIRN_MEAL_JOURNAL: Window["CairnMealJournal"] = { paint: paintMealJournal };

  Object.assign(globalThis, { CairnMealJournal: CAIRN_MEAL_JOURNAL });
})();
