// ==== 06-coach-meals.js ====
type CoachAgent = import("../contracts/client-api.js").ClientAgentInfo & { name?: string };
type CoachMealPlan = import("../contracts/client-api.js").ClientMealPlan;
type CoachMealRecord = Record<string, unknown>;

function isCoachMealRecord(value: unknown): value is CoachMealRecord {
  return !!value && typeof value === "object";
}

function coachMealRows<T extends CoachMealRecord = CoachMealRecord>(value: unknown): T[] {
  return Array.isArray(value) ? (value.filter(isCoachMealRecord) as T[]) : [];
}

function htmlElement<T extends HTMLElement = HTMLElement>(value: Element | null | undefined): T | null {
  return value instanceof HTMLElement ? (value as T) : null;
}

function agentName(agent: CoachAgent): string {
  return typeof agent.name === "string" && agent.name ? agent.name : "agent";
}

// ---------- Changes (Ask → Changes) ----------
// A composition only: the shell paints synchronously, then two components mount into
// their own slots — the calm asks that still need the athlete (ask-card-*.ts) and the
// history-first Changes feed with Undo (changes-feed-*.ts). Both ride the lazy ask
// bundle, so every entry into renderCoach goes through withBundle("ask") (the
// dispatcher and the segment deps). The proposal and meal-plan
// histories and the manual review stay below, as before.
function coachAgentOptionsHtml(agents: CoachAgent[]): string {
  return (
    `<option value="auto">⟳ Auto · rotate enabled agents</option>` +
    agents
      .map(
        (a) =>
          `<option value="${escAttr(agentName(a))}"${a.enabled ? "" : " disabled"}>${escHtml(agentName(a))}${a.enabled ? "" : " (off)"}${a.env_ok ? "" : " · no key"}</option>`
      )
      .join("")
  );
}

function mountCoachChanges(): void {
  const asks = view.querySelector("#changesAsksSlot");
  const feed = view.querySelector("#changesFeedSlot");
  if (asks) CairnAskCardController.mount(asks, { peekCached, cachedApi, gotoChatWith });
  if (feed) {
    CairnChangesFeedController.mount(feed, {
      api,
      toast,
      peekCached,
      cachedApi,
      swrInvalidate,
      reducedMotion,
      markRefreshing,
      collapse: (el, done) => collapseEl(el, done),
      skeleton: () => skelLines(3),
      // Undo stays available at the affected item too; drop what those surfaces
      // cached so they read the server's restored state on their next paint.
      onReverted: () => {
        swrInvalidate("plan");
        swrInvalidate(MEALS_KEY);
      },
    });
  }
}

async function renderCoach(): Promise<void> {
  headerTitle.textContent = "Changes";
  state.planSeg = "coach";
  const token = ++pollToken;
  // Changes lives under Ask (the team), reached from Ask and from Today's
  // changes-line; the back link returns to the conversation.
  view.innerHTML =
    homeBackHtml("ask", "Ask") +
    `
    <p class="changes-lede sess-line">What the team changed, why, and an Undo. Most changes need nothing from you. Talk to the team anytime in <button class="linkbtn linkbtn-plain" id="changesToChat" type="button">Ask</button>.</p>
    <div id="changesAsksSlot" class="changes-asks"></div>
    <h1 class="lbl changes-h">What the team changed</h1>
    <div id="changesFeedSlot" class="changes-feed-slot"></div>
    <details class="changes-fold">
      <summary class="lbl">Program change history</summary>
      <div id="proplist"></div>
    </details>
    <details class="changes-fold">
      <summary class="lbl">Meal-plan change history</summary>
      <div id="meallist"></div>
    </details>
    <details class="changes-manual">
      <summary class="lbl">Manual review</summary>
      <p class="sess-line changes-manual-note">The team reviews your signals automatically. Use these controls only when you want an extra review or want to give a specific direction.</p>
      <div class="field"><label>Agent</label>
        <select id="agentsel">${coachAgentOptionsHtml([])}</select></div>
      <div class="field"><label>Instruction (optional)</label>
        <select id="presetsel">
          <option value="">Review recent sessions and prepare the next useful changes</option>
          <option value="Only adjust lower-body lifts; hold everything else.">Lower body only</option>
          <option value="Be extra conservative; I felt beat up this week.">Extra conservative</option>
          <option value="custom">Custom\u2026</option>
        </select></div>
      <div class="field" id="customwrap" hidden>
        <textarea id="custominstr" rows="3" class="form-textarea" placeholder="e.g. focus on lower body; hold everything else\u2026"></textarea>
      </div>
      <div class="meals-actions">
        <button id="runbtn" class="pillbtn pill-accent">Ask team to review program</button>
      </div>
      <div id="runstatus" class="changes-status"></div>
      <div class="meals-actions">
        <button id="mealbtn" class="pillbtn pill-accent">Ask team to refresh meals</button>
      </div>
      <div id="mealstatus" class="changes-status"></div>
    </details>`;

  wireHomeBack(view);
  mountCoachChanges();
  $("#changesToChat")?.addEventListener("click", () => activateTab("chat"));
  $<HTMLSelectElement>("#presetsel")?.addEventListener("change", (e) => {
    const wrap = htmlElement($("#customwrap"));
    const target = e.target instanceof HTMLSelectElement ? e.target : null;
    if (wrap) wrap.hidden = target?.value !== "custom";
  });
  $("#runbtn")?.addEventListener("click", () => {
    CairnCoachProposalController.runCoachProposal(
      $<HTMLSelectElement>("#agentsel")?.value || "auto",
      instructionValue()
    );
  });
  $("#mealbtn")?.addEventListener("click", runMealPlan);

  // The histories and the agent list fill in behind the painted shell; each checks it
  // is still the screen on view before it writes.
  const current = (): boolean => token === pollToken && Boolean(view.querySelector("#changesFeedSlot"));
  await Promise.allSettled([
    api("/agents").then((agents) => {
      const select = $<HTMLSelectElement>("#agentsel");
      if (!current() || !select) return;
      const chosen = select.value;
      select.innerHTML = coachAgentOptionsHtml(coachMealRows<CoachAgent>(agents));
      if (chosen && Array.from(select.options).some((o) => o.value === chosen && !o.disabled)) select.value = chosen;
    }),
    api("/proposals?limit=10").then((proposals) => {
      if (current()) CairnCoachProposalController.renderProposals(proposals);
    }),
    api("/mealplans?limit=8").then((plans) => {
      if (current()) CairnMealPlannerController.renderMealPlans(plans);
    }),
  ]);
}

function instructionValue(): string {
  const preset = $<HTMLSelectElement>("#presetsel")?.value || "";
  if (preset === "custom") return $<HTMLTextAreaElement>("#custominstr")?.value.trim() || "";
  return preset;
}

// ---------- meal plans ----------
// Planner operations/reconnectors live in /js/meal-planner-controller.js;
// proposal orchestration lives in /js/coach-proposal-controller.js. This screen
// owns only the visible Coach/Plan routing and paint sequence.
function runMealPlan(): void {
  const agent = $<HTMLSelectElement>("#agentsel")?.value || "auto";
  CairnMealPlannerController.runCoachMealPlan(agent, instructionValue());
}

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

// ---------- Plan → Food: the Fuel surface ----------
// Today so far (protein first, energy, fiber — numbers with units, never a score),
// the "Log food" composer, the day's meals as editable meal cards, three ideas from
// the athlete's own staples, and the adaptive energy read. A composition only: the
// shell paints synchronously, then each component mounts into its own slot. Logging
// here never leaves the screen — the composer hands back the rows it logged and the
// slots that read the day refresh. The weekly meal-plan journal is kept as history
// in a fold at the foot (Plan → Meals redirects here with it open).
let fuelTeardowns: Array<() => void> = [];

function mountFuelSurface(token: number, date: string, today: string): void {
  for (const teardown of fuelTeardowns) teardown();
  const slot = (id: string): Element | null => view.querySelector(`#${id}`);
  const deps = CairnFuelDeps;
  const todaySlot = slot("dayFuelSlot");
  const fuelToday = todaySlot ? CairnFuelTodayController.mount(todaySlot, deps.today(date, today)) : null;
  let ideas: ClientFuelRefreshHandle | null = null;
  const afterChange = (): void => {
    swrInvalidate("progress:intake");
    swrInvalidate("progress:energy");
    void fuelToday?.refresh();
    void ideas?.refresh();
  };
  const mealsSlot = slot("fuelMealsSlot");
  const meals = mealsSlot
    ? CairnFuelMealsController.mount(mealsSlot, deps.meals(date, today, token, afterChange))
    : null;
  const logSlot = slot("fuelLogSlot");
  const onLogged = (): void => {
    void meals?.refresh();
    afterChange();
  };
  const log = logSlot ? CairnFuelLogController.mount(logSlot, deps.log(onLogged)) : null;
  const ideasSlot = slot("fuelIdeasSlot");
  ideas = ideasSlot
    ? CairnIdeaCardController.mount(
        ideasSlot,
        deps.ideas(date, (prefill) => log?.open(prefill))
      )
    : null;
  fuelTeardowns = [fuelToday, meals, log, ideas].filter((t): t is NonNullable<typeof t> => !!t);
}

function renderFoodJournal(options: { history?: boolean } = {}): Promise<unknown> {
  headerTitle.textContent = "Fuel";
  state.planSeg = "food";
  const token = ++pollToken;
  const today = localISO();
  const date = state.logDate || today;
  // Logging and ideas are about the rest of TODAY; another day is read and corrected only.
  const isToday = date === today;
  const primed = CairnFuelDeps.firstPaint(date, isToday); // cold: the slots' reads first, then ONE write
  if (!primed) return paintFoodJournal(token, date, today, isToday, options);
  view.innerHTML = `${homeBackHtml("today", "Today")}<section class="meal-energy food-journal fuel" aria-busy="true"><div class="fuel-slot">${CairnFuelToday.skeletonHtml()}</div></section>`;
  wireHomeBack(view);
  return primed.then(() => (token === pollToken && state.tab === "plan" && state.planSeg === "food" ? paintFoodJournal(token, date, today, isToday, options) : undefined));
}

function paintFoodJournal(token: number, date: string, today: string, isToday: boolean, options: { history?: boolean }): Promise<unknown> {
  // Fuel opens from Today (its Fuel card), so it steps back there.
  view.innerHTML =
    homeBackHtml("today", "Today") +
    `<section class="meal-energy food-journal fuel" id="mealEnergy">
      <div id="dayFuelSlot" class="fuel-slot"></div>
      ${isToday ? `<div id="fuelLogSlot" class="fuel-slot"></div>` : ""}
      <div id="fuelMealsSlot" class="fuel-slot"></div>
      ${isToday ? `<div id="fuelIdeasSlot" class="fuel-slot"></div>` : ""}
      <div id="energyCard">${loadingState("Reading your trend…")}</div>
      <div id="energyHero"></div>
      <div id="checkinResult" class="checkin-result"></div>
      <details class="mp-history fuel-history" id="fuelHistory"${options.history ? " open" : ""}>
        <summary class="lbl">Meal-plan history</summary>
        <div id="fuelHistorySlot" class="fuel-history-body"></div>
      </details>
    </section>`;
  wireHomeBack(view);
  mountFuelSurface(token, date, today);
  loadMealsEnergy(token);
  const fold = view.querySelector<HTMLDetailsElement>("#fuelHistory");
  fold?.addEventListener("toggle", () => {
    if (fold.open && !fold.dataset.painted) void paintMealHistory(token);
  });
  if (!options.history) return Promise.resolve();
  fold?.scrollIntoView?.({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
  return paintMealHistory(token);
}

function rerenderFoodSurface(): void {
  renderFoodJournal({ history: !!view.querySelector("#fuelHistory[open]") });
}

// A meal-plan history action (keep, discard, Hold/Undo, a draft that finished, a
// discarded prefs edit) repaints the history fold ALONE. The slots above keep their
// mounts, so a meal card mid-edit keeps its unsaved grams, the Log composer keeps its
// attached photo, and the page stays where the athlete scrolled it. Only when the
// fold is not on view does it fall back to the Plan → Meals navigation.
function repaintMealHistory(): Promise<unknown> {
  swrInvalidate(MEALS_KEY);
  if (!view.querySelector("#fuelHistorySlot")) return Promise.resolve(renderMeals());
  return paintMealHistory(pollToken);
}

// Plan → Meals is no longer a destination: it redirects into Fuel with the meal-plan
// journal open as history, and the URL follows (/app/plan/food).
async function renderMeals(): Promise<unknown> {
  const painted = renderFoodJournal({ history: true });
  if (typeof syncRouteFromState === "function") syncRouteFromState("replace");
  return painted;
}

// The meal-plan journal, as history inside Fuel's fold (render helpers in
// /js/meal-plan-client.js): it paints instantly from a warm peek and upgrades on change. Meal prefs ride along from /settings (peeked,
// revalidated in the background).
function paintMealHistory(token: number): Promise<unknown> {
  const fold = view.querySelector<HTMLElement>("#fuelHistory");
  const slot = view.querySelector<HTMLElement>("#fuelHistorySlot");
  if (!fold || !slot) return Promise.resolve();
  fold.dataset.painted = "1";
  const peek = peekCached<CoachMealPlan[]>(MEALS_KEY);
  if (!peek) slot.innerHTML = skelLines(3);
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

// SWR over the derived expenditure (key shared with the old Energy view), painted
// into whichever nutrition surface owns #energyHero/#energyCard. A warm re-entry
// paints instantly, then revalidates. Bails if the slot's gone.
function loadMealsEnergy(token: number): void {
  if (!view.querySelector("#energyCard")) return;
  const peek = peekCached("progress:energy");
  const paint = (exp: unknown) => {
    if (token !== pollToken || !view.querySelector("#energyCard")) return;
    paintEnergyBody(exp);
  };
  if (peek) {
    paint(peek.data);
    if (!peek.fresh) markRefreshing(true);
  }
  cachedApi("/nutrition/expenditure?window=21", {
    key: "progress:energy",
    onUpgrade: (exp, { changed }) => {
      if (peek && !peek.fresh) markRefreshing(false);
      if (changed || !peek) paint(exp);
    },
  }).catch(() => {
    if (peek && !peek.fresh) markRefreshing(false);
  });
}

Object.assign(globalThis, {
  renderCoach,
  renderFoodJournal,
  renderMeals,
  repaintMealHistory,
  rerenderFoodSurface,
});
