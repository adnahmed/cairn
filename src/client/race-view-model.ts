// @ts-check
// The race view, the model (docs/V2-PLAN.md wave 4, "race-ladder" / "race-estimate").
// Pure shaping from GET /api/race-build onto what the race view prints. It is a READ
// over raceBuild() and never a second engine: every week, kind and kilometre comes
// from the server's ladder as given, the fit is the server's word, and the only
// arithmetic here is scaling a bar against the ladder's own longest week. Run volume
// is kilometres per week everywhere, whatever the pace units; nothing is a score.
{
  type RaceBuild = import("../contracts/client-api.js").ClientRaceBuild;
  type RaceWeek = import("../contracts/client-api.js").ClientRaceBuildWeek;
  type RaceFit = import("../contracts/client-api.js").ClientRaceFit;
  type LadderRow = ClientRaceLadderRow;

  const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

  const KIND_WORD: Record<RaceWeek["kind"], string> = {
    build: "Build",
    down: "Down week",
    peak: "Peak",
    taper: "Taper",
    race: "Race",
  };

  const PHASE_WORD: Record<string, string> = {
    base: "Base building",
    build: "Building",
    sharpen: "Sharpening",
    taper: "Tapering",
  };

  /** The fit, in words. The three words are the whole vocabulary; there is no grade. */
  const FIT_WORD: Record<RaceFit, string> = {
    fits: "Fits",
    stretch: "Stretch",
    beyond_horizon: "Beyond horizon",
  };

  const FIT_LINE: Record<RaceFit, string> = {
    fits: "The estimate sits inside the target.",
    stretch: "A stretch the build can close.",
    beyond_horizon: "Train from today's shape; the target stays the reach.",
  };

  function num(value: unknown): number | null {
    if (value == null || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  /** "32 km", "12.5 km": kilometres always, one decimal only when it has one. */
  function kmText(km: unknown): string {
    const n = num(km);
    if (n == null || n < 0) return "";
    const r = Math.round(n * 10) / 10;
    return `${Number.isInteger(r) ? r : r.toFixed(1)} km`;
  }

  /** A finish clock: "1:59:59", or "58:40" under the hour. "" when there is none. */
  function clock(sec: unknown): string {
    const n = num(sec);
    if (n == null || n <= 0) return "";
    const s = Math.round(n);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    const mm = String(m).padStart(h > 0 ? 2 : 1, "0");
    return h > 0 ? `${h}:${mm}:${String(r).padStart(2, "0")}` : `${mm}:${String(r).padStart(2, "0")}`;
  }

  function dayKey(iso: unknown): string {
    const key = String(iso || "").slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : "";
  }

  /** "Nov 1", through the one shared date label. */
  function shortDate(iso: unknown): string {
    const key = dayKey(iso);
    return key ? CairnUiChart.dateLabel(key) : "";
  }

  /** "Sunday, Nov 1". */
  function longDate(iso: unknown): string {
    const key = dayKey(iso);
    if (!key) return "";
    const d = new Date(`${key}T00:00:00Z`);
    if (!Number.isFinite(d.getTime())) return "";
    return `${WEEKDAYS[d.getUTCDay()]}, ${shortDate(key)}`;
  }

  /**
   * The head's countdown, in the ladder's own count. The current rung's
   * `weeks_to_race` is the server's CALENDAR-week count to race week (the one the
   * ladder labels and the engine prescribes by), so the head can never say "2 weeks
   * to race" over a row that reads "1 wk out". `race.weeks_to_race` is a rounded-up
   * day count and is only the fallback when no rung is this week.
   */
  function countdownText(race: NonNullable<RaceBuild["race"]>, weeks: RaceWeek[]): string {
    if (num(race.days_to_race) === 0) return "Race day is today";
    const here = weeks.find((week) => week.current === true);
    const count = here ? num(here.weeks_to_race) : num(race.weeks_to_race);
    const out = Math.max(0, Math.round(count ?? 0));
    if (here?.kind === "race" || out === 0) return "Race week";
    return out === 1 ? "1 week to race" : `${out} weeks to race`;
  }

  function eventName(race: NonNullable<RaceBuild["race"]>): string {
    const event = String(race.event || "").trim();
    if (event) return event;
    const km = num(race.distance_km);
    return km != null && km >= 20.5 && km <= 21.5 ? "Your half marathon" : "Your race";
  }

  function soFarText(rung: number, logged: number | null): string {
    if (logged == null || logged <= 0) return "";
    if (logged >= rung && rung > 0) return `${kmText(logged)} run, the week's ${kmText(rung)} is in.`;
    return `${kmText(logged)} run so far of ${kmText(rung)}.`;
  }

  /** The week's running, in the server's words: its quality hint, then the long run. */
  function runText(week: RaceWeek, long: number | null): string {
    const hint = String(week.quality_hint || "").trim();
    const longRun = long != null && long > 0 && week.kind !== "race" ? `Long run ${kmText(long)}.` : "";
    return [hint, longRun].filter(Boolean).join(" ");
  }

  /** The race's short name on the chart: "Half", "Marathon", "10K", else "Race". */
  function raceShortName(distanceKm: unknown): string {
    const km = num(distanceKm);
    if (km == null) return "Race";
    if (km >= 20.5 && km <= 21.5) return "Half";
    if (km >= 41.5 && km <= 42.7) return "Marathon";
    if (km >= 9.8 && km <= 10.2) return "10K";
    if (km >= 4.9 && km <= 5.1) return "5K";
    return "Race";
  }

  /**
   * The whole build as terrain: the closed weeks the log already holds (from the first
   * one with running in it), then the ladder's weeks to race day. Null when there is no
   * ridge to draw. The logged weeks are the log's own kilometres, never re-derived.
   */
  function terrainModel(build: RaceBuild | null | undefined, ladder: ClientRaceLadderModel): ClientHorizonTerrain | null {
    const rows = Array.isArray(ladder?.rows) ? ladder.rows : [];
    if (rows.length < 2) return null;
    const first = rows[0].week_start;
    const review = Array.isArray(build?.review?.weeks) ? build.review.weeks : [];
    const past = review
      .map((week) => ({ week_start: dayKey(week.week_start), km: Math.max(0, num(week.km) ?? 0) }))
      .filter((week) => week.week_start && week.week_start < first)
      .sort((a, b) => (a.week_start < b.week_start ? -1 : 1));
    const start = past.findIndex((week) => week.km > 0);
    const logged = start >= 0 ? past.slice(start) : [];
    const raceDate = dayKey(build?.race?.date);
    return {
      weeks: [
        ...logged.map((week) => ({ week_start: week.week_start, km: week.km, kind: "logged", current: false, logged: true })),
        ...rows.map((row) => ({ week_start: row.week_start, km: row.km, kind: row.kind, current: row.current })),
      ],
      race_date: raceDate,
      race_label: [raceShortName(build?.race?.distance_km), raceDate ? shortDate(raceDate) : ""].filter(Boolean).join(" · "),
      as_of: dayKey(build?.as_of),
    };
  }

  const COUNT_WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"];

  /** What the voice calls the race: "the half", "the 10K", else "race day". */
  function raceNoun(distanceKm: unknown): string {
    const short = raceShortName(distanceKm);
    return short === "Race" ? "race day" : `the ${short === "Half" || short === "Marathon" ? short.toLowerCase() : short}`;
  }

  /**
   * The race view's one serif line, from the ladder's own count: "Five weeks of build,
   * then the half." In the taper it is the taper; in race week, race week. Calm, never
   * a countdown alarm.
   */
  function buildVoice(ladder: ClientRaceLadderModel, race: RaceBuild["race"] | null | undefined): string {
    const rows = Array.isArray(ladder?.rows) ? ladder.rows : [];
    const here = rows.find((row) => row.current) || rows[0] || null;
    const noun = raceNoun(race?.distance_km);
    const weekday = longDate(race?.date).split(",")[0];
    if (!here || here.kind === "race" || num(race?.days_to_race) === 0) {
      return num(race?.days_to_race) === 0 ? "Race day is today." : `Race week, then ${noun}${weekday ? ` on ${weekday}` : ""}.`;
    }
    if (here.kind === "taper") return `The taper, then ${noun}.`;
    const n = Math.max(1, Math.round(num(here.weeks_to_race) ?? 1));
    const count = n < COUNT_WORDS.length ? COUNT_WORDS[n] : String(n);
    return `${count} ${n === 1 ? "week" : "weeks"} of build, then ${noun}.`;
  }

  /** The ladder: the server's weeks as rows, each bar against the ladder's longest week. */
  function ladderModel(build: RaceBuild | null | undefined): ClientRaceLadderModel {
    const weeks = Array.isArray(build?.weeks) ? build.weeks : [];
    const kms = weeks.map((week) => Math.max(0, num(week.km) ?? 0));
    const maxKm = kms.length ? Math.max(...kms) : 0;
    const scale = CairnUiChart.linearScale(0, maxKm, 0, 1);
    const frac = (km: number): number => Math.round(Math.min(1, Math.max(0, scale(km))) * 1000) / 1000;
    const logged = num(build?.this_week?.logged_km);
    const raceDay = longDate(build?.race?.date);
    const rows: LadderRow[] = weeks.map((week, index) => {
      const km = kms[index];
      const current = week.current === true;
      const out = Math.max(0, Math.round(num(week.weeks_to_race) ?? 0));
      const long = num(week.long_km);
      const loggedKm = current && logged != null && logged > 0 ? logged : null;
      return {
        week_start: dayKey(week.week_start),
        weeks_to_race: out,
        kind: week.kind,
        kind_word: KIND_WORD[week.kind] || "Build",
        out_word: out === 0 ? "Race week" : `${out} wk out`,
        date_word: shortDate(week.week_start),
        km,
        km_text: kmText(km),
        long_text: long != null && long > 0 && week.kind !== "race" ? `long ${kmText(long)}` : "",
        frac: frac(km),
        current,
        logged_km: loggedKm,
        logged_frac: loggedKm != null && maxKm > 0 ? frac(loggedKm) : null,
        so_far_text: current ? soFarText(km, loggedKm) : "",
        race_day_text: week.kind === "race" && raceDay ? `Race day, ${raceDay}` : "",
        run_text: runText(week, long),
        lift_text: String(week.strength_hint || "").trim(),
      };
    });
    const taper = rows.find((row) => row.kind === "taper");
    const taperText = !taper
      ? ""
      : taper.current
        ? "This week is the taper: the volume comes down so race day finds you fresh."
        : `The taper starts the week of ${taper.date_word}, the week before race week.`;
    return { rows, max_km: maxKm, taper_text: taperText };
  }

  /** The finish estimate against the target: the server's fit word, never a gap as a grade. */
  function estimateModel(build: RaceBuild | null | undefined): ClientRaceEstimateModel {
    const p = build?.prediction || null;
    const target = build?.race?.target || null;
    const fit = p && target && p.fit && FIT_WORD[p.fit] ? p.fit : null;
    const trend = p?.trend
      ? p.trend.word === "steady"
        ? "Holding steady over the last month."
        : `${Math.max(1, Math.round(Math.abs(num(p.trend.delta_sec) ?? 0) / 60))} min ${p.trend.word} over the last month.`
      : "";
    const basis = p && String(p.basis_detail || "").trim() ? `From ${String(p.basis_detail).trim()}.` : "";
    let line = fit ? FIT_LINE[fit] : "";
    if (p && !target) line = "No target time on the race, so the estimate is where today's running reads.";
    if (!p) line = "No finish estimate yet. A recent run or the watch's race predictor gives one.";
    return {
      fit,
      fit_word: fit ? FIT_WORD[fit] : "",
      fit_line: line,
      estimate_clock: clock(p?.estimate_sec),
      target_clock: clock(target?.sec),
      basis_text: basis,
      trend_text: trend,
      empty: !p,
    };
  }

  function pacesModel(build: RaceBuild | null | undefined, units?: unknown): Array<{ label: string; text: string }> {
    const bands = Array.isArray(build?.paces?.bands) ? build.paces.bands : [];
    return bands.map((band) => {
      const pace = typeof fmtPaceBand === "function" ? fmtPaceBand(band, units) : String(band.text || "");
      const ceiling = num(band.hr_ceiling_bpm);
      return {
        label: String(band.label || band.key),
        text: ceiling != null && ceiling > 0 ? `${pace} · under ${Math.round(ceiling)} bpm` : pace,
      };
    });
  }

  /**
   * The fold's sentences. `build.why` is deliberately left out: the head, the estimate
   * and the ladder already say all of it, and its estimate clause prints the time gap
   * as a verdict ("4:31 off the target") in a rounded-up week count the ladder does not use.
   */
  function notesModel(build: RaceBuild | null | undefined): string[] {
    const notes = [build?.strength?.principle, build?.strength?.layout, build?.ride?.placement];
    return notes.map((note) => String(note || "").trim()).filter(Boolean);
  }

  /** A build the view can paint: available, with a race. */
  function isShowable(value: unknown): value is RaceBuild {
    const build = value as RaceBuild | null;
    return !!build && typeof build === "object" && build.available !== false && !!build.race;
  }

  /** The whole view, or null when the build has nothing to show (the empty state). */
  function viewModel(value: unknown, opts: { units?: unknown } = {}): ClientRaceViewModel | null {
    if (!isShowable(value)) return null;
    const race = value.race as NonNullable<RaceBuild["race"]>;
    const ladder = ladderModel(value);
    return {
      event: eventName(race),
      countdown: countdownText(race, Array.isArray(value.weeks) ? value.weeks : []),
      race_day: longDate(race.date),
      phase_word: PHASE_WORD[race.phase] || "",
      estimate: estimateModel(value),
      ladder,
      terrain: terrainModel(value, ladder),
      paces: pacesModel(value, opts.units),
      notes: notesModel(value),
    };
  }

  const CAIRN_RACE_VIEW_MODEL = {
    FIT_WORD,
    KIND_WORD,
    kmText,
    clock,
    longDate,
    isShowable,
    ladderModel,
    terrainModel,
    raceShortName,
    buildVoice,
    estimateModel,
    viewModel,
  };

  Object.assign(globalThis, { CairnRaceViewModel: CAIRN_RACE_VIEW_MODEL });
}
