// ==== coach-changes-screen.js ====
// Ask → Changes (lazy ask bundle): the calm asks, the history-first Changes feed with
// Undo, the program and meal-plan histories, and the manual review controls. Entered
// only through the ask bundle (the dispatcher's lazy("ask") and the segment deps'
// withLatestRender), so none of it rides the eager shell. The manual meal refresh
// (runMealPlan) and the meal-plan history paint stay eager in 06-coach-meals.
type CoachAgent = import("../contracts/client-api.js").ClientAgentInfo & { name?: string };
type CoachAgentRecord = Record<string, unknown>;

function isCoachAgentRecord(value: unknown): value is CoachAgentRecord {
  return !!value && typeof value === "object";
}

function coachAgentRows<T extends CoachAgentRecord = CoachAgentRecord>(value: unknown): T[] {
  return Array.isArray(value) ? (value.filter(isCoachAgentRecord) as T[]) : [];
}

function htmlElement<T extends HTMLElement = HTMLElement>(value: Element | null | undefined): T | null {
  return value instanceof HTMLElement ? (value as T) : null;
}

function agentName(agent: CoachAgent): string {
  return typeof agent.name === "string" && agent.name ? agent.name : "agent";
}

// A composition only: the shell paints synchronously, then two components mount into
// their own slots — the calm asks that still need the athlete (ask-card-*.ts) and the
// history-first Changes feed with Undo (changes-feed-*.ts), both in the lazy ask bundle
// (every entry goes through withBundle("ask")). Histories and manual review stay below.
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
      talk: (text) => gotoChatWith(text),
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
      select.innerHTML = coachAgentOptionsHtml(coachAgentRows<CoachAgent>(agents));
      if (chosen && Array.from(select.options).some((o) => o.value === chosen && !o.disabled)) select.value = chosen;
    }),
    api("/proposals?limit=10").then((proposals) => {
      if (current()) CairnCoachProposalController.renderProposals(proposals);
    }),
    api("/mealplans?limit=8").then((plans) => renderCoachMealPlans(plans, current)),
  ]);
}

Object.assign(globalThis, { renderCoach });
