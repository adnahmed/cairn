// @ts-check
// Fuel — today so far (docs/V2-PLAN.md wave 2, "fuel-today"). The view: protein
// first as the anchor, then energy, carbs, fat and fiber, each a number with its unit and never
// a score; the day's state in words ("in progress" — never "low"); the athlete's own
// observed intake band in the server's words when there is one; and, today only, the
// quiet big-day and carb-range lines. Pure renderers over CairnFuelTodayModel.
{
  type Model = ClientFuelTodayModel;

  // ---------- the big-day fuel line ----------
  // A flat target lands the same on a long-run day and a rest day. When the server's
  // read (repo/fuel-demand.ts) says today carries the week's bigger work, the card
  // says ONE quiet sentence about shape. BIG DAYS ONLY, TODAY ONLY (the model drops
  // the read on a past day), and the number never moves. Rotates per date.
  const DEMAND_LONG_RUN = [
    "Today carries the long run — carbs earn their place around it. The target itself stays where it is.",
    "The long run is today's big piece; carb-forward around it tends to sit well. Same target, different shape.",
    "Long run today — a good day for carbs to lead, with the daily target unchanged.",
    "Today's long run is the work that asks for fuel; carbs around it, and the number stays as it is.",
  ];
  const DEMAND_QUALITY_RUN = [
    "There's quality running in today — carbs around it tend to make it feel better. The target itself doesn't move.",
    "Today's fast work asks a little more of fuel; carb-forward around it, same daily target.",
    "Quality run today — a good day for carbs to lead, with the target unchanged.",
    "Hard running lands today; carbs around it is the natural shape, and the number stays as it is.",
  ];
  const DEMAND_HEAVY_LOWER = [
    "Heavy lower work today — carbs around it are the easy win. The target stays where it is.",
    "Today leans heavy through the legs; carb-forward around the session, same daily target.",
    "Legs carry today's load — a good day for carbs to lead, with the target unchanged.",
    "Today's the heavier leg day; carbs around it, and the number stays as it is.",
  ];
  const DEMAND_DOUBLE = [
    "Lifting and running both land today — carbs around them, with the target unchanged.",
    "Today's a double; carb-forward around both pieces, same daily target.",
    "Two sessions share today — a good day for carbs to lead. The target stays where it is.",
    "Strength and a run in one day; carbs around the work, and the number stays as it is.",
  ];
  const DEMAND_GENERIC = [
    "Today carries more work than an ordinary day — a good day for carbs to lead, with the target unchanged.",
    "Bigger day than usual; carb-forward around the work, same daily target.",
    "There's real work in today — carbs around it. The target stays where it is.",
    "Today asks a bit more of fuel; carbs toward the work, and the number stays as it is.",
  ];

  function demandVariants(drivers: string[]): string[] {
    const has = (needle: string) => drivers.some((driver) => driver.includes(needle));
    if (has("long run")) return DEMAND_LONG_RUN;
    if (has("quality run")) return DEMAND_QUALITY_RUN;
    if (has("heavy lower")) return DEMAND_HEAVY_LOWER;
    if (has("same day")) return DEMAND_DOUBLE;
    return DEMAND_GENERIC;
  }

  function demandHtml(m: Model): string {
    const demand = m.demand;
    if (!m.isToday || !demand || demand.demand !== "big") return "";
    const date = String(demand.date || m.date);
    if (date !== m.date) return "";
    const drivers = Array.isArray(demand.drivers) ? demand.drivers.map(String) : [];
    const line = pickDayVariant(demandVariants(drivers), date, "dayfuel-demand");
    return `<p class="fuel-today-line fuel-today-demand">${escHtml(line)}</p>`;
  }

  // The day's carb range for its work, fitted inside the target by the server. Today
  // only, and never set against the logged carbs: there is no "under" or "over".
  const CARB_TIER_WORDS: Record<string, string> = {
    light: "a lighter day",
    moderate: "today's training",
    high: "today's endurance work",
  };

  function carbsHtml(m: Model): string {
    const carbs = m.isToday ? m.demand?.carbs : null;
    if (!carbs) return "";
    const low = Math.round(Number(carbs.grams?.low));
    const high = Math.round(Number(carbs.grams?.high));
    const words = CARB_TIER_WORDS[String(carbs.tier || "")];
    if (!Number.isFinite(low) || !Number.isFinite(high) || high <= 0 || !words) return "";
    const range = low === high ? `${high}` : `${low}–${high}`;
    const fit = carbs.basis === "within_target" ? ", inside today's target" : "";
    return `<p class="fuel-today-line fuel-today-carbs">Carbs around <span class="numeral">${escHtml(range)}</span> g suit ${escHtml(words)}${escHtml(fit)}.</p>`;
  }

  // ---------- the numbers ----------
  function valueHtml(value: number | null, unit: string, countUp: boolean): string {
    if (value == null) {
      // Not estimated yet — never a zero standing in for it.
      return `<span class="fuel-today-value is-unknown"><span aria-hidden="true">—</span><span class="sr-only">not estimated yet</span></span>`;
    }
    const cu = countUp ? ` data-cu="${value}"` : "";
    return `<span class="fuel-today-value"><b class="numeral numeral-lg"${cu}>${escHtml(value.toLocaleString())}</b> <span class="fuel-today-unit">${escHtml(unit)}</span></span>`;
  }

  // The protein meter: how far today's protein has come toward its anchor, drawn as a
  // bar in the fuel stone's own hue. A picture of the numbers beside it, never a score
  // (no percentage is printed) and never a tone: a short bar is a day in progress.
  function meterHtml(value: number | null, anchor: number | null): string {
    if (value == null || anchor == null || anchor <= 0) return "";
    const fill = Math.max(0, Math.min(100, Math.round((value / anchor) * 100)));
    return `<dd class="fuel-today-meter" aria-hidden="true"><span class="fuel-today-track"><span class="fuel-today-fill" style="width:${fill}%"></span></span></dd>`;
  }

  function numHtml(
    label: string,
    value: number | null,
    unit: string,
    sub: string,
    opts: { anchor?: boolean; countUp: boolean; meter?: string; after?: string }
  ): string {
    return `<div class="fuel-today-num${opts.anchor ? " is-anchor" : ""}">
        <dt class="fuel-today-k">${escHtml(label)}</dt>
        <dd>${valueHtml(value, unit, opts.countUp)}</dd>
        ${opts.meter || ""}
        ${sub ? `<dd class="fuel-today-sub">${escHtml(sub)}</dd>` : ""}${opts.after || ""}
      </div>`;
  }

  function stateHtml(m: Model): string {
    if (m.state === "in progress") return `<span class="fuel-today-state">In progress</span>`;
    return "";
  }

  function headHtml(m: Model): string {
    const title = m.isToday ? "Today so far" : "That day's food";
    return `<div class="fuel-today-head"><h2 class="lbl fuel-today-title">${title}</h2>${stateHtml(m)}</div>`;
  }

  function emptyLine(m: Model): string {
    return m.isToday
      ? "Nothing logged yet today. Log a meal and it lands here, with the numbers worked out for you."
      : "Nothing was logged that day.";
  }

  /** The whole card. `countUp` marks the numerals for the cold-paint count-up. */
  function todayHtml(m: Model, opts: { countUp?: boolean } = {}): string {
    const countUp = !!opts.countUp;
    if (!m.count) {
      return `<section class="fuel-today reveal" style="--i:0" aria-label="Today's food">
        ${headHtml(m)}
        <p class="fuel-today-empty">${escHtml(emptyLine(m))}</p>
        ${demandHtml(m)}${carbsHtml(m)}
      </section>`;
    }
    const anchor = m.protein.anchor != null ? `of about ${m.protein.anchor} g` : "";
    const pending =
      m.pending > 0
        ? `<p class="fuel-today-line fuel-today-pending" role="status">${m.pending === 1 ? "One meal is" : `${m.pending} meals are`} still being estimated; the numbers fill in when ${m.pending === 1 ? "it settles" : "they settle"}.</p>`
        : "";
    const toGo =
      m.protein.toGo != null
        ? `<dd class="fuel-today-togo"><span class="numeral">${m.protein.toGo}</span> g protein to go</dd>`
        : m.protein.aboutThere
          ? `<dd class="fuel-today-togo">About there</dd>`
          : "";
    const band = m.bandWords ? `<p class="fuel-today-line fuel-today-band">${escHtml(m.bandWords)}</p>` : "";
    return `<section class="fuel-today reveal" style="--i:0" aria-label="Today's food">
      ${headHtml(m)}
      <dl class="fuel-today-nums">
        ${numHtml("Protein", m.protein.value, "g", anchor, {
          anchor: true,
          countUp,
          meter: meterHtml(m.protein.value, m.protein.anchor),
          after: toGo,
        })}
        ${numHtml("Energy", m.energy.value, "kcal", "", { countUp })}
        ${numHtml("Carbs", m.carbs.value, "g", "", { countUp })}
        ${numHtml("Fat", m.fat.value, "g", "", { countUp })}
        ${numHtml("Fiber", m.fiber.value, "g", "", { countUp })}
      </dl>
      ${pending}${band}${demandHtml(m)}${carbsHtml(m)}
    </section>`;
  }

  /** Cold start: the house shimmer in the card's shape, saying nothing. */
  function skeletonHtml(): string {
    return `<div class="skel-card fuel-today-skel" aria-hidden="true">
      <div class="hshimmer hshimmer-sm"></div><div class="hshimmer hshimmer-lg"></div><div class="hshimmer"></div>
    </div>`;
  }

  function errorHtml(): string {
    return `<section class="fuel-today" role="status" aria-live="polite">
      <p class="fuel-today-empty">Today's food couldn't be read just now.</p>
      <button class="linkbtn linkbtn-quiet fuel-today-retry" type="button" data-fuel-today-retry>Try again</button>
    </section>`;
  }

  const CAIRN_FUEL_TODAY = {
    todayHtml,
    demandHtml,
    carbsHtml,
    skeletonHtml,
    errorHtml,
  };

  Object.assign(globalThis, { CairnFuelToday: CAIRN_FUEL_TODAY });
}
