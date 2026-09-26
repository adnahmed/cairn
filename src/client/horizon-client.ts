// @ts-check
// The Horizon timeline, the view (docs/V2-PLAN.md wave 5): three lanes on one line of
// time — the race, the goal line, and labs and scans. Pure strings: the model carries
// every word, and each lane has its own loading shape. A lane's rows run behind → a
// "Today" mark → ahead, the same rail the road-ahead card draws. Each link carries a
// real href (so a long-press or a new tab works) and `data-horizon-go`, the key the
// controller resolves to a route. Kilometres per week and fit words only; no score.
{
  type Lane = ClientHorizonLane;
  type Row = ClientHorizonRow;

  const KEYS: ReadonlyArray<Lane["key"]> = ["race", "goal", "labs"];
  const TITLES: Readonly<Record<Lane["key"], string>> = { race: "Race", goal: "Goal line", labs: "Labs and scans" };

  type HrefFor = (target: ClientHorizonTarget) => string | null;

  function linkAttrs(key: string, target: ClientHorizonTarget | null, hrefFor?: HrefFor): string {
    if (!target) return "";
    const href = hrefFor?.(target) || "";
    return `${href ? ` href="${escAttr(href)}"` : ` href="#"`} data-horizon-go="${escAttr(key)}"`;
  }

  function rowHtml(lane: Lane, row: Row, index: number, hrefFor?: HrefFor): string {
    const cls = ["horizon-row", `is-${row.side}`, `is-kind-${row.kind.replace(/[^a-z0-9_-]/gi, "")}`].join(" ");
    const inner = `<span class="horizon-row-dot" aria-hidden="true"></span>
      <span class="horizon-row-main">
        ${row.when ? `<span class="horizon-row-when">${escHtml(row.when)}</span>` : ""}
        <span class="horizon-row-label">${escHtml(row.label)}</span>
        ${row.detail ? `<span class="horizon-row-detail">${escHtml(row.detail)}</span>` : ""}
      </span>`;
    if (!row.target) return `<li class="${cls}"><div class="horizon-row-body">${inner}</div></li>`;
    return `<li class="${cls}"><a class="horizon-row-body horizon-row-link"${linkAttrs(`${lane.key}:row:${index}`, row.target, hrefFor)}>${inner}<span class="horizon-row-arw" aria-hidden="true">›</span></a></li>`;
  }

  /** The rail: behind rows, the "Today" mark, then ahead rows. "" with no rows. */
  function railHtml(lane: Lane, hrefFor?: HrefFor): string {
    if (!lane.rows.length) return "";
    const behind = lane.rows.map((row, i) => ({ row, i })).filter(({ row }) => row.side === "behind");
    const ahead = lane.rows.map((row, i) => ({ row, i })).filter(({ row }) => row.side === "ahead");
    const now = `<li class="horizon-now"><span class="horizon-row-dot horizon-now-dot" aria-hidden="true"></span><span class="horizon-now-label">Today</span></li>`;
    const items = [
      ...behind.map(({ row, i }) => rowHtml(lane, row, i, hrefFor)),
      now,
      ...ahead.map(({ row, i }) => rowHtml(lane, row, i, hrefFor)),
    ].join("");
    return `<ol class="horizon-rail" aria-label="${escAttr(`${lane.title}, behind and ahead`)}">${items}</ol>`;
  }

  function fitHtml(lane: Lane): string {
    if (!lane.fit_word && !lane.fit_line) return "";
    const word = lane.fit
      ? `<span class="race-estimate-word is-${escAttr(lane.fit)}">${escHtml(lane.fit_word)}</span>`
      : "";
    const line = lane.fit_line ? `<span class="horizon-lane-fit-line">${escHtml(lane.fit_line)}</span>` : "";
    return `<p class="horizon-lane-fit">${word}${line}</p>`;
  }

  function linksHtml(lane: Lane, hrefFor?: HrefFor): string {
    if (!lane.links.length) return "";
    const links = lane.links
      .map(
        (link, i) =>
          `<a class="linkbtn linkbtn-sm horizon-lane-link"${linkAttrs(`${lane.key}:link:${i}`, link.target, hrefFor)}>${escHtml(link.label)} ›</a>`
      )
      .join("");
    return `<div class="horizon-lane-links">${links}</div>`;
  }

  /** One lane, painted. `enter` gives it the shared settle-in entrance once. */
  function laneHtml(lane: Lane, opts: { enter?: boolean; hrefFor?: HrefFor } = {}): string {
    const id = `horizonLane-${lane.key}`;
    const cls = ["horizon-lane-card", `is-${lane.key}`, `is-${lane.state}`, opts.enter ? "settle-in is-entering" : ""]
      .filter(Boolean)
      .join(" ");
    const ladder = lane.ladder ? CairnRaceLadder.ladderHtml(lane.ladder) : "";
    const status = lane.state === "unread" ? ` role="status" aria-live="polite"` : "";
    return `<section class="${cls}" aria-labelledby="${id}">
      <header class="horizon-lane-head">
        <span class="lbl horizon-lane-kicker">${escHtml(lane.title)}</span>
        <h2 class="horizon-lane-title" id="${id}"${status}>${escHtml(lane.headline)}</h2>
        ${lane.when ? `<p class="horizon-lane-when numeral">${escHtml(lane.when)}</p>` : ""}
      </header>
      ${fitHtml(lane)}
      ${lane.lede ? `<p class="horizon-lane-lede">${escHtml(lane.lede)}</p>` : ""}
      ${ladder}
      ${railHtml(lane, opts.hrefFor)}
      ${linksHtml(lane, opts.hrefFor)}
    </section>`;
  }

  /** A lane before its reads land: its name, and the shape of what comes, nothing said. */
  function laneSkeletonHtml(key: Lane["key"]): string {
    return `<section class="horizon-lane-card is-${key} is-loading" aria-busy="true" aria-label="${escAttr(TITLES[key])}">
      <span class="lbl horizon-lane-kicker">${escHtml(TITLES[key])}</span>
      <div class="hshimmer hshimmer-lg horizon-skel-title"></div>
      <div class="hshimmer horizon-skel-line"></div>
      <div class="hshimmer horizon-skel-line is-short"></div>
    </section>`;
  }

  /** The timeline's frame: one slot per lane, in the timeline's order. */
  function shellHtml(): string {
    const lanes = KEYS.map(
      (key) => `<li class="horizon-lane" data-horizon-lane="${key}">${laneSkeletonHtml(key)}</li>`
    ).join("");
    return `<div class="horizon" data-horizon>
      <p class="horizon-lede">What's ahead: the race, the goal line, and your next labs and scans.</p>
      <ol class="horizon-lanes" aria-label="What's ahead">${lanes}</ol>
    </div>`;
  }

  const CAIRN_HORIZON = { KEYS, laneHtml, laneSkeletonHtml, shellHtml };

  Object.assign(globalThis, { CairnHorizon: CAIRN_HORIZON });
}
