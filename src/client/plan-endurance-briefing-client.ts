// @ts-check
// Plan -> Endurance briefing, the view: the coach's one sentence, the next run in full
// (setup / expect / sits-by through the reading-grammar rows), the next two as compact
// rows, later sessions behind a fold, and the km/mi toggle for distances and paces.
// Pure strings over CairnPlanEnduranceModel.buildBriefing's output.
{
  function planEnduranceKindClass(kind: unknown): string {
    if (kind === "quality") return "wrun-quality";
    if (kind === "long") return "wrun-long";
    return "wrun-easy";
  }

  function planEnduranceContrib(label: string, state: string, tone: "ok" | "watch" | "quiet"): string {
    if (!label.trim() && !state.trim()) return "";
    const t = tone === "ok" || tone === "watch" ? tone : "quiet";
    const labelHtml = label.trim() ? `<span class="read-contrib-label">${escHtml(label)}</span>` : "";
    const stateHtml = state.trim() ? `<span class="read-contrib-state">${escHtml(state)}</span>` : "";
    return `<div class="read-contrib"><span class="read-contrib-pip ${t}" aria-hidden="true"></span>${labelHtml}${stateHtml}</div>`;
  }

  function planEnduranceUnitsToggle(units: "km" | "mi"): string {
    const btn = (value: "km" | "mi", label: string) =>
      `<button type="button" class="end-unit-btn${units === value ? " on" : ""}" data-run-units="${value}" aria-pressed="${units === value}">${escHtml(label)}</button>`;
    return `<div class="end-units" role="group" aria-label="Distance and pace units">${btn("km", "km")}${btn("mi", "mi")}</div>`;
  }

  function planEnduranceThenRows(sessions: PlanEnduranceBriefingSession[]): string {
    return sessions
      .map(
        (session) =>
          `<div class="end-then-row ${planEnduranceKindClass(session.kind)}">
          <span class="end-then-when">${escHtml(session.when)}</span>
          <span class="end-then-name">${escHtml(session.label)}</span>
          ${session.prescription ? `<span class="end-then-pres numeral">${escHtml(session.prescription)}</span>` : ""}
        </div>`
      )
      .join("");
  }

  function planEnduranceBriefingHtml(briefing: PlanEnduranceBriefing | null | undefined, start = 0): string {
    if (!briefing) return "";
    const lead = briefing.headline
      ? `<p class="end-brief-lead reveal" style="${stagger(start)}"><span class="lbl">${escHtml(briefing.kicker)}</span> ${escHtml(briefing.headline)}</p>`
      : briefing.next
        ? `<p class="end-brief-lead reveal" style="${stagger(start)}"><span class="lbl">${escHtml(briefing.kicker)}</span></p>`
        : "";
    const next = briefing.next;
    const nextHtml = next
      ? `<div class="end-next reveal" style="${stagger(start + 1)}" data-end-next>
          <span class="lbl end-next-kicker">${escHtml(next.date && next.when.startsWith("Today") ? "Today" : "Next")}</span>
          <div class="end-next-when">${escHtml(next.when)}</div>
          <div class="end-next-name">${escHtml(next.label)}</div>
          ${next.prescription ? `<div class="end-next-pres numeral">${escHtml(next.prescription)}</div>` : ""}
          <div class="read-contribs">
            ${next.morning ? planEnduranceContrib("This morning", next.morning, "quiet") : ""}
            ${planEnduranceContrib("Setup", next.setup, "quiet")}
            ${planEnduranceContrib("Expect", next.expect, "quiet")}
            ${planEnduranceContrib("Sits by", next.sitsBy, "quiet")}
          </div>
        </div>`
      : "";
    const remainingHtml = briefing.remaining.length
      ? `<div class="end-then reveal" style="${stagger(start + 2)}">
          <span class="lbl">Then</span>
          <div class="end-then-rows">${planEnduranceThenRows(briefing.remaining)}</div>
        </div>`
      : "";
    const laterHtml = briefing.later.length
      ? `<details class="end-later reveal" style="${stagger(start + 3)}">
          <summary><span class="lbl">Later in the build</span></summary>
          <div class="end-then-rows">${planEnduranceThenRows(briefing.later)}</div>
        </details>`
      : "";
    if (!lead && !nextHtml && !remainingHtml && !laterHtml) return "";
    return `<div class="end-brief card-stack-item">
      <div class="end-brief-bar">${lead || `<p class="end-brief-lead"><span class="lbl">${escHtml(briefing.kicker)}</span></p>`}${planEnduranceUnitsToggle(briefing.units)}</div>
      ${nextHtml}${remainingHtml}${laterHtml}
    </div>`;
  }

  const CAIRN_PLAN_ENDURANCE_BRIEFING = {
    briefingHtml: planEnduranceBriefingHtml,
  };

  Object.assign(globalThis, { CairnPlanEnduranceBriefing: CAIRN_PLAN_ENDURANCE_BRIEFING });
}
