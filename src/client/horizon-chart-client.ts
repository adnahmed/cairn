// @ts-check
// The Horizon instruments (docs/DESIGN.md "Charts: instruments drawn to scale"): two SVG
// charts drawn to scale.
//
//   - terrainSvg: the race build as terrain. The closed weeks the log holds (quieter,
//     ink), then every ladder week's kilometres, a smooth ridge with two quieter contour
//     lines under it, the km written over each week, the peak and the taper named on
//     the ground, a dawn "now" line, the open week washed, and race day as a dashed
//     endurance line.
//   - seasonSvg: the season's weight line. The weigh-ins since the window opened, the
//     goal as a dashed body-colored line, the server's projection window as a fan from
//     the latest weigh-in to the goal, and a lane of dated diamonds under it: draws and
//     scans behind (filled), rechecks ahead (open), race day (endurance). The latest
//     weigh-in says "now" only when it is today's; an older one wears its own date, and
//     past FAN_ANCHOR_DAYS the fan no longer leaves it (the window lies on the goal line
//     alone), so a stale weight is never drawn as the current one.
//
// Pure strings from shaped data; nothing here judges a pace or a fit. Every caller
// word that reaches the SVG goes through escHtml. Axis labels are mono and small, the
// annotations take a stone's deep color, and the colors are CSS variables, so the
// charts follow the theme without a repaint.
{
  type Terrain = ClientHorizonTerrain;
  type Season = ClientHorizonSeason;

  const DAY = 86400000;
  /** How old the latest weigh-in may be and still anchor the projection fan. */
  const FAN_ANCHOR_DAYS = 3;
  /** How far past the season's own end (today, goal, window, race) a mark may widen it. */
  const MARK_REACH_DAYS = 30;
  /** Mark kinds drawn in the body hue (a scan of the body), not the labs' heart. */
  const BODY_MARK_KINDS: ReadonlySet<string> = new Set(["dexa", "rescan"]);
  const fx = (n: number): string => (Math.round(n * 10) / 10).toString();

  function dayNum(iso: string): number {
    const t = Date.parse(`${String(iso).slice(0, 10)}T12:00:00Z`);
    return Number.isFinite(t) ? Math.round(t / DAY) : Number.NaN;
  }

  function isoOf(n: number): string {
    return new Date(n * DAY).toISOString().slice(0, 10);
  }

  /** "SEP 21": the mono axis date. */
  function monoDate(iso: string): string {
    const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).toUpperCase();
  }

  function monoMonth(iso: string): string {
    const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }).toUpperCase();
  }

  function kmWord(km: number): string {
    return String(Math.round(km * 10) / 10);
  }

  /** A ridge through the points: horizontal-tangent cubics, so a flat week stays flat. */
  function ridge(points: ReadonlyArray<readonly [number, number]>): string {
    let d = `M${fx(points[0][0])},${fx(points[0][1])}`;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      const m = (a[0] + b[0]) / 2;
      d += ` C${fx(m)},${fx(a[1])} ${fx(m)},${fx(b[1])} ${fx(b[0])},${fx(b[1])}`;
    }
    return d;
  }

  /** Round a maximum up to a tidy axis top, and the step between gridlines. */
  function axisTop(max: number): { top: number; step: number } {
    const step = max > 60 ? 20 : 10;
    return { top: Math.max(step * 2, Math.ceil(max / step) * step), step };
  }

  // ---- terrain ----------------------------------------------------------------

  /** A per-chart id suffix, so two terrains on one page never share a clip path. */
  let clipSeq = 0;

  function terrainSvg(terrain: Terrain, opts: { selected?: string | null } = {}): string {
    const weeks = (terrain?.weeks || []).filter((w) => Number.isFinite(dayNum(w.week_start)));
    const ahead = weeks.filter((w) => !w.logged);
    if (ahead.length < 2) return "";
    const W = 340;
    const L = 28;
    const R = 332;
    const base = 146;
    const ceil = 42;
    const first = dayNum(weeks[0].week_start);
    const raceDay = Number.isFinite(dayNum(terrain.race_date))
      ? dayNum(terrain.race_date)
      : dayNum(weeks[weeks.length - 1].week_start) + 6;
    // The chart ends the day after the race: when race day falls inside the last week,
    // that week's unused days past it are not drawn as empty ground.
    const lastStart = dayNum(weeks[weeks.length - 1].week_start);
    const end = raceDay >= lastStart && raceDay < lastStart + 7 ? raceDay + 1 : Math.max(raceDay + 1, lastStart + 7);
    const X = (n: number): number => L + ((n - first) / (end - first)) * (R - L);
    const km = (w: ClientHorizonTerrainWeek): number => Math.max(0, Number(w.km) || 0);
    const maxKm = Math.max(...weeks.map(km));
    const { top, step } = axisTop(maxKm);
    const Y = (k: number): number => base - (k / top) * (base - ceil);
    // A week stands at its middle; race week stands between its Monday and race day, so
    // the ridge always comes down onto the race line, never past it.
    const mid = (w: ClientHorizonTerrainWeek): number => {
      const start = dayNum(w.week_start);
      return X(raceDay < start + 7 ? start + Math.max(0.5, (raceDay - start) / 2) : start + 3.5);
    };

    const pts: Array<[number, number]> = [
      [X(first), Y(0)],
      ...weeks.map((w): [number, number] => [mid(w), Y(km(w))]),
      [X(raceDay), Y(0)],
    ];
    const ridgeD = ridge(pts);
    // Where the log ends and the ladder begins: the logged weeks' ridge is drawn quieter.
    const split = ahead.length < weeks.length ? X(dayNum(ahead[0].week_start)) : null;
    const clip = split != null ? `hzT${++clipSeq}` : "";
    let g = "";
    if (clip) {
      g += `<defs><clipPath id="${clip}-log"><rect x="0" y="0" width="${fx(split as number)}" height="166"/></clipPath><clipPath id="${clip}-plan"><rect x="${fx(split as number)}" y="0" width="${fx(W - (split as number))}" height="166"/></clipPath></defs>`;
    }
    for (let k = step; k <= top; k += step) {
      g += `<line class="hz-grid" x1="${L}" x2="${R}" y1="${fx(Y(k))}" y2="${fx(Y(k))}"/><text class="hz-axis" x="${L - 5}" y="${fx(Y(k) + 3)}" text-anchor="end">${k}</text>`;
    }
    g += `<text class="hz-axis" x="${L}" y="12">KM PER WEEK</text>`;
    // The wash stands on the week the rows below hold open (this week unless another is picked).
    const selected =
      (opts.selected ? ahead.find((w) => w.week_start === opts.selected) : null) ||
      (opts.selected === "" ? null : ahead.find((w) => w.current) || null);
    if (selected) {
      const a = X(dayNum(selected.week_start));
      const b = X(Math.min(end, dayNum(selected.week_start) + 7));
      g += `<rect class="hz-wash" x="${fx(a)}" y="${ceil - 8}" width="${fx(b - a)}" height="${fx(Y(0) - ceil + 8)}" rx="6"/>`;
    }
    const withClip = (cls: string, d: string, part: "log" | "plan" | ""): string =>
      `<path class="${cls}" d="${d}"${part && clip ? ` clip-path="url(#${clip}-${part})"` : ""}/>`;
    const contours = [0.66, 0.36].map((k) => ridge(pts.map(([x, y]): [number, number] => [x, Y(0) - (Y(0) - y) * k])));
    if (clip) {
      g += withClip("hz-terrain-fill is-logged", `${ridgeD} Z`, "log");
      g += withClip("hz-terrain-fill", `${ridgeD} Z`, "plan");
      for (const d of contours) g += withClip("hz-contour", d, "plan");
      g += withClip("hz-terrain-line is-logged", ridgeD, "log");
      g += withClip("hz-terrain-line", ridgeD, "plan");
    } else {
      g += withClip("hz-terrain-fill", `${ridgeD} Z`, "");
      for (const d of contours) g += withClip("hz-contour", d, "");
      g += withClip("hz-terrain-line", ridgeD, "");
    }
    // The km over each week; a long build writes every other week, never the current one skipped.
    const every = weeks.length > 12 ? 2 : 1;
    const nowDay = dayNum(terrain.as_of);
    const nowX = Number.isFinite(nowDay) && nowDay >= first && nowDay <= end ? X(nowDay) : null;
    weeks.forEach((w, i) => {
      if (i % every && !w.current && i !== weeks.length - 1) return;
      // A number the now line would cross steps to the side of it that has more room.
      const raw = mid(w);
      const nearNow = nowX != null && Math.abs(raw - nowX) < 16;
      const x = nearNow ? (raw >= (nowX as number) ? (nowX as number) + 15 : (nowX as number) - 15) : raw;
      const hug = X(raceDay) - x < 14;
      const cls = w.logged ? "hz-num is-logged" : "hz-num";
      g += `<text class="${cls}" x="${fx(hug ? x - 4 : x)}" y="${fx(Y(km(w)) - 7)}" text-anchor="${hug ? "end" : "middle"}">${escHtml(kmWord(km(w)))}</text>`;
    });
    // The build's turning points named on the ground: the peak and the taper.
    for (const kind of ["peak", "taper"] as const) {
      const w = ahead.find((week) => week.kind === kind);
      if (!w || Y(km(w)) > Y(0) - 22) continue;
      g += `<text class="hz-kind" x="${fx(mid(w))}" y="${fx(Y(0) - 6)}" text-anchor="middle">${kind.toUpperCase()}</text>`;
    }
    if (nowX != null) {
      const nx = nowX;
      g += `<line class="hz-now" x1="${fx(nx)}" x2="${fx(nx)}" y1="${ceil - 14}" y2="${fx(Y(0))}"/><text class="hz-now-word" x="${fx(nx + 4)}" y="${ceil - 8}">now</text>`;
    }
    const rx = X(raceDay);
    g += `<line class="hz-race" x1="${fx(rx)}" x2="${fx(rx)}" y1="18" y2="${fx(Y(0))}"/><text class="hz-race-word" x="${fx(rx)}" y="12" text-anchor="end">${escHtml(terrain.race_label)}</text>`;
    // Mono dates under the ground: the first Monday, two between, race day last.
    const ticks = new Set<number>([0, Math.round((weeks.length - 1) / 3), Math.round(((weeks.length - 1) * 2) / 3)]);
    for (const i of ticks) {
      const x = X(dayNum(weeks[i].week_start));
      // The race date is written leftward from the race line; a tick needs room for both.
      if (rx - x < 76) continue;
      g += `<text class="hz-axis" x="${fx(x)}" y="${fx(Y(0) + 14)}">${escHtml(monoDate(weeks[i].week_start))}</text>`;
    }
    g += `<text class="hz-axis" x="${fx(rx)}" y="${fx(Y(0) + 14)}" text-anchor="end">${escHtml(monoDate(terrain.race_date || isoOf(raceDay)))}</text>`;
    const logged = weeks.filter((w) => w.logged);
    const label = [
      logged.length ? `Logged: ${logged.map((w) => `${monoDate(w.week_start)} ${kmWord(km(w))} km`).join(", ")}` : "",
      `Kilometres per week to race day: ${ahead.map((w) => `${monoDate(w.week_start)} ${kmWord(km(w))} km`).join(", ")}`,
    ]
      .filter(Boolean)
      .join(". ");
    return `<svg class="hz-chart hz-terrain" viewBox="0 0 ${W} 166" role="img" aria-label="${escAttr(label)}">${g}</svg>`;
  }

  // ---- season -----------------------------------------------------------------

  function seasonSvg(season: Season): string {
    const points = (season?.points || []).filter((p) => Number.isFinite(dayNum(p.date)) && Number.isFinite(p.lb));
    if (points.length < 2) return "";
    const W = 340;
    const L = 28;
    const R = 332;
    const top = 22;
    const bottom = 132;
    const lane = 152;
    const today = dayNum(season.today);
    const first = dayNum(points[0].date);
    // The span is the season's own: the weigh-ins, today, the goal, the window and race
    // day. A mark may widen it by MARK_REACH_DAYS at most; one further out (a recheck
    // months away) is pinned at the right edge, so it never squeezes the weight line.
    const edges = [today, dayNum(points[points.length - 1].date)];
    if (season.goal_date) edges.push(dayNum(season.goal_date));
    if (season.fan) edges.push(dayNum(season.fan.end));
    if (season.race) edges.push(dayNum(season.race.date));
    const core = Math.max(...edges.filter(Number.isFinite));
    const reach = season.marks.map((m) => dayNum(m.date)).filter((n) => Number.isFinite(n) && n <= core + MARK_REACH_DAYS);
    const x0 = first;
    const x1 = Math.max(core, ...reach) + 4;
    const X = (n: number): number => L + ((n - x0) / Math.max(1, x1 - x0)) * (R - L);
    const lbs = points.map((p) => p.lb);
    if (season.goal_lb != null) lbs.push(season.goal_lb);
    const lo = Math.floor(Math.min(...lbs) - 1.5);
    const hi = Math.ceil(Math.max(...lbs) + 1.5);
    const Y = (lb: number): number => top + ((hi - lb) / Math.max(1, hi - lo)) * (bottom - top);

    let g = "";
    // Month rules, labelled in mono; a long season labels every other month.
    const months: string[] = [];
    const start = new Date(isoOf(x0));
    const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1, 12));
    while (dayNum(cursor.toISOString()) <= x1) {
      months.push(cursor.toISOString().slice(0, 10));
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    const monthEvery = months.length > 6 ? 2 : 1;
    months.forEach((m, i) => {
      const x = X(dayNum(m));
      g += `<line class="hz-rule" x1="${fx(x)}" x2="${fx(x)}" y1="${top - 6}" y2="${lane + 8}"/>`;
      if (i % monthEvery === 0 && R - x > 18)
        g += `<text class="hz-axis" x="${fx(x + 3)}" y="${lane + 22}">${escHtml(monoMonth(m))}</text>`;
    });
    // Three weight ticks across the span.
    const span = hi - lo;
    const tick = span > 24 ? 10 : 5;
    for (let w = Math.ceil(lo / tick) * tick; w <= hi; w += tick) {
      if (Y(w) < top - 2 || Y(w) > bottom + 2) continue;
      g += `<text class="hz-axis" x="${L - 5}" y="${fx(Y(w) + 3)}" text-anchor="end">${w}</text>`;
    }
    const last = points[points.length - 1];
    const nx = X(dayNum(last.date));
    const ny = Y(last.lb);
    const age = Number.isFinite(today) ? today - dayNum(last.date) : Number.POSITIVE_INFINITY;
    // A weigh-in dated a day ahead of the device's today (a timezone edge) is still today's.
    const isToday = age <= 0;
    if (season.goal_lb != null) {
      const gy = Y(season.goal_lb);
      const goalWord = [kmWord(season.goal_lb), season.goal_date ? CairnUiChart.dateLabel(season.goal_date) : ""]
        .filter(Boolean)
        .join(" · ");
      g += `<line class="hz-goal" x1="${L}" x2="${R}" y1="${fx(gy)}" y2="${fx(gy)}"/><text class="hz-goal-word" x="${R}" y="${fx(gy + 13)}" text-anchor="end">${escHtml(goalWord)}</text>`;
      if (season.fan) {
        const fa = X(dayNum(season.fan.start));
        const fb = X(dayNum(season.fan.end));
        const fm = (fa + fb) / 2;
        g +=
          age <= FAN_ANCHOR_DAYS
            ? `<path class="hz-fan" d="M${fx(nx)},${fx(ny)} L${fx(fa)},${fx(gy)} L${fx(fb)},${fx(gy)}Z"/><line class="hz-fan-line" x1="${fx(nx)}" y1="${fx(ny)}" x2="${fx(fm)}" y2="${fx(gy)}"/>`
            : `<rect class="hz-fan is-window" x="${fx(fa)}" y="${fx(gy - 4)}" width="${fx(Math.max(2, fb - fa))}" height="8" rx="4"/>`;
      }
    }
    const line = points.map((p, i) => `${i ? "L" : "M"}${fx(X(dayNum(p.date)))},${fx(Y(p.lb))}`).join("");
    g += `<path class="hz-weight" d="${line}"/>`;
    const firstP = points[0];
    g += `<text class="hz-num" x="${fx(X(dayNum(firstP.date)) + 4)}" y="${fx(Y(firstP.lb) - 7)}">${escHtml(kmWord(firstP.lb))}</text>`;
    const todayWord = `${kmWord(last.lb)} ${isToday ? "now" : `· ${monoDate(last.date)}`}`;
    // The label sits above and to the right of the latest dot, where the fan leaves room;
    // near the right edge it steps to the left, under the line.
    const roomRight = R - nx > 64;
    const dot = isToday ? "hz-today" : "hz-today is-past";
    g += `<circle class="${dot}" cx="${fx(nx)}" cy="${fx(ny)}" r="4.5"/><text class="${isToday ? "hz-today-word" : "hz-today-word is-past"}" x="${fx(roomRight ? nx + 8 : nx - 8)}" y="${fx(roomRight ? ny - 9 : ny + 16)}" text-anchor="${roomRight ? "start" : "end"}">${escHtml(todayWord)}</text>`;
    // The lane of diamonds: labs and scans behind (filled), ahead (open), race day.
    g += `<line class="hz-lane" x1="${L}" x2="${R}" y1="${lane}" y2="${lane}"/>`;
    const diamond = (x: number, cls: string): string =>
      `<rect class="${cls}" x="${fx(x - 3.6)}" y="${fx(lane - 3.6)}" width="7.2" height="7.2" transform="rotate(45 ${fx(x)} ${lane})"/>`;
    for (const m of season.marks) {
      const n = dayNum(m.date);
      if (!Number.isFinite(n) || n < x0) continue;
      const beyond = n > x1;
      const body = BODY_MARK_KINDS.has(m.kind) ? " is-body" : "";
      g += diamond(beyond ? R : X(n), `hz-mark is-${m.side} is-kind-${m.kind.replace(/[^a-z0-9_-]/gi, "")}${body}${beyond ? " is-beyond" : ""}`);
    }
    if (season.race) g += diamond(X(dayNum(season.race.date)), "hz-mark is-race");
    if (Number.isFinite(today) && today >= x0 && today <= x1) {
      const tx = X(today);
      g += `<line class="hz-now" x1="${fx(tx)}" x2="${fx(tx)}" y1="${lane - 9}" y2="${lane + 9}"/>`;
    }
    const aria = [
      `Weight from ${kmWord(firstP.lb)} to ${kmWord(last.lb)} lb${isToday ? " today" : ` on ${monoDate(last.date)}`}`,
      season.goal_lb != null ? `goal ${kmWord(season.goal_lb)} lb` : "",
      season.marks.length ? `${season.marks.length} labs and scans on the line` : "",
    ]
      .filter(Boolean)
      .join(", ");
    return `<svg class="hz-chart hz-season" viewBox="0 0 ${W} 180" role="img" aria-label="${escAttr(aria)}">${g}</svg>`;
  }

  const CAIRN_HORIZON_CHART = { BODY_MARK_KINDS, FAN_ANCHOR_DAYS, terrainSvg, seasonSvg };

  Object.assign(globalThis, { CairnHorizonChart: CAIRN_HORIZON_CHART });
}
