// @ts-check
// The race estimate (docs/V2-PLAN.md wave 4, "race-estimate"). The view: the finish
// estimate against the target as the server's fit word — Fits, Stretch or Beyond
// horizon — with the two clocks it compares and where the estimate comes from. The
// fit is a band, never a grade: no gap as a verdict, no percentage, no score.
{
  function estimateHtml(model: ClientRaceEstimateModel): string {
    if (!model) return "";
    const fit = model.fit
      ? `<span class="race-estimate-word is-${escAttr(model.fit)}">${escHtml(model.fit_word)}</span>`
      : "";
    const line = model.fit_line ? `<span class="race-estimate-line">${escHtml(model.fit_line)}</span>` : "";
    const clockRow = (label: string, value: string, cls: string): string =>
      value
        ? `<div class="race-estimate-clock ${cls}"><dt class="lbl">${escHtml(label)}</dt><dd class="numeral">${escHtml(value)}</dd></div>`
        : "";
    const clocks =
      model.estimate_clock || model.target_clock
        ? `<dl class="race-estimate-clocks">${clockRow("Reads like", model.estimate_clock, "is-estimate")}${clockRow("Shooting for", model.target_clock, "is-target")}</dl>`
        : "";
    const source = [model.trend_text, model.basis_text].filter(Boolean).join(" ");
    return `<div class="race-estimate${model.empty ? " is-empty" : ""}">
      <span class="lbl race-estimate-kicker">Finish estimate</span>
      <p class="race-estimate-fit">${fit}${line}</p>
      ${clocks}
      ${source ? `<p class="race-estimate-source">${escHtml(source)}</p>` : ""}
    </div>`;
  }

  const CAIRN_RACE_ESTIMATE = { estimateHtml };

  Object.assign(globalThis, { CairnRaceEstimate: CAIRN_RACE_ESTIMATE });
}
