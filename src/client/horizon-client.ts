// @ts-check
// The Horizon timeline, the view (docs/V2-PLAN.md wave 5): three views on one line of
// time — this week (day by day), the race build (its serif line, the terrain and a
// row a week), and the season (the goal line, and labs and scans). Pure strings: the model carries
// every word, and each lane has its own loading shape. A lane's rows run behind → a
// "Today" mark → ahead, the same rail the road-ahead card draws. Each link carries a
// real href (so a long-press or a new tab works) and `data-horizon-go`, the key the
// controller resolves to a route. Distance per week (km or mi, the athlete's pick) and
// fit words only; no score.
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
    // The "Today" mark divides behind from ahead; with nothing behind it would only
    // repeat the lane's own start, so it stands only between the two.
    const items = [
      ...behind.map(({ row, i }) => rowHtml(lane, row, i, hrefFor)),
      behind.length ? now : "",
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
    // Under the build it is a footnote: the finish estimate, named, after the weeks.
    const lead = lane.voice ? `<span class="lbl horizon-lane-fit-lbl">Finish estimate</span>` : "";
    return `<p class="horizon-lane-fit">${lead}${word}${line}</p>`;
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

  /** The race build as terrain, in its chart card; "" when there is no ridge to draw. */
  function terrainHtml(lane: Lane, selected?: string | null): string {
    const chart =
      typeof CairnHorizonChart !== "undefined" && lane.terrain
        ? CairnHorizonChart.terrainSvg(lane.terrain, { selected })
        : "";
    return chart ? `<figure class="horizon-chart-card is-terrain">${chart}</figure>` : "";
  }

  /** The km / mi switch: the athlete's run units, saved to settings from any surface. */
  function unitsHtml(units: "km" | "mi"): string {
    const btn = (value: "km" | "mi") =>
      `<button type="button" class="end-unit-btn${units === value ? " on" : ""}" data-horizon-units="${value}" aria-pressed="${units === value}">${value}</button>`;
    return `<div class="end-units horizon-units" role="group" aria-label="Distance and pace units">${btn("km")}${btn("mi")}</div>`;
  }

  /** Which week the rows hold open: the picked one, none (""), or this week. */
  function openWeek(rows: ClientRaceLadderRow[], selected?: string | null): string {
    if (selected === "") return "";
    if (selected && rows.some((row) => row.week_start === selected)) return selected;
    return rows.find((row) => row.current)?.week_start || "";
  }

  /**
   * The build, one hairline row a week (mono date, kind, km per week), from this week to
   * race week. The open week says what its running and lifting are, in the server's
   * words; a tap opens another. A week with nothing more to say is a plain row.
   */
  function weeksHtml(lane: Lane, selected?: string | null): string {
    const rows = lane.ladder?.rows || [];
    if (!rows.length) return "";
    const open = openWeek(rows, selected);
    const items = rows
      .map((row, index) => {
        const isOpen = row.week_start === open;
        const foot = row.so_far_text || row.race_day_text;
        const more = !!(row.run_text || row.lift_text || foot);
        const cls = ["horizon-week", `is-${row.kind}`, row.current ? "is-current" : "", isOpen ? "is-open" : ""]
          .filter(Boolean)
          .join(" ");
        const head = `<span class="horizon-week-date">${escHtml(row.date_word)}</span>
          <span class="horizon-week-kind">${escHtml(row.kind_word)}${row.current ? `<span class="horizon-week-now"> · now</span>` : ""}</span>
          <span class="horizon-week-km numeral">${escHtml(row.km_text)}</span>`;
        const detail = isOpen && more
          ? `<div class="horizon-week-detail" id="horizonWeek-${index}">
              ${row.run_text ? `<p><b class="horizon-week-run">Run</b> · ${escHtml(row.run_text)}</p>` : ""}
              ${row.lift_text ? `<p><b class="horizon-week-lift">Lift</b> · ${escHtml(row.lift_text)}</p>` : ""}
              ${foot ? `<p class="horizon-week-foot">${escHtml(foot)}</p>` : ""}
            </div>`
          : "";
        const button = more
          ? `<button type="button" class="horizon-week-head" data-horizon-week="${escAttr(row.week_start)}" aria-expanded="${isOpen}"${isOpen ? ` aria-controls="horizonWeek-${index}"` : ""}>${head}</button>`
          : `<div class="horizon-week-head">${head}</div>`;
        return `<li class="${cls}"${row.current ? ` aria-current="true"` : ""} data-race-week="${escAttr(row.week_start)}">${button}${detail}</li>`;
      })
      .join("");
    return `<ol class="horizon-weeks" aria-label="The build, week by week">${items}</ol>`;
  }

  /**
   * The goal line's chart slot: space held at the chart's own shape so the season line
   * lands without moving anything. The controller fills it (or drops it) once the
   * weigh-ins are read.
   */
  function seasonSlotHtml(lane: Lane): string {
    if (lane.key !== "goal" || lane.state !== "set") return "";
    return `<figure class="horizon-chart-card is-season is-pending" data-horizon-season aria-busy="true"><div class="hshimmer horizon-chart-skel"></div><div class="horizon-chart-key-skel"></div></figure>`;
  }

  /** The season line for the goal line's slot; "" when there is no line to draw. */
  function seasonHtml(season: ClientHorizonSeason | null): string {
    if (!season || typeof CairnHorizonChart === "undefined") return "";
    const chart = CairnHorizonChart.seasonSvg(season);
    if (!chart) return "";
    // The key names only what the chart drew: the window only beside a goal line, and
    // each diamond hue only when a mark of it is on the lane.
    const body = season.marks.filter((m) => CairnHorizonChart.BODY_MARK_KINDS.has(m.kind)).length;
    const keys = [
      `<span class="horizon-key is-weight">Weight</span>`,
      season.goal_lb != null ? `<span class="horizon-key is-goal">Goal</span>` : "",
      season.goal_lb != null && season.fan ? `<span class="horizon-key is-fan">Likely window</span>` : "",
      season.marks.length > body ? `<span class="horizon-key is-mark">Labs</span>` : "",
      body ? `<span class="horizon-key is-mark is-body">Body scans</span>` : "",
      season.race ? `<span class="horizon-key is-mark is-race">Race day</span>` : "",
    ].join("");
    return `${chart}<figcaption class="horizon-chart-key">${keys}</figcaption>`;
  }

  /** One lane, painted. `enter` gives it the shared settle-in entrance once. */
  function laneHtml(
    lane: Lane,
    opts: { enter?: boolean; hrefFor?: HrefFor; selectedWeek?: string | null } = {}
  ): string {
    const id = `horizonLane-${lane.key}`;
    const cls = ["horizon-lane-card", `is-${lane.key}`, `is-${lane.state}`, opts.enter ? "settle-in is-entering" : ""]
      .filter(Boolean)
      .join(" ");
    const status = lane.state === "unread" ? ` role="status" aria-live="polite"` : "";
    if (lane.voice) {
      // The race build: one serif line, the terrain, the weeks, then the estimate as a footnote.
      return `<section class="${cls} is-build" aria-labelledby="${id}">
        <header class="horizon-lane-head">
          <div class="horizon-lane-kickrow">
            <span class="lbl horizon-lane-kicker">${escHtml(lane.title)}</span>
            ${unitsHtml(lane.ladder?.units === "mi" ? "mi" : "km")}
          </div>
          <h2 class="horizon-lane-title is-voice" id="${id}">${escHtml(lane.voice)}</h2>
          ${lane.lede ? `<p class="horizon-lane-lede">${escHtml(lane.lede)}</p>` : ""}
        </header>
        ${terrainHtml(lane, opts.selectedWeek)}
        ${weeksHtml(lane, opts.selectedWeek)}
        ${fitHtml(lane)}
        ${linksHtml(lane, opts.hrefFor)}
      </section>`;
    }
    // Goal line and labs: a headline, a rail, links (the race build takes the branch above).
    return `<section class="${cls}" aria-labelledby="${id}">
      <header class="horizon-lane-head">
        <span class="lbl horizon-lane-kicker">${escHtml(lane.title)}</span>
        <h2 class="horizon-lane-title" id="${id}"${status}>${escHtml(lane.headline)}</h2>
        ${lane.when ? `<p class="horizon-lane-when numeral">${escHtml(lane.when)}</p>` : ""}
      </header>
      ${fitHtml(lane)}
      ${lane.lede ? `<p class="horizon-lane-lede">${escHtml(lane.lede)}</p>` : ""}
      ${seasonSlotHtml(lane)}
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

  function pillHtml(pill: ClientHorizonWeekPill): string {
    const tick = pill.state === "done" ? `<span class="horizon-pill-tick" aria-label="done">✓</span>` : "";
    const live = pill.state === "live" ? `<span class="horizon-pill-live" aria-hidden="true"></span>` : "";
    return `<span class="horizon-pill is-${pill.stone} is-${pill.state}">${live}${escHtml(pill.text)}${tick}</span>`;
  }

  /** This week, day by day: the server's week line, then a row a day, today washed. */
  function weekHtml(week: ClientHorizonWeek | null, opts: { enter?: boolean } = {}): string {
    if (!week) {
      return `<p class="horizon-week-empty" role="status">This week couldn't be read just now.</p>`;
    }
    const rows = week.days
      .map((day) => {
        // Today's lift is the server's one line, verbatim with its caveat (the Brief's
        // and the plan strip's own words), leading the day as a lift pill would.
        const line =
          day.line && typeof CairnUiReads !== "undefined" ? CairnUiReads.strengthLineHtml(day.line) : "";
        const pills = day.pills.length ? `<div class="horizon-pills">${day.pills.map(pillHtml).join("")}</div>` : "";
        const body =
          pills || line
            ? line
              ? `<div class="horizon-day-body">${line}${pills}</div>`
              : pills
            : `<span class="horizon-rest">Rest</span>`;
        return `<li class="horizon-day${day.today ? " is-today" : ""}"${day.today ? ` aria-current="date"` : ""}>
          <span class="horizon-day-when">${escHtml(day.weekday)}<b>${escHtml(day.day)}</b></span>${body}</li>`;
      })
      .join("");
    // The server's week line, its first sentence as the serif voice and the rest under it.
    const cut = week.line.search(/\.\s+/);
    const voice = cut > 0 ? week.line.slice(0, cut + 1) : week.line;
    const rest = cut > 0 ? week.line.slice(cut + 1).trim() : "";
    return `<div class="horizon-weekview${opts.enter ? " settle-in is-entering" : ""}">
      ${voice ? `<h2 class="horizon-lane-title is-voice horizon-week-voice">${escHtml(voice)}</h2>` : ""}
      ${rest ? `<p class="horizon-lane-lede horizon-week-line">${escHtml(rest)}</p>` : ""}
      <ol class="horizon-days" aria-label="This week, day by day">${rows}</ol>
    </div>`;
  }

  function weekSkeletonHtml(): string {
    const rows = Array.from({ length: 7 }, () => `<div class="hshimmer horizon-skel-day"></div>`).join("");
    return `<div class="horizon-weekview is-pending" aria-busy="true" aria-label="This week">
      <div class="hshimmer horizon-skel-line"></div>${rows}</div>`;
  }

  /** The three views over one line of time: this week, the race build, and the season. */
  const SEGMENTS: ReadonlyArray<readonly [ClientHorizonView, string]> = [
    ["week", "Week"],
    ["race", "To the race"],
    ["season", "Season"],
  ];
  /** Which view each lane sits in. The week view holds no lane: it is its own read. */
  const PANEL: Readonly<Record<Lane["key"], ClientHorizonView>> = { race: "race", goal: "season", labs: "season" };

  function segHtml(active: ClientHorizonView): string {
    const buttons = SEGMENTS.map(
      ([key, label]) =>
        `<button type="button" class="segbtn${key === active ? " active" : ""}" role="tab" id="horizonTab-${key}" aria-controls="horizonPanel-${key}" aria-selected="${key === active}" data-horizon-seg="${key}">${escHtml(label)}</button>`
    ).join("");
    return `<div class="seg horizon-seg" role="tablist" aria-label="Horizon views">${buttons}</div>`;
  }

  /**
   * The timeline's frame: the view switch, then one tab panel per view holding its lane
   * slots, in the timeline's order.
   */
  function shellHtml(active: ClientHorizonView = "race"): string {
    const panels = SEGMENTS.map(([view]) => {
      const hidden = view === active ? "" : " hidden";
      if (view === "week") {
        // The week is read the first time it is SHOWN, so a hidden week panel holds no
        // skeleton: a busy shimmer nobody can see would read as a load that never ends.
        // The controller puts the skeleton in when the view opens.
        return `<div class="horizon-panel" role="tabpanel" id="horizonPanel-week" aria-labelledby="horizonTab-week" data-horizon-panel="week"${hidden}><div data-horizon-weekview>${hidden ? "" : weekSkeletonHtml()}</div></div>`;
      }
      const lanes = KEYS.filter((key) => PANEL[key] === view)
        .map((key) => `<li class="horizon-lane" data-horizon-lane="${key}">${laneSkeletonHtml(key)}</li>`)
        .join("");
      return `<div class="horizon-panel" role="tabpanel" id="horizonPanel-${view}" aria-labelledby="horizonTab-${view}" data-horizon-panel="${view}"${hidden}><ol class="horizon-lanes" aria-label="What's ahead">${lanes}</ol></div>`;
    }).join("");
    return `<div class="horizon" data-horizon data-horizon-view="${active}">
      ${segHtml(active)}
      ${panels}
    </div>`;
  }

  const CAIRN_HORIZON = { KEYS, PANEL, laneHtml, laneSkeletonHtml, seasonHtml, weekHtml, weekSkeletonHtml, shellHtml };

  Object.assign(globalThis, { CairnHorizon: CAIRN_HORIZON });
}
