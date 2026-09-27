// @ts-check
// Today main shell markup: Brief/capture lead, weekly fold, and focus/rail wrapper.
// The Brief leads (Atelier v2: the day's voice is the first thing on Today); the
// life-context banner follows it as a quiet line rather than sitting above it.

type TodayMainShellLeadOptions = {
  isToday: boolean;
  briefHtml: string;
  conductorHtml: string;
  currentWeight: unknown;
};
type TodayMainShellCompass = {
  weekRecap?: string | null;
  cellsHtml?: string;
};
type TodayMainShellDeps = {
  escapeHtml(value: unknown): string;
};
type TodayMainShellApi = {
  carryBriefSlots(from: Element): (into: Element) => void;
  leadHtml(options: TodayMainShellLeadOptions, deps: TodayMainShellDeps): string;
  weekFoldHtml(compass: TodayMainShellCompass, deps: Pick<TodayMainShellDeps, "escapeHtml">): string;
  wrapHtml(content: string, options: { railHtml: string }): string;
};

(() => {
  function weightChipLabel(currentWeight: unknown): string {
    return currentWeight != null ? `${currentWeight}<span class="wt-mini-unit">lb</span>` : "weight";
  }

  function captureRowHtml(currentWeight: unknown, isToday: boolean): string {
    // tagsSlot renders only when its loader has something to show (the quiet tag
    // chip row) — an empty <div> here that stays quiet (`:empty{display:none}`)
    // until post-render wiring fills it. Food frequents moved into the Chat
    // composer (prefill, not one-tap re-log) — capture stays in Chat.
    //
    // The morning check-in is NOT here any more. It belongs under the sentence that
    // asks how the body is, not in a footer three surfaces below it, so the Brief
    // itself mounts `#checkinSlot` on the rest/easy reads where the question is
    // actually being asked (today-brief-client.ts).
    return `<div class="capture-row reveal" style="--i:1">
      <div class="wt-inline" id="wtInline" hidden>
        <input id="wtInlineInput" type="number" inputmode="decimal" step="0.1" placeholder="Weight (lb)">
        <button id="wtInlineGo" class="logbtn">+</button>
      </div>
      <button id="wtChipMini" class="wt-mini" type="button" title="Log bodyweight">${weightChipLabel(currentWeight)}<span class="stat-plus">+</span></button>
      ${isToday ? `<div id="tagsSlot" class="tags-slot"></div>` : ""}
    </div>`;
  }

  function leadHtml(options: TodayMainShellLeadOptions, deps: TodayMainShellDeps): string {
    void deps;
    return `${options.isToday ? "" : `<button id="backToday" class="ghostbtn back-today">← Back to today</button>`}
    ${options.briefHtml}
    <div id="ctxBanner"><div id="ctxEvents"></div><div id="ctxHealth"></div></div>
    ${options.conductorHtml ? `<div class="cfocus-slot cfocus-thread-slot" id="cfocusSlot">${options.conductorHtml}</div>` : `<div class="cfocus-slot" id="cfocusSlot"></div>`}
    <div id="attentionLead" class="card-stack"></div>
    <div id="sugSlot" class="sug-slot"></div>
    ${captureRowHtml(options.currentWeight, options.isToday)}`;
  }

  function weekFoldHtml(compass: TodayMainShellCompass, deps: Pick<TodayMainShellDeps, "escapeHtml">): string {
    return `<details class="weekfold" id="weekFold">
      <summary class="weekfold-sum"><span class="lbl">This week</span>${compass.weekRecap ? `<span class="weekfold-recap">${deps.escapeHtml(compass.weekRecap)}</span>` : ""}<span class="weekfold-chev" aria-hidden="true">▾</span></summary>
      <div class="statstrip statstrip-compass">
        ${compass.cellsHtml || ""}
      </div>
      <div id="wearStrip"></div>
      <div id="wearBands"></div>
    </details>`;
  }

  // The fuel glance is mounted INTO the Brief by its own controller (voice → NOW →
  // fuel). An in-place Brief swap takes the painted node out of the old element and
  // stands it in the new one, where its own controller places it, so nothing
  // repaints or replays its entrance.
  function carryBriefSlots(from: Element): (into: Element) => void {
    const fuel = from.querySelector("#todayFuelSlot");
    return (into) => {
      const g = globalThis as {
        CairnTodayFuelGlance?: { place?(brief: Element, slot: Element): void };
      };
      try {
        if (fuel) g.CairnTodayFuelGlance?.place?.(into, fuel);
      } catch {}
    };
  }

  function wrapHtml(content: string, options: { railHtml: string }): string {
    return `<div class="today-wrap"><div class="today-main">${content}</div>${options.railHtml}</div>`;
  }

  const CAIRN_TODAY_MAIN_SHELL: TodayMainShellApi = {
    carryBriefSlots,
    leadHtml,
    weekFoldHtml,
    wrapHtml,
  };

  Object.assign(globalThis, { CairnTodayMainShell: CAIRN_TODAY_MAIN_SHELL });
  if (typeof window !== "undefined") {
    Object.assign(window, { CairnTodayMainShell: CAIRN_TODAY_MAIN_SHELL });
  }
})();
