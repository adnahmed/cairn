// @ts-check
// The race estimate (docs/V2-PLAN.md wave 4, "race-estimate"). The view, at the foot of
// the race page: the finish milestones (goal, today's shape, stretch), where the
// estimate comes from, and the training paces. The fit sentence itself — "Reads about
// 1:54 · inside sub-2:00" — is the head's line, so this section never says it twice. The fit is a band, never a grade: no gap as a verdict,
// no percentage, no score.
{
  type Pace = { label: string; text: string };

  /**
   * The finish milestones as a row of clocks: the goal, where today's shape reads, the
   * stretch. Each is a time with the pace that holds it, and a place word — never a gap.
   */
  function finishesHtml(finishes: ClientRaceFinish[]): string {
    if (!finishes.length) return "";
    const rows = finishes
      .map(
        (f) => `<div class="race-finish is-${escAttr(f.key)}">
          <dt>${escHtml(f.label)}</dt>
          <dd class="race-finish-clock numeral">${escHtml(f.clock)}</dd>
          ${f.pace ? `<dd class="race-finish-pace numeral">${escHtml(f.pace)}</dd>` : ""}
          ${f.note ? `<dd class="race-finish-note">${escHtml(f.note)}</dd>` : ""}
        </div>`
      )
      .join("");
    return `<dl class="race-finishes" aria-label="Finish milestones">${rows}</dl>`;
  }

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
  function estimateHtml(
    model: ClientRaceEstimateModel,
    opts: { paces?: Pace[]; finishes?: ClientRaceFinish[] } = {}
  ): string {
    if (!model) return "";
    const finishes = finishesHtml(Array.isArray(opts.finishes) ? opts.finishes : []);
    const paces = pacesHtml(Array.isArray(opts.paces) ? opts.paces : []);
    const line = !model.fit && model.fit_line ? `<p class="race-estimate-line">${escHtml(model.fit_line)}</p>` : "";
    const source = model.basis_text ? `<p class="race-estimate-source">${escHtml(model.basis_text)}</p>` : "";
    if (!line && !source && !paces && !finishes) return "";
    return `<div class="race-estimate${model.empty ? " is-empty" : ""}">
      <span class="lbl race-estimate-kicker">Finish times and paces</span>
      ${finishes}${line}${source}${paces}
    </div>`;
  }

  const CAIRN_RACE_ESTIMATE = { estimateHtml };

  Object.assign(globalThis, { CairnRaceEstimate: CAIRN_RACE_ESTIMATE });
}
