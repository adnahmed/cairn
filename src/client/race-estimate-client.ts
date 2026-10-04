// @ts-check
// The race estimate (docs/V2-PLAN.md wave 4, "race-estimate"). The view, at the foot of
// the race page: where the finish estimate comes from, and the training paces. The fit
// itself — "Reads about 1:54 · inside sub-2:00" — is the head's line now, so this
// section never says it twice. The fit is a band, never a grade: no gap as a verdict,
// no percentage, no score.
{
  type Pace = { label: string; text: string };

  function pacesHtml(paces: Pace[]): string {
    if (!paces.length) return "";
    const rows = paces
      .map(
        (pace) =>
          `<div class="race-view-pace"><dt>${escHtml(pace.label)}</dt><dd class="numeral">${escHtml(pace.text)}</dd></div>`
      )
      .join("");
    return `<dl class="race-view-paces" aria-label="Training paces">${rows}</dl>`;
  }

  /**
   * The estimate's basis and the paces. With a fit the head already speaks, only the
   * basis is said here; with none (no target, or no estimate yet) the one line that
   * says why stands in its place.
   */
  function estimateHtml(model: ClientRaceEstimateModel, opts: { paces?: Pace[] } = {}): string {
    if (!model) return "";
    const paces = pacesHtml(Array.isArray(opts.paces) ? opts.paces : []);
    const line = !model.fit && model.fit_line ? `<p class="race-estimate-line">${escHtml(model.fit_line)}</p>` : "";
    const source = model.basis_text ? `<p class="race-estimate-source">${escHtml(model.basis_text)}</p>` : "";
    if (!line && !source && !paces) return "";
    return `<div class="race-estimate${model.empty ? " is-empty" : ""}">
      <span class="lbl race-estimate-kicker">Finish estimate and paces</span>
      ${line}${source}${paces}
    </div>`;
  }

  const CAIRN_RACE_ESTIMATE = { estimateHtml };

  Object.assign(globalThis, { CairnRaceEstimate: CAIRN_RACE_ESTIMATE });
}
