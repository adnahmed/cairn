// @ts-check
// The race page's runs, the view: this week's runs by weekday for the THIS WEEK card —
// the ones in (what was run first, the plan — or "Extra" — second), the next
// in full (setup / expect / sits-by through the reading-grammar rows), the rest as rows
// — and next week as its own section. Pure strings over
// CairnPlanEnduranceModel.buildBriefing's output and CairnRaceWeekModel.weekRuns.
{
  function planEnduranceKindClass(kind: unknown): string {
    if (kind === "quality") return "wrun-quality";
    if (kind === "long") return "wrun-long";
    if (kind === "extra") return "wrun-extra";
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

  const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

  function planEnduranceWeekday(session: PlanEnduranceBriefingSession): string {
    // "Today · Tuesday" → "Today"; a dated run → "Tue 6" (short enough for the day
    // column at 390px, and the date a person says); else the weekday alone.
    const when = String(session.when || "");
    if (when.startsWith("Today")) return "Today";
    if (when.startsWith("Tomorrow")) return "Tomorrow";
    const key = String(session.date || "").slice(0, 10);
    const d = /^\d{4}-\d{2}-\d{2}$/.test(key) ? new Date(`${key}T00:00:00Z`) : null;
    if (d && Number.isFinite(d.getTime())) return `${WEEKDAY_SHORT[d.getUTCDay()]} ${d.getUTCDate()}`;
    return when.split(" · ")[0];
  }

  function planEnduranceRunRow(session: PlanEnduranceBriefingSession, cls: string, detail = ""): string {
    return `<li class="race-run ${planEnduranceKindClass(session.kind)} ${cls}">
      <div class="race-run-row">
        <span class="race-run-when">${escHtml(planEnduranceWeekday(session))}</span>
        <span class="race-run-name">${escHtml(session.label)}</span>
        ${session.prescription ? `<span class="race-run-pres">${escHtml(session.prescription)}</span>` : ""}
      </div>${detail}
    </li>`;
  }

  /**
   * A run already in, what was run first: "9.7 km · 5:34/km · easy" on every row, an
   * extra included, then a quiet second line — the plan ("planned: long 10.7 km ·
   * shortened to 8 km this morning"), or for an extra "Extra · Hill Sprints". No bare
   * tick: a run that differs from its plan says so in words.
   */
  function planEnduranceActualRow(run: ClientRaceWeekRun): string {
    const kind = run.extra ? "" : planEnduranceKindClass(run.tone);
    const actual = run.actual_text;
    const second = run.extra
      ? ["Extra", run.title].filter(Boolean).join(" · ")
      : [run.planned_text, run.adjust_text].filter(Boolean).join(" · ");
    return `<li class="race-run is-done${run.extra ? " wrun-extra is-extra" : ` ${kind}`}">
      <div class="race-run-row">
        <span class="race-run-when">${escHtml(run.when)}</span>
        <span class="race-run-name">${escHtml(actual || "Run")}</span>
      </div>${second ? `<p class="race-run-plan">${escHtml(second)}</p>` : ""}
    </li>`;
  }

  /** An older payload's run in: the intent's words and what was run, never a bare tick. */
  function planEnduranceDoneRow(session: PlanEnduranceBriefingSession): string {
    return planEnduranceRunRow(session, "is-done");
  }

  /** The next run in full: this morning's call, setup, what to expect, what it sits by. */
  function planEnduranceNextDetail(next: PlanEnduranceBriefingSession): string {
    return `<div class="read-contribs race-run-detail">
          ${next.morning ? planEnduranceContrib("This morning", next.morning, "quiet") : ""}
          ${planEnduranceContrib("Setup", next.setup, "quiet")}
          ${planEnduranceContrib("Expect", next.expect, "quiet")}
          ${planEnduranceContrib("Sits by", next.sitsBy, "quiet")}
        </div>`;
  }

  function planEnduranceMonday(iso: string | null | undefined): string {
    return iso ? CairnPlanEnduranceModel.mondayOf(iso) : "";
  }

  /** Every open run the briefing holds, in date order: the next, then the rest. */
  function planEnduranceOpen(briefing: PlanEnduranceBriefing): PlanEnduranceBriefingSession[] {
    const rest = [...(briefing.remaining || []), ...(briefing.later || [])];
    return [briefing.next, ...rest].filter((session): session is PlanEnduranceBriefingSession => !!session);
  }

  /** The Monday of "this week": the page's today, else (no today handed in) the next run's week. */
  function planEnduranceThisMonday(briefing: PlanEnduranceBriefing, today?: string): string {
    if (today) return planEnduranceMonday(today);
    return briefing.horizon === "this_week" ? planEnduranceMonday(briefing.next?.date ?? null) : "";
  }

  /**
   * This week's runs by weekday, for the race page's THIS WEEK card: the runs already in
   * (`opts.runs`, what was run first and the plan second; an older page passes none and
   * the briefing's own completed intents stand in), then this week's open runs (the
   * week of `opts.today`), the next one in full. Next week is `nextWeekHtml`'s, its own section. "" with no runs at all.
   */
  function planEnduranceSessionsHtml(
    value: unknown,
    opts: { runs?: ClientRaceWeekRun[] | null; today?: string } = {}
  ): string {
    const briefing = value as PlanEnduranceBriefing | null;
    if (!briefing) return "";
    const monday = planEnduranceThisMonday(briefing, opts.today);
    const open = planEnduranceOpen(briefing).filter(
      (session) => !session.date || (!!monday && planEnduranceMonday(session.date) === monday)
    );
    const doneRows = Array.isArray(opts.runs)
      ? opts.runs.map(planEnduranceActualRow)
      : (Array.isArray(briefing.done) ? briefing.done : []).map(planEnduranceDoneRow);
    if (!doneRows.length && !open.length) return "";
    const rows = [
      ...doneRows,
      ...open.map((session) =>
        session === briefing.next
          ? planEnduranceRunRow(session, "is-next", planEnduranceNextDetail(session))
          : planEnduranceRunRow(session, "is-ahead")
      ),
    ].join("");
    return `<ol class="race-runs" aria-label="This week's runs">${rows}</ol>`;
  }

  /**
   * Next week, its own compact section after the THIS WEEK card: its runs by date
   * ("Tue 6 · Thu 8 · Sun 11"), the detail only on the first upcoming run (and only
   * when that run is next week's), and the week's planned volume when the page has it.
   * "" with nothing planned next week.
   */
  function planEnduranceNextWeekHtml(value: unknown, opts: { figure?: string; today?: string } = {}): string {
    const briefing = value as PlanEnduranceBriefing | null;
    if (!briefing) return "";
    const thisMonday = planEnduranceThisMonday(briefing, opts.today);
    const nextMonday = thisMonday
      ? CairnPlanEnduranceModel.nextMonday(thisMonday)
      : briefing.horizon === "next_week"
        ? planEnduranceMonday(briefing.next?.date ?? null)
        : "";
    if (!nextMonday) return "";
    const sessions = planEnduranceOpen(briefing).filter(
      (session) => !!session.date && planEnduranceMonday(session.date) === nextMonday
    );
    if (!sessions.length) return "";
    const rows = sessions
      .map((session) =>
        session === briefing.next
          ? planEnduranceRunRow(session, "is-next", planEnduranceNextDetail(session))
          : planEnduranceRunRow(session, "is-ahead")
      )
      .join("");
    const figure = opts.figure ? `<span class="race-next-km">${escHtml(opts.figure)}</span>` : "";
    return `<section class="race-section race-next" aria-labelledby="raceNextTitle">
      <div class="race-next-head"><span class="lbl" id="raceNextTitle">Next week</span>${figure}</div>
      <ol class="race-runs" aria-label="Next week's runs">${rows}</ol>
    </section>`;
  }

  const CAIRN_PLAN_ENDURANCE_BRIEFING = {
    sessionsHtml: planEnduranceSessionsHtml,
    nextWeekHtml: planEnduranceNextWeekHtml,
  };

  Object.assign(globalThis, { CairnPlanEnduranceBriefing: CAIRN_PLAN_ENDURANCE_BRIEFING });
}
