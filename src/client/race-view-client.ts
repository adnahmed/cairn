// @ts-check
// The race view (docs/V2-PLAN.md wave 4), the view: the section of Plan → Endurance
// that is the primary race surface. It frames the race — its name, weeks to race and
// race day — then the finish estimate (race-estimate) and the ladder (race-ladder),
// with the paces and the server's own sentences one tap away. Pure strings: the
// model carries every word, and each state (loading, empty, error) has its own
// renderer here.
{
  function moreHtml(model: ClientRaceViewModel): string {
    if (!model.paces.length && !model.notes.length) return "";
    const paces = model.paces.length
      ? `<dl class="race-view-paces">${model.paces
          .map(
            (pace) =>
              `<div class="race-view-pace"><dt>${escHtml(pace.label)}</dt><dd class="numeral">${escHtml(pace.text)}</dd></div>`
          )
          .join("")}</dl>`
      : "";
    const notes = model.notes.map((note) => `<p class="race-view-note">${escHtml(note)}</p>`).join("");
    return `<details class="race-view-more">
      <summary class="race-view-more-sum">Paces and how the week fits</summary>
      <div class="race-view-more-body">${paces}${notes}</div>
    </details>`;
  }

  /** The build as terrain, Horizon's own instrument; "" when there is no ridge to draw. */
  function terrainHtml(model: ClientRaceViewModel): string {
    const chart =
      typeof CairnHorizonChart !== "undefined" && model.terrain ? CairnHorizonChart.terrainSvg(model.terrain) : "";
    return chart ? `<figure class="horizon-chart-card is-terrain race-view-terrain">${chart}</figure>` : "";
  }

  /**
   * The ladder, week by week. With the terrain drawn above it the ladder is the detail,
   * one tap deeper; without a chart it stands open, as the build's only picture.
   */
  function weeksHtml(model: ClientRaceViewModel): string {
    const ladder = CairnRaceLadder.ladderHtml(model.ladder);
    if (!ladder) return "";
    const charted = typeof CairnHorizonChart !== "undefined" && !!model.terrain;
    if (!charted) return ladder;
    return `<details class="race-view-weeks">
      <summary class="race-view-more-sum">The build, week by week</summary>
      ${ladder}
    </details>`;
  }

  /** The whole section. `enter` gives it one settle-in entrance and grows the bars. */
  function viewHtml(model: ClientRaceViewModel, opts: { enter?: boolean } = {}): string {
    const when = [model.countdown, model.race_day].filter(Boolean).join(" · ");
    return `<section class="race-view${opts.enter ? " settle-in is-entering" : ""}" aria-label="Race" data-race-view>
      <header class="race-view-head">
        <span class="lbl">Race${model.phase_word ? ` · ${escHtml(model.phase_word)}` : ""}</span>
        <h2 class="race-view-event">${escHtml(model.event)}</h2>
        ${when ? `<p class="race-view-when numeral">${escHtml(when)}</p>` : ""}
      </header>
      ${terrainHtml(model)}
      ${CairnRaceEstimate.estimateHtml(model.estimate)}
      ${weeksHtml(model)}
      ${moreHtml(model)}
    </section>`;
  }

  /** Cold load: the shape of the view, nothing said. */
  function skeletonHtml(): string {
    const bars = Array.from({ length: 5 }, () => `<div class="hshimmer race-view-skel-bar"></div>`).join("");
    return `<section class="race-view race-view-skel" aria-busy="true" aria-label="Race">
      <div class="hshimmer hshimmer-sm race-view-skel-kicker"></div>
      <div class="hshimmer hshimmer-lg race-view-skel-title"></div>
      ${bars}
    </section>`;
  }

  /** No build to show: what fills it and where that comes from, never blame. */
  function emptyHtml(reason?: unknown): string {
    const body =
      String(reason || "").trim() ||
      "Set a dated half marathon in You → Profile and the build reads from it.";
    return `<section class="race-view race-view-empty" aria-label="Race">
      ${CairnUi.emptyStateHtml({ title: "No race build yet", body, className: "empty-state race-view-empty-state" })}
    </section>`;
  }

  function errorHtml(): string {
    return `<section class="race-view race-view-error" aria-label="Race">
      <p class="race-view-error-line" role="status" aria-live="polite">The race build couldn't be read just now.</p>
      <button class="linkbtn race-view-retry" type="button" data-race-view-retry>Try again</button>
    </section>`;
  }

  const CAIRN_RACE_VIEW = { viewHtml, skeletonHtml, emptyHtml, errorHtml };

  Object.assign(globalThis, { CairnRaceView: CAIRN_RACE_VIEW });
}
