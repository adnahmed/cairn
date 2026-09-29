// @ts-check
// The race build as terrain (docs/DESIGN.md "Charts: instruments drawn to scale"), and
// the small drawing kit Horizon's two charts share (day arithmetic, mono dates, the
// ridge curve, a tidy axis). The chart itself: the closed weeks the log holds in a
// quieter ink ridge, the ladder's weekly volume over a quiet wash, a long-run dash per
// week, the dawn "now" line whose solid foot is this week's running so far, the stage
// ribbon under the ground, selective labels (this week and the peak), and race day as
// the endurance marker. One axis, in the athlete's run units; the engine's kilometres
// are only converted, never re-derived. Pure strings from shaped data; every caller
// word that reaches the SVG goes through escHtml, and the colors are CSS variables so
// the chart follows the theme without a repaint. horizon-chart-client re-exports it.
{
  type Terrain = ClientHorizonTerrain;

  const DAY = 86400000;
  const KM_PER_MILE = 1.609344;
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
    // Miles run about 0.6 of the kilometres, so a small week steps by 5: three or four
    // hairlines whichever the unit, never one lonely line across the whole chart.
    const step = max > 60 ? 20 : max > 24 ? 10 : 5;
    // A little headroom, so the peak and its label never sit on the top line.
    return { top: Math.max(step * 2, Math.ceil((max * 1.06) / step) * step), step };
  }

  // ---- terrain ----------------------------------------------------------------

  /** A per-chart id suffix, so two terrains on one page never share a clip path. */
  let clipSeq = 0;

  /** The terrain's frame (viewBox units): exported so the loading shape holds the same box. */
  const TERRAIN = { W: 340, H: 178 } as const;

  /** Rough mono label width at 6.8px, so a stage name only prints where it fits. */
  const monoWidth = (text: string): number => text.length * 4.3 + 6;
  /** The ribbon's own short words: a band is often one week wide. */
  const RIBBON_WORD: Readonly<Record<string, string>> = { "Down week": "Down" };
  /**
   * A one-week band at 390px is ~22 units wide, too narrow for PEAK or TAPER: the band
   * still says its stage in the plan's own shorthand, and past that in its initial, so
   * the turning points the ribbon is for are never blank tiles.
   */
  const RIBBON_SHORT: Readonly<Record<string, string>> = {
    Logged: "LOG",
    Base: "BSE",
    Build: "BLD",
    Sharpen: "SHP",
    Peak: "PK",
    "Down week": "DN",
    Taper: "TPR",
    Race: "R",
  };
  /** The longest of a stage's words that fits a band, or "" when not even its initial does. */
  function ribbonWord(label: string, width: number): string {
    const full = (RIBBON_WORD[label] || label).toUpperCase();
    const short = (RIBBON_SHORT[label] || "").toUpperCase();
    for (const word of [full, short, full.charAt(0)]) if (word && monoWidth(word) <= width) return word;
    return "";
  }

  /**
   * The race build as terrain (docs/DESIGN.md "Charts"): one axis, distance per week in
   * the athlete's units.
   *
   *   - the ridge: the ladder's weekly volume, a smooth line over a quiet wash, the closed
   *     weeks the log holds drawn before it in ink (quieter), so logged and planned read
   *     as one line that changes voice where the log ends;
   *   - long-run ticks: a short dash per ladder week at its long run (the same unit, the
   *     same axis: a long run is part of the week's volume);
   *   - now: the dawn line at today, whose solid foot is what the log already holds this
   *     week against the ridge's planned week above it;
   *   - the stage ribbon under the ground: Base / Build / Sharpen / Peak / Taper / Race
   *     week as bands, the current one deeper, each named where it fits;
   *   - race day as the endurance marker, with its short name.
   *
   * Labels are selective (this week and the peak, never a number on every week); every
   * week still speaks through its hit target's title and the aria label, and the race
   * page's ladder is the table view.
   */
  function terrainSvg(terrain: Terrain, opts: { selected?: string | null } = {}): string {
    const weeks = (terrain?.weeks || []).filter((w) => Number.isFinite(dayNum(w.week_start)));
    const ahead = weeks.filter((w) => !w.logged);
    if (ahead.length < 2) return "";
    const { W, H } = TERRAIN;
    const L = 26;
    const R = 334;
    const base = 138;
    const ceil = 40;
    const ribbonTop = base + 7;
    const ribbonH = 15;
    const first = dayNum(weeks[0].week_start);
    const raceDay = Number.isFinite(dayNum(terrain.race_date))
      ? dayNum(terrain.race_date)
      : dayNum(weeks[weeks.length - 1].week_start) + 6;
    // The chart ends the day after the race: when race day falls inside the last week,
    // that week's unused days past it are not drawn as empty ground.
    const lastStart = dayNum(weeks[weeks.length - 1].week_start);
    const end = raceDay >= lastStart && raceDay < lastStart + 7 ? raceDay + 1 : Math.max(raceDay + 1, lastStart + 7);
    const X = (n: number): number => L + ((n - first) / (end - first)) * (R - L);
    // The engine's kilometres, drawn in the athlete's run units.
    const mi = terrain.units === "mi";
    const unit = mi ? "mi" : "km";
    const conv = (k: unknown): number => Math.max(0, Number(k) || 0) / (mi ? KM_PER_MILE : 1);
    const km = (w: ClientHorizonTerrainWeek): number => conv(w.km);
    const maxKm = Math.max(...weeks.map(km));
    const { top, step } = axisTop(maxKm);
    const Y = (k: number): number => base - (k / top) * (base - ceil);
    // A week stands at its middle; race week stands between its Monday and race day, so
    // the ridge always comes down onto the race line, never past it.
    const mid = (w: ClientHorizonTerrainWeek): number => {
      const start = dayNum(w.week_start);
      return X(raceDay < start + 7 ? start + Math.max(0.5, (raceDay - start) / 2) : start + 3.5);
    };
    const weekEnd = (w: ClientHorizonTerrainWeek): number => X(Math.min(end, dayNum(w.week_start) + 7));

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
      g += `<defs><clipPath id="${clip}-log"><rect x="0" y="0" width="${fx(split as number)}" height="${H}"/></clipPath><clipPath id="${clip}-plan"><rect x="${fx(split as number)}" y="0" width="${fx(W - (split as number))}" height="${H}"/></clipPath></defs>`;
    }
    // Recessive grid: solid hairlines, the axis numbers in mono beside them.
    for (let k = step; k <= top; k += step) {
      g += `<line class="hz-grid" x1="${L}" x2="${R}" y1="${fx(Y(k))}" y2="${fx(Y(k))}"/><text class="hz-axis" x="${L - 5}" y="${fx(Y(k) + 3)}" text-anchor="end">${k}</text>`;
    }
    g += `<line class="hz-base" x1="${L}" x2="${R}" y1="${fx(Y(0))}" y2="${fx(Y(0))}"/>`;
    g += `<text class="hz-axis" x="${L}" y="12">${mi ? "MI" : "KM"} PER WEEK</text>`;
    // The wash stands on the week the chart points at (this week unless another is picked).
    const selected =
      (opts.selected ? ahead.find((w) => w.week_start === opts.selected) : null) ||
      (opts.selected === "" ? null : ahead.find((w) => w.current) || null);
    if (selected) {
      const a = X(dayNum(selected.week_start));
      g += `<rect class="hz-wash" x="${fx(a)}" y="${ceil - 10}" width="${fx(weekEnd(selected) - a)}" height="${fx(Y(0) - ceil + 10)}" rx="6"/>`;
    }
    const withClip = (cls: string, d: string, part: "log" | "plan" | ""): string =>
      `<path class="${cls}" d="${d}"${part && clip ? ` clip-path="url(#${clip}-${part})"` : ""}/>`;
    const contour = ridge(pts.map(([x, y]): [number, number] => [x, Y(0) - (Y(0) - y) * 0.5]));
    if (clip) {
      g += withClip("hz-terrain-fill is-logged", `${ridgeD} Z`, "log");
      g += withClip("hz-terrain-fill", `${ridgeD} Z`, "plan");
      g += withClip("hz-contour", contour, "plan");
      g += withClip("hz-terrain-line is-logged", ridgeD, "log");
      g += withClip("hz-terrain-line", ridgeD, "plan");
    } else {
      g += withClip("hz-terrain-fill", `${ridgeD} Z`, "");
      g += withClip("hz-contour", contour, "");
      g += withClip("hz-terrain-line", ridgeD, "");
    }
    // Long-run ticks: one short dash per ladder week, at its long run.
    for (const w of ahead) {
      const long = conv(w.long_km);
      if (!(long > 0)) continue;
      const x = mid(w);
      g += `<line class="hz-long" x1="${fx(x - 5)}" x2="${fx(x + 5)}" y1="${fx(Y(long))}" y2="${fx(Y(long))}"/>`;
    }
    // The stage ribbon: consecutive weeks of one stage as one band.
    const bands: Array<{ label: string; a: number; b: number; current: boolean; logged: boolean }> = [];
    for (const w of weeks) {
      const label = w.logged ? "Logged" : String(w.stage || "");
      const a = X(dayNum(w.week_start));
      // Race week's band stops at the race line: nothing of the build lies past race day.
      const b = w === weeks[weeks.length - 1] ? Math.min(X(end), X(raceDay) + 1) : weekEnd(w);
      const last = bands[bands.length - 1];
      if (last && last.label === label) {
        last.b = b;
        last.current ||= !!w.current;
      } else bands.push({ label, a, b, current: !!w.current, logged: !!w.logged });
    }
    for (const band of bands) {
      if (!band.label) continue;
      // A 2px surface gap between neighbouring bands, never a stroke around them.
      const a = band.a + 1;
      const width = Math.max(1, band.b - band.a - 2);
      const cls = ["hz-stage", band.logged ? "is-logged" : "", band.current ? "is-current" : ""]
        .filter(Boolean)
        .join(" ");
      g += `<rect class="${cls}" x="${fx(a)}" y="${ribbonTop}" width="${fx(width)}" height="${ribbonH}" rx="4"/>`;
      const word = ribbonWord(band.label, width);
      if (word) {
        const tone = band.current ? " is-current" : band.logged ? " is-logged" : "";
        g += `<text class="hz-stage-word${tone}" x="${fx(a + width / 2)}" y="${fx(ribbonTop + 10)}" text-anchor="middle">${escHtml(word)}</text>`;
      }
    }
    // Selective labels: this week's planned volume, and the peak.
    const nowDay = dayNum(terrain.as_of);
    const nowX = Number.isFinite(nowDay) && nowDay >= first && nowDay <= end ? X(nowDay) : null;
    const peak = ahead.reduce((best, w) => (km(w) > km(best) ? w : best), ahead[0]);
    const current = ahead.find((w) => w.current) || null;
    const labelled = new Set<ClientHorizonTerrainWeek>([...(current ? [current] : []), peak]);
    for (const w of labelled) {
      const raw = mid(w);
      // A number the now line would cross steps to the side of it that has more room.
      const nearNow = nowX != null && Math.abs(raw - nowX) < 14;
      const x = nearNow ? (raw >= (nowX as number) ? (nowX as number) + 13 : (nowX as number) - 13) : raw;
      const hug = X(raceDay) - x < 16;
      const word = w === peak && w !== current ? `peak ${kmWord(km(w))}` : kmWord(km(w));
      g += `<text class="hz-num${w === peak ? " is-peak" : ""}" x="${fx(hug ? x - 4 : x)}" y="${fx(Y(km(w)) - 7)}" text-anchor="${hug ? "end" : "middle"}">${escHtml(word)}</text>`;
    }
    if (nowX != null) {
      const nx = nowX;
      g += `<line class="hz-now" x1="${fx(nx)}" x2="${fx(nx)}" y1="${ceil - 14}" y2="${fx(Y(0))}"/>`;
      // The now line's solid foot: this week's running so far, against the planned week.
      const so = conv(current?.logged_km);
      if (current && so > 0) {
        const y = Math.min(Y(0) - 3, Y(so));
        g += `<rect class="hz-sofar" x="${fx(nx - 2.5)}" y="${fx(y)}" width="5" height="${fx(Y(0) - y)}" rx="2.5"/>`;
      }
      g += `<text class="hz-now-word" x="${fx(nx + 4)}" y="${ceil - 8}">now</text>`;
    }
    const rx = X(raceDay);
    g += `<line class="hz-race" x1="${fx(rx)}" x2="${fx(rx)}" y1="18" y2="${fx(ribbonTop + ribbonH)}"/><text class="hz-race-word" x="${fx(rx)}" y="12" text-anchor="end">${escHtml(terrain.race_label)}</text>`;
    // Mono dates under the ribbon: the first Monday, one between, race day last.
    const dateY = ribbonTop + ribbonH + 13;
    const ticks = new Set<number>([0, Math.round((weeks.length - 1) / 2)]);
    for (const i of ticks) {
      const x = X(dayNum(weeks[i].week_start));
      // The race date is written leftward from the race line; a tick needs room for both.
      if (rx - x < 80) continue;
      g += `<text class="hz-axis" x="${fx(x)}" y="${fx(dateY)}">${escHtml(monoDate(weeks[i].week_start))}</text>`;
    }
    g += `<text class="hz-axis" x="${fx(rx)}" y="${fx(dateY)}" text-anchor="end">${escHtml(monoDate(terrain.race_date || isoOf(raceDay)))}</text>`;
    // Hit targets: every week answers a hover with its own numbers.
    const weekWords = (w: ClientHorizonTerrainWeek): string => {
      const long = conv(w.long_km);
      const so = conv(w.logged_km);
      return [
        `${monoDate(w.week_start)}`,
        w.logged ? "logged" : String(w.stage || ""),
        `${kmWord(km(w))} ${unit}`,
        long > 0 ? `long run ${kmWord(long)} ${unit}` : "",
        w.current && so > 0 ? `${kmWord(so)} ${unit} run so far` : "",
      ]
        .filter(Boolean)
        .join(" · ");
    };
    for (const w of weeks) {
      const a = X(dayNum(w.week_start));
      const b = w === weeks[weeks.length - 1] ? X(end) : weekEnd(w);
      g += `<rect class="hz-hit" x="${fx(a)}" y="${ceil - 10}" width="${fx(Math.max(1, b - a))}" height="${fx(ribbonTop + ribbonH - ceil + 10)}"><title>${escHtml(weekWords(w))}</title></rect>`;
    }
    const logged = weeks.filter((w) => w.logged);
    const label = [
      logged.length
        ? `Logged: ${logged.map((w) => `${monoDate(w.week_start)} ${kmWord(km(w))} ${unit}`).join(", ")}`
        : "",
      `${mi ? "Miles" : "Kilometres"} per week to race day: ${ahead.map(weekWords).join("; ")}`,
    ]
      .filter(Boolean)
      .join(". ");
    return `<svg class="hz-chart hz-terrain" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escAttr(label)}">${g}</svg>`;
  }

  /** The terrain's key: only what it drew (logged weeks, long runs, this week's run so far). */
  function terrainKeyHtml(terrain: Terrain | null | undefined): string {
    const weeks = terrain?.weeks || [];
    const ahead = weeks.filter((w) => !w.logged);
    if (ahead.length < 2) return "";
    const unit = terrain?.units === "mi" ? "mi" : "km";
    const keys = [
      `<span class="horizon-key is-volume">Weekly ${unit}</span>`,
      ahead.some((w) => Number(w.long_km) > 0) ? `<span class="horizon-key is-long">Long run</span>` : "",
      weeks.some((w) => w.logged) ? `<span class="horizon-key is-logged">Logged</span>` : "",
      ahead.some((w) => w.current && Number(w.logged_km) > 0)
        ? `<span class="horizon-key is-sofar">Run so far</span>`
        : "",
    ].join("");
    return `<figcaption class="horizon-chart-key">${keys}</figcaption>`;
  }

  const CAIRN_HORIZON_TERRAIN = { TERRAIN, terrainSvg, terrainKeyHtml, fx, dayNum, isoOf, monoDate, kmWord };

  Object.assign(globalThis, { CairnHorizonTerrain: CAIRN_HORIZON_TERRAIN });
}
