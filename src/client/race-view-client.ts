// @ts-check
// The race page (/app/horizon/race), the view: the depth behind Horizon's race glance.
// Top to bottom: the race, THIS WEEK (the one focal card), the build week by week, how
// the lifting fits, and the finish estimate as a fit with its basis, the paces one tap
// deeper. Pure strings: the model carries every word, and each state (loading, empty,
// error) has its own renderer here.
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
      <summary class="race-view-more-sum">${model.notes.length ? "Paces and the week's layout" : "Training paces"}</summary>
      <div class="race-view-more-body">${paces}${notes}</div>
    </details>`;
  }

  /** The km / mi switch, the same one every endurance surface wears (data-run-units). */
  function unitsHtml(units: "km" | "mi"): string {
    const btn = (value: "km" | "mi") =>
      `<button type="button" class="end-unit-btn${units === value ? " on" : ""}" data-run-units="${value}" aria-pressed="${units === value}">${value}</button>`;
    return `<div class="end-units" role="group" aria-label="Distance and pace units">${btn("km")}${btn("mi")}</div>`;
  }

  /**
   * The week's volume as one figure: "9.7 of 19.5 km" once something is run, else the
   * week's volume named as the PLAN ("19.5 km planned") — a bare "19.5 km this week"
   * over an empty bar read as done — and never a zero. `cls` is the surface's prefix.
   */
  function volumeFigureHtml(week: ClientRaceThisWeek | null | undefined, cls: string): string {
    if (!week) return "";
    if (week.done_text && week.target_text) {
      return `<span class="${cls}-num numeral">${escHtml(week.done_text)}<span class="${cls}-of"> of ${escHtml(week.target_text)}</span></span>`;
    }
    const alone = week.done_text || week.target_text;
    if (!alone) return "";
    return `<span class="${cls}-num numeral">${escHtml(alone)}<span class="${cls}-of"> ${week.done_text ? "run" : "planned"}</span></span>`;
  }

  /**
   * THIS WEEK, the page's one focal card: the week's stage, what the log holds of its
   * volume on a quiet bar, the long run, the week's runs by weekday (`sessionsHtml`, the
   * briefing's rows, handed in by the page), and the week's one coaching sentence. Works
   * without a race: a runner's week has no stage and says so plainly.
   */
  function thisWeekHtml(
    week: ClientRaceThisWeek | null,
    opts: { sessionsHtml?: string; focus?: string; units?: "km" | "mi" } = {}
  ): string {
    const sessions = opts.sessionsHtml || "";
    const focus = week?.focus || opts.focus || "";
    if (!week && !sessions && !focus) return "";
    const figure = volumeFigureHtml(week, "race-week");
    const bar =
      week?.frac != null
        ? `<span class="race-week-track" aria-hidden="true"><span class="race-week-fill${week.banked ? " is-banked" : ""}" style="--frac:${week.frac}"></span></span>`
        : "";
    const long = week?.long_text ? `<span class="race-week-long">${escHtml(week.long_text)}</span>` : "";
    const volume =
      figure || long
        ? `<div class="race-week-volume"><div class="race-week-row">${figure}${long}</div>${bar}</div>`
        : "";
    return `<section class="race-week" aria-labelledby="raceWeekTitle">
      <div class="race-week-head">
        <div class="race-view-kickrow"><span class="lbl">This week</span>${opts.units ? unitsHtml(opts.units) : ""}</div>
        <h3 class="race-week-stage" id="raceWeekTitle">${escHtml(week?.stage_word || "Your running week")}</h3>
      </div>
      ${volume}
      ${sessions}
      ${focus ? `<p class="race-week-focus">${escHtml(focus)}</p>` : ""}
    </section>`;
  }

  /**
   * "With your lifting": how the lifts and the runs fit, one row a week (a run of weeks
   * saying the same thing is one row), in the server's words. "" for a running-only athlete.
   */
  function liftingHtml(lines: ClientRaceLiftingLine[]): string {
    if (!lines.length) return "";
    const rows = lines
      .map(
        (line) => `<li class="race-lifting-row${line.current ? " is-current" : ""}">
          <span class="race-lifting-when">${escHtml(line.when)}${line.stage ? ` · ${escHtml(line.stage)}` : ""}</span>
          <p class="race-lifting-text">${escHtml(line.text)}</p>
        </li>`
      )
      .join("");
    return `<section class="race-section race-lifting" aria-label="With your lifting">
      <span class="lbl">With your lifting</span>
      <ol class="race-lifting-list">${rows}</ol>
    </section>`;
  }

  /**
   * The whole race page, top to bottom: the race (name, countdown, race day, the units),
   * THIS WEEK, the build week by week, how the lifting fits, then the finish estimate
   * with the paces one tap deeper. No chart here: the terrain is Horizon's glance, and
   * the ladder below is the same build as a table. `enter` settles it in once.
   */
  function viewHtml(
    model: ClientRaceViewModel,
    opts: { enter?: boolean; sessionsHtml?: string; units?: "km" | "mi" } = {}
  ): string {
    const when = [model.countdown, model.race_day].filter(Boolean).join(" · ");
    const ladder = CairnRaceLadder.ladderHtml(model.ladder, { reveal: false });
    return `<section class="race-view${opts.enter ? " settle-in is-entering" : ""}" aria-label="Race" data-race-view>
      <header class="race-view-head">
        <div class="race-view-kickrow">
          <span class="lbl">Race</span>
          ${unitsHtml(opts.units || model.ladder.units || "km")}
        </div>
        <h2 class="race-view-event">${escHtml(model.event)}</h2>
        ${when ? `<p class="race-view-when">${escHtml(when)}</p>` : ""}
      </header>
      ${thisWeekHtml(model.this_week, { sessionsHtml: opts.sessionsHtml })}
      ${ladder ? `<section class="race-section" aria-label="The build, week by week">${ladder}</section>` : ""}
      ${liftingHtml(model.lifting)}
      <section class="race-section">${CairnRaceEstimate.estimateHtml(model.estimate)}</section>
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
      String(reason || "").trim() || "Set a dated half marathon in You → Profile and the build reads from it.";
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

  const CAIRN_RACE_VIEW = {
    viewHtml,
    thisWeekHtml,
    volumeFigureHtml,
    liftingHtml,
    unitsHtml,
    skeletonHtml,
    emptyHtml,
    errorHtml,
  };

  Object.assign(globalThis, { CairnRaceView: CAIRN_RACE_VIEW });
}
