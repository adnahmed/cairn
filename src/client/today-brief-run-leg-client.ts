// @ts-check
// A run already in today and a leg day still to lift: the server's offer
// (src/repo/run-leg-choice.ts) rendered as the recovery menu's rows. Upper/lighter
// ask for a session (today-brief-actions-client.ts wires `data-runleg`); rest
// steers the read through the ordinary override chip wiring (`data-override`).
// A pure string builder that today-brief-client.ts reaches through a guarded
// global, so a partial boot (or a test that loads the Brief alone) renders nothing.
// Once the athlete steers, the server stops sending the offer. Every string is escaped.

(() => {
  const REST_INTENT = "rest — already ran today, my legs need the recovery";

  function optionHtml(opt: unknown): string {
    const o = (opt && typeof opt === "object" ? opt : {}) as Record<string, unknown>;
    const key = String(o.key || "");
    const label = String(o.label || "").trim();
    if (!label) return "";
    const text = `<span class="brief-recovery-opt-label">${escHtml(label)}</span>`;
    if (key === "rest") {
      return `<button type="button" class="brief-recovery-opt" data-override="${escAttr(REST_INTENT)}">${text}</button>`;
    }
    if (key !== "upper" && key !== "lighter") return "";
    const focus = o.focus == null ? "" : String(o.focus).trim();
    const constraints = o.constraints == null ? "" : String(o.constraints).trim();
    return `<button type="button" class="brief-recovery-opt" data-runleg="${escAttr(key)}" data-runleg-focus="${escAttr(focus)}" data-runleg-constraints="${escAttr(constraints)}">${text}</button>`;
  }

  function html(read: unknown, isToday: boolean): string {
    if (!isToday) return "";
    const choice = (read as { run_leg_choice?: unknown } | null | undefined)?.run_leg_choice;
    if (!choice || typeof choice !== "object") return "";
    const c = choice as { line?: unknown; options?: unknown };
    const line = c.line == null ? "" : String(c.line).trim();
    const rows = (Array.isArray(c.options) ? c.options : []).map(optionHtml).filter(Boolean).join("");
    if (!rows) return "";
    return `<div class="brief-recovery brief-runleg">${line ? `<p class="brief-recovery-line">${escHtml(line)}</p>` : ""}<div class="brief-recovery-list">${rows}</div></div>`;
  }

  const CAIRN_TODAY_BRIEF_RUN_LEG = { html };

  Object.assign(globalThis, { CairnTodayBriefRunLeg: CAIRN_TODAY_BRIEF_RUN_LEG });
  if (typeof window !== "undefined") {
    Object.assign(window, { CairnTodayBriefRunLeg: CAIRN_TODAY_BRIEF_RUN_LEG });
  }
})();
