// @ts-check
// The race ladder (docs/V2-PLAN.md wave 4, "race-ladder"). The view: the server's
// weeks to race day as rows (the race page's table of the build), with the last few
// closed weeks above them and a quiet "now" between. One encoding for every bar: what
// was run is solid, what is planned is an outline on a pale track, and this week is its
// logged solid inside its planned outline (running past it, the solid runs on past the
// outline). A week's kind is a word and a small mark, never the bar's colour. Distance
// per week in the athlete's units; no score, no grade.
{
  /** The kind's small mark: a shape that says build / peak / down / taper / race beside the word. */
  function markHtml(kind: string): string {
    return `<span class="race-ladder-mark is-${escAttr(kind)}" aria-hidden="true"></span>`;
  }

  function rowHtml(row: ClientRaceLadderRow, index: number, opts: { reveal?: boolean }): string {
    const cls = [
      "race-ladder-row",
      `is-${row.kind}`,
      row.current ? "is-current" : "is-plan",
      row.closed ? "is-closed" : "",
      opts.reveal ? "reveal" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const style = ` style="--i:${Math.min(12, index)};--frac:${row.frac}"`;
    const current = row.current ? ` aria-current="true"` : "";
    const here = row.current ? `<span class="race-ladder-here">This week</span>` : "";
    const logged =
      row.logged_frac != null ? `<span class="race-ladder-logged" style="--frac:${row.logged_frac}"></span>` : "";
    const meta = [row.long_text].filter(Boolean).join(" · ");
    // A closed week says what it was; an open one what it is for.
    const foot = row.race_day_text || row.recap_text || row.focus_short;
    const label = row.bar_label || `${row.date_word}: ${row.km_text}`;
    return `<li class="${cls}"${style}${current} data-race-week="${escAttr(row.week_start)}">
      <span class="race-ladder-when">
        <span class="race-ladder-date">${escHtml(row.date_word)}</span>
        <span class="race-ladder-out">${escHtml(row.out_word)}</span>
      </span>
      <span class="race-ladder-main">
        <span class="race-ladder-kind">${markHtml(row.kind)}<span class="race-ladder-word">${escHtml(row.stage_word || row.kind_word)}</span>${here}${meta ? `<span class="race-ladder-meta">${escHtml(meta)}</span>` : ""}</span>
        <span class="race-ladder-track" role="img" aria-label="${escAttr(label)}"><span class="race-ladder-bar"></span>${logged}</span>
        ${foot ? `<span class="race-ladder-foot">${escHtml(foot)}</span>` : ""}
      </span>
      <span class="race-ladder-km numeral">${escHtml(row.km_text)}</span>
    </li>`;
  }

  /** A closed week above this one: its date, its runs, its actual as a solid bar. */
  function pastRowHtml(row: ClientRaceLadderPastRow): string {
    return `<li class="race-ladder-row is-done" style="--frac:${row.frac}" data-race-week="${escAttr(row.week_start)}">
      <span class="race-ladder-when">
        <span class="race-ladder-date">${escHtml(row.date_word)}</span>
      </span>
      <span class="race-ladder-main">
        ${row.runs_text ? `<span class="race-ladder-kind"><span class="race-ladder-meta">${escHtml(row.runs_text)}</span></span>` : ""}
        <span class="race-ladder-track" role="img" aria-label="${escAttr(row.bar_label)}"><span class="race-ladder-logged"></span></span>
      </span>
      <span class="race-ladder-km numeral">${escHtml(row.km_text)}</span>
    </li>`;
  }

  /** The ladder list, or "" when the build has no weeks to lay out. */
  function ladderHtml(model: ClientRaceLadderModel, opts: { reveal?: boolean } = {}): string {
    if (!model || !Array.isArray(model.rows) || !model.rows.length) return "";
    const past = Array.isArray(model.past) ? model.past : [];
    const rows = model.rows.map((row, index) => rowHtml(row, index + past.length, opts)).join("");
    const pastRows = past.map(pastRowHtml).join("");
    // The quiet line between what was run and what is ahead; only when there is a before.
    const now = past.length
      ? `<li class="race-ladder-now" aria-hidden="true"><span class="race-ladder-now-word">now</span></li>`
      : "";
    const taper = model.taper_text ? `<p class="race-ladder-taper">${escHtml(model.taper_text)}</p>` : "";
    const capacity = model.capacity_text ? `<p class="race-ladder-capacity">${escHtml(model.capacity_text)}</p>` : "";
    const adapted = model.adapted_text ? `<p class="race-ladder-adapted">${escHtml(model.adapted_text)}</p>` : "";
    const mi = model.units === "mi";
    return `<div class="race-ladder">
      <div class="race-ladder-head"><span class="lbl">The build, week by week</span><span class="race-ladder-unit">${mi ? "mi" : "km"} per week</span></div>
      ${capacity}
      <ol class="race-ladder-list" aria-label="${mi ? "Miles" : "Kilometres"} per week to race day">${pastRows}${now}${rows}</ol>
      <p class="race-ladder-key" aria-hidden="true"><span class="race-ladder-key-run">run</span><span class="race-ladder-key-plan">planned</span></p>
      ${adapted}
      ${taper}
    </div>`;
  }

  const CAIRN_RACE_LADDER = { ladderHtml, rowHtml };

  Object.assign(globalThis, { CairnRaceLadder: CAIRN_RACE_LADDER });
}
