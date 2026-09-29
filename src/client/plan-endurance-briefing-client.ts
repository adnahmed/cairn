// @ts-check
// The race page's runs, the view: this week's runs by weekday for the THIS WEEK card —
// the ones in (ticked), the next in full (setup / expect / sits-by through the
// reading-grammar rows), the rest as rows. Pure strings over
// CairnPlanEnduranceModel.buildBriefing's output.
{
  function planEnduranceKindClass(kind: unknown): string {
    if (kind === "quality") return "wrun-quality";
    if (kind === "long") return "wrun-long";
    return "wrun-easy";
  }

  function planEnduranceContrib(label: string, state: string, tone: "ok" | "watch" | "quiet"): string {
    // A row with nothing to say is not drawn (a rested run has no setup or neighbours).
    if (!state.trim()) return "";
    const t = tone === "ok" || tone === "watch" ? tone : "quiet";
    const labelHtml = label.trim() ? `<span class="read-contrib-label">${escHtml(label)}</span>` : "";
    const stateHtml = state.trim() ? `<span class="read-contrib-state">${escHtml(state)}</span>` : "";
    return `<div class="read-contrib"><span class="read-contrib-pip ${t}" aria-hidden="true"></span>${labelHtml}${stateHtml}</div>`;
  }

  function planEnduranceWeekday(session: PlanEnduranceBriefingSession): string {
    // "Today · Tuesday" → "Today"; "Next Thursday" stays; "Thursday · Oct 8" → "Thursday".
    const when = String(session.when || "");
    if (when.startsWith("Today")) return "Today";
    if (when.startsWith("Tomorrow")) return "Tomorrow";
    return when.split(" · ")[0];
  }

  function planEnduranceRunRow(session: PlanEnduranceBriefingSession, cls: string, detail = ""): string {
    const done = session.status === "completed";
    const tick = done ? `<span class="race-run-tick" aria-label="done">✓</span>` : "";
    return `<li class="race-run ${planEnduranceKindClass(session.kind)} ${cls}">
      <div class="race-run-row">
        <span class="race-run-when">${escHtml(planEnduranceWeekday(session))}</span>
        <span class="race-run-name">${escHtml(session.label)}${tick}</span>
        ${session.prescription ? `<span class="race-run-pres">${escHtml(session.prescription)}</span>` : ""}
      </div>${detail}
    </li>`;
  }

  /**
   * This week's runs by weekday, for the race page's THIS WEEK card: the runs already in
   * (ticked, with what was run), the next one in full (this morning's call, setup, what
   * to expect, what it sits beside), then the rest as rows. When this week is all in,
   * the next week's runs follow under their own quiet mark. "" with no runs at all.
   */
  function planEnduranceSessionsHtml(value: unknown): string {
    const briefing = value as PlanEnduranceBriefing | null;
    if (!briefing) return "";
    const done = Array.isArray(briefing.done) ? briefing.done : [];
    const next = briefing.next;
    // Only the next run's own week: the rest of the build is the ladder's to show.
    const mondayOf = (iso: string | null): string => (iso ? CairnPlanEnduranceModel.mondayOf(iso) : "");
    const week = mondayOf(next?.date ?? null);
    const rest = (briefing.remaining || []).filter(
      (session) => !week || !session.date || mondayOf(session.date) === week
    );
    if (!done.length && !next && !rest.length) return "";
    const ahead = briefing.horizon !== "this_week";
    const nextDetail = next
      ? `<div class="read-contribs race-run-detail">
          ${next.morning ? planEnduranceContrib("This morning", next.morning, "quiet") : ""}
          ${planEnduranceContrib("Setup", next.setup, "quiet")}
          ${planEnduranceContrib("Expect", next.expect, "quiet")}
          ${planEnduranceContrib("Sits by", next.sitsBy, "quiet")}
        </div>`
      : "";
    const rows = [
      ...done.map((session) => planEnduranceRunRow(session, "is-done")),
      ahead && next ? `<li class="race-run-mark"><span class="lbl">${escHtml(briefing.kicker)}</span></li>` : "",
      next ? planEnduranceRunRow(next, "is-next", nextDetail) : "",
      ...rest.map((session) => planEnduranceRunRow(session, "is-ahead")),
    ].join("");
    return `<ol class="race-runs" aria-label="This week's runs">${rows}</ol>`;
  }

  const CAIRN_PLAN_ENDURANCE_BRIEFING = {
    sessionsHtml: planEnduranceSessionsHtml,
  };

  Object.assign(globalThis, { CairnPlanEnduranceBriefing: CAIRN_PLAN_ENDURANCE_BRIEFING });
}
