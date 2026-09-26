// @ts-check
// The race ladder (docs/V2-PLAN.md wave 4, "race-ladder"). The view: the server's
// weeks to race day as rows, the current week marked in words and by aria-current,
// and each week's kilometres as a bar against the ladder's longest week. This week
// also carries what has been run so far as a fill inside its own bar. The taper and
// race week read as their kinds. Kilometres per week always; no score, no grade.
{
  function rowHtml(row: ClientRaceLadderRow, index: number, opts: { reveal?: boolean }): string {
    const cls = ["race-ladder-row", `is-${row.kind}`, row.current ? "is-current" : "", opts.reveal ? "reveal" : ""]
      .filter(Boolean)
      .join(" ");
    const style = ` style="--i:${Math.min(12, index)};--frac:${row.frac}"`;
    const current = row.current ? ` aria-current="true"` : "";
    const here = row.current ? `<span class="race-ladder-here">This week</span>` : "";
    const logged =
      row.logged_frac != null ? `<span class="race-ladder-logged" style="--frac:${row.logged_frac}"></span>` : "";
    const meta = [row.long_text].filter(Boolean).join(" · ");
    const foot =
      row.so_far_text || row.race_day_text
        ? `<span class="race-ladder-foot">${escHtml(row.so_far_text || row.race_day_text)}</span>`
        : "";
    return `<li class="${cls}"${style}${current} data-race-week="${escAttr(row.week_start)}">
      <span class="race-ladder-when">
        <span class="race-ladder-out">${escHtml(row.out_word)}</span>
        <span class="race-ladder-date">${escHtml(row.date_word)}</span>
      </span>
      <span class="race-ladder-main">
        <span class="race-ladder-kind">${escHtml(row.kind_word)}${here}${meta ? `<span class="race-ladder-meta">${escHtml(meta)}</span>` : ""}</span>
        <span class="race-ladder-track" aria-hidden="true"><span class="race-ladder-bar"></span>${logged}</span>
        ${foot}
      </span>
      <span class="race-ladder-km numeral">${escHtml(row.km_text)}</span>
    </li>`;
  }

  /** The ladder list, or "" when the build has no weeks to lay out. */
  function ladderHtml(model: ClientRaceLadderModel, opts: { reveal?: boolean } = {}): string {
    if (!model || !Array.isArray(model.rows) || !model.rows.length) return "";
    const rows = model.rows.map((row, index) => rowHtml(row, index, opts)).join("");
    const taper = model.taper_text ? `<p class="race-ladder-taper">${escHtml(model.taper_text)}</p>` : "";
    return `<div class="race-ladder">
      <div class="race-ladder-head"><span class="lbl">The build, week by week</span><span class="race-ladder-unit">km per week</span></div>
      <ol class="race-ladder-list" aria-label="Kilometres per week to race day">${rows}</ol>
      ${taper}
    </div>`;
  }

  const CAIRN_RACE_LADDER = { ladderHtml, rowHtml };

  Object.assign(globalThis, { CairnRaceLadder: CAIRN_RACE_LADDER });
}
