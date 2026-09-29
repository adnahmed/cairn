// The race view (race-view-model/-client/-controller, race-ladder-client,
// race-estimate-client; docs/V2-PLAN.md wave 4). A read over GET /api/race-build and
// never a second engine: the ladder's weeks and kilometres ARE the fixture build's,
// the taper and race week read as the server's kinds, run volume is km per week
// whatever the pace units, and the finish estimate is a fit word — never a score.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHost, flush, loadClientModule, renderHtml } from "./_dom.mjs";
import { repo, resetTables } from "./_seed.js";
import { raceBuild } from "../dist/repo/race-build.js";

const MODULES = [
  "html-utils",
  "ui-components",
  "ui-actions-client",
  "ui-chart",
  "format-utils",
  "race-week-model",
  "race-view-model",
  "race-estimate-client",
  "race-ladder-client",
  "race-view-client",
  "race-view-controller",
];

function load(globals = {}) {
  return loadClientModule(MODULES, { globals });
}

const WEEKS = [
  ["2026-09-14", 7, "build", "build", 32, 13, true],
  ["2026-09-21", 6, "build", "down", 26, 13, false],
  ["2026-09-28", 5, "build", "build", 35.5, 15, false],
  ["2026-10-05", 4, "sharpen", "build", 38, 16, false],
  ["2026-10-12", 3, "sharpen", "peak", 40, 18, false],
  ["2026-10-19", 2, "taper", "peak", 36, 16, false],
  ["2026-10-26", 1, "taper", "taper", 28, 12, false],
  ["2026-11-02", 0, "taper", "race", 30, 21.1, false],
].map(([week_start, weeks_to_race, phase, kind, km, long_km, current]) => ({
  week_start,
  weeks_to_race,
  phase,
  kind,
  km,
  long_km,
  quality_hint: "One quality session.",
  strength_hint: "Heavy legs early in the week.",
  focus: kind === "race" ? "Short easy runs and a few strides." : `The ${kind} week's focus.`,
  focus_short: kind === "race" ? "Easy runs and strides" : `${kind} focus`,
  with_lifting:
    kind === "taper"
      ? "Taper week: leg work stays on the card with fewer sets at a lighter weight."
      : kind === "race"
        ? "Race week: heavy leg work sits out."
        : "Lower B on Friday is the last lift before Sunday's long run.",
  current,
}));

function build(overrides = {}) {
  return {
    available: true,
    as_of: "2026-09-16",
    race: {
      event: "Riverside Half",
      date: "2026-11-08",
      distance_km: 21.1,
      days_to_race: 53,
      // The server's rounded-up day count (ceil(53 / 7)); the ladder's calendar count is 7.
      weeks_to_race: 8,
      phase: "build",
      target: { sec: 7199, pace_sec_per_km: 341, raw: "sub-2:00", kind: "time" },
      target_raw: "sub-2:00",
    },
    prediction: {
      estimate_sec: 7470,
      estimate_pace_sec_per_km: 354,
      basis: "watch_predictor",
      basis_detail: "the watch's race predictor",
      as_of: "2026-09-15",
      trend: { delta_sec: -130, since: "2026-08-18", word: "faster" },
      gap_sec: 271,
      fit: "stretch",
    },
    paces: {
      anchored_on: "estimate",
      race_pace_sec_per_km: 341,
      bands: [
        { key: "race", label: "Race pace", slow_sec_per_km: 345, fast_sec_per_km: 338, text: "5:38–5:45 /km" },
        {
          key: "easy",
          label: "Easy",
          slow_sec_per_km: 420,
          fast_sec_per_km: 390,
          text: "6:30–7:00 /km",
          hr_ceiling_bpm: 150,
        },
      ],
    },
    this_week: { week_start: "2026-09-14", km: 32, long_km: 13, logged_km: 18, quality: null, why: "Build week." },
    weeks: WEEKS,
    leg_map: [],
    strength: {
      heavy_lower_days: ["Monday"],
      principle: "Heavy legs stay two days off the long run.",
      layout: null,
      clean: true,
    },
    ride: null,
    review: { weeks: [], longest_recent_km: 13, volume_word: "steady" },
    // The server's why carries the estimate sentence, gap and all; the view never prints it.
    why: "8 weeks to Riverside Half: this week is 32 km with a 13 km long run. Current shape reads about 2:04:30 (5:54 /km), 2 min faster over the last month — 4:31 off the 1:59:59 target, a stretch the build can close.",
    reason: null,
    ...overrides,
  };
}

const SCORE = /score|\/\s*100|\d\s*%|percent|grade|rating|\bA\+|\bB-/i;

function paint(win, data, opts = {}) {
  const model = win.CairnRaceViewModel.viewModel(data, opts);
  return renderHtml(win.CairnRaceView.viewHtml(model, opts), { document: win.document });
}

// ---------- the ladder ----------

test("the ladder's weeks and km equal the build's own weeks, in order", () => {
  const win = load();
  const host = paint(win, build());
  const rows = host.querySelectorAll(".race-ladder-row");
  assert.equal(rows.length, WEEKS.length);
  rows.forEach((row, i) => {
    assert.equal(row.getAttribute("data-race-week"), WEEKS[i].week_start);
    const km = WEEKS[i].km;
    assert.equal(row.querySelector(".race-ladder-km").textContent, `${km} km`);
    // Each bar is that week's km against the ladder's longest week (40 km here).
    assert.equal(Number(row.style.getPropertyValue("--frac")), Math.round((km / 40) * 1000) / 1000);
  });
  assert.equal(rows[0].querySelector(".race-ladder-out").textContent, "7 wk out");
  assert.equal(rows[rows.length - 1].querySelector(".race-ladder-out").textContent, "Race week");
});

test("the current week is marked in words and by aria-current, and carries what has been run", () => {
  const win = load();
  const host = paint(win, build());
  const current = host.querySelectorAll("[aria-current]");
  assert.equal(current.length, 1);
  const row = current[0];
  assert.ok(row.classList.contains("is-current"));
  assert.equal(row.querySelector(".race-ladder-here").textContent, "This week");
  // The row speaks its focus in a few words; what has been run lives in THIS WEEK.
  assert.equal(row.querySelector(".race-ladder-foot").textContent, "build focus");
  assert.equal(Number(row.querySelector(".race-ladder-logged").style.getPropertyValue("--frac")), 0.45);
  // Only this week has a logged fill.
  assert.equal(host.querySelectorAll(".race-ladder-logged").length, 1);
});

test("THIS WEEK: the stage, what the log holds of the week on a quiet bar, the long run, the focus", () => {
  const win = load();
  const host = paint(win, build(), { sessionsHtml: `<ol class="race-runs"><li>Thursday tempo</li></ol>` });
  const card = host.querySelector(".race-week");
  assert.ok(card, "the one focal card");
  assert.equal(card.querySelector(".race-week-stage").textContent, "Build");
  assert.equal(card.querySelector(".race-week-num").textContent, "18 of 32 km");
  assert.equal(Number(card.querySelector(".race-week-fill").style.getPropertyValue("--frac")), 0.563);
  assert.equal(card.querySelector(".race-week-long").textContent, "Long run 13 km");
  assert.equal(card.querySelector(".race-week-focus").textContent, "The build week's focus.");
  // The page hands in the week's runs; the card places them between the volume and the focus.
  assert.match(card.querySelector(".race-runs").textContent, /Thursday tempo/);
  // It comes first: before the ladder, the lifting and the estimate.
  const order = ["race-week", "race-ladder", "race-lifting", "race-estimate"].map((cls) =>
    host.innerHTML.indexOf(`class="${cls}`)
  );
  assert.deepEqual(
    [...order].sort((a, b) => a - b),
    order
  );
  assert.ok(order.every((i) => i >= 0));
});

test("a banked week says so; nothing run yet says nothing (never a zero)", () => {
  const win = load();
  const banked = paint(win, build({ this_week: { ...build().this_week, logged_km: 33.4 } }));
  assert.equal(banked.querySelector(".race-week-num").textContent, "33.4 of 32 km");
  assert.ok(banked.querySelector(".race-week-fill.is-banked"));
  assert.equal(Number(banked.querySelector(".race-ladder-logged").style.getPropertyValue("--frac")), 0.835);
  const none = paint(win, build({ this_week: { ...build().this_week, logged_km: 0 } }));
  assert.equal(none.querySelector(".race-week-num").textContent, "32 km this week");
  assert.equal(none.querySelector(".race-ladder-logged"), null);
  assert.doesNotMatch(none.querySelector(".race-week").textContent, /\b0 (of|km)\b/);
  assert.doesNotMatch(none.querySelector(".is-current").textContent, /\b0 km\b/);
});

test("with your lifting: a run of weeks saying the same thing is one row; taper and race week their own", () => {
  const win = load();
  const host = paint(win, build());
  const rows = host.querySelectorAll(".race-lifting-row");
  assert.deepEqual(
    rows.map((row) => row.querySelector(".race-lifting-when").textContent),
    ["This week – Oct 19", "Oct 26 · Taper", "Nov 2 · Race"]
  );
  assert.ok(rows[0].classList.contains("is-current"));
  assert.match(rows[1].textContent, /fewer sets at a lighter weight/);
  // A running-only athlete (no lifting lines) gets no section at all.
  const bare = paint(win, build({ weeks: WEEKS.map((w) => ({ ...w, with_lifting: "" })) }));
  assert.equal(bare.querySelector(".race-lifting"), null);
});

test("the taper and race week read as the server's kinds, with race day on race week", () => {
  const win = load();
  const host = paint(win, build());
  const kinds = host
    .querySelectorAll(".race-ladder-row")
    .map((row) => row.querySelector(".race-ladder-kind").firstChild.textContent);
  // A turning point by its kind, a build week by its phase (the stage word).
  assert.deepEqual(kinds, ["Build", "Down week", "Build", "Sharpen", "Peak", "Peak", "Taper", "Race"]);
  const taper = host.querySelectorAll(".race-ladder-row.is-taper");
  assert.equal(taper.length, 1);
  assert.equal(taper[0].getAttribute("data-race-week"), "2026-10-26");
  const race = host.querySelector(".race-ladder-row.is-race");
  assert.equal(race.querySelector(".race-ladder-foot").textContent, "Race day, Sunday, Nov 8");
  assert.match(host.querySelector(".race-ladder-taper").textContent, /taper starts the week of Oct 26/);
});

test("a taper week that is this week says so", () => {
  const win = load();
  const weeks = WEEKS.slice(6).map((w, i) => ({ ...w, current: i === 0 }));
  const host = paint(win, build({ weeks, this_week: { ...build().this_week, km: 28, logged_km: 5 } }));
  assert.match(host.querySelector(".race-ladder-taper").textContent, /This week is the taper/);
});

test("run volume and paces both follow the athlete's run units", () => {
  const win = load();
  const host = paint(win, build(), { units: "mi" });
  for (const km of host.querySelectorAll(".race-ladder-km")) assert.match(km.textContent, /^\d+(\.\d)? mi$/);
  assert.equal(host.querySelector(".race-week-num").textContent, "11.2 of 19.9 mi");
  assert.equal(host.querySelector(".race-week-long").textContent, "Long run 8.1 mi");
  assert.doesNotMatch(host.querySelector(".race-week").textContent, /\bkm\b/);
  assert.equal(host.querySelector("[data-run-units='mi']").getAttribute("aria-pressed"), "true");
  assert.doesNotMatch(host.querySelector(".race-ladder").textContent, /\bkm\b/);
  assert.equal(host.querySelector(".race-ladder-unit").textContent, "mi per week");
  assert.match(host.querySelector(".race-view-pace dd").textContent, /\/mi/);
  const metric = paint(win, build());
  assert.equal(metric.querySelector(".race-ladder-unit").textContent, "km per week");
  for (const km of metric.querySelectorAll(".race-ladder-km")) assert.match(km.textContent, /^\d+(\.\d)? km$/);
});

// ---------- the head and the estimate ----------

test("the head frames the race: its name, the ladder's own weeks to race, and race day", () => {
  const win = load();
  const host = paint(win, build());
  assert.equal(host.querySelector(".race-view-event").textContent, "Riverside Half");
  // The current rung's calendar count (7), never the rounded-up day count (8).
  assert.equal(host.querySelector(".race-view-when").textContent, "7 weeks to race · Sunday, Nov 8");
  assert.equal(host.querySelector(".is-current .race-ladder-out").textContent, "7 wk out");
  // The kicker names the page; the week's stage is THIS WEEK's to say, once.
  assert.equal(host.querySelector(".race-view-head .lbl").textContent, "Race");
  const at = (i) => WEEKS.map((w, j) => ({ ...w, current: j === i }));
  // Race week on a Tuesday: 5 days out, the server's ceil says 1, the ladder says race week.
  const week = paint(win, build({ weeks: at(7), race: { ...build().race, weeks_to_race: 1, days_to_race: 5 } }));
  assert.match(week.querySelector(".race-view-when").textContent, /^Race week/);
  // The taper Monday: 13 days out, the server's ceil says 2, the ladder says 1 wk out.
  const one = paint(win, build({ weeks: at(6), race: { ...build().race, weeks_to_race: 2, days_to_race: 13 } }));
  assert.match(one.querySelector(".race-view-when").textContent, /^1 week to race/);
  // No rung is this week: the race's own count is the fallback.
  const none = paint(win, build({ weeks: [], race: { ...build().race, weeks_to_race: 3, days_to_race: 20 } }));
  assert.match(none.querySelector(".race-view-when").textContent, /^3 weeks to race/);
  const today = paint(win, build({ weeks: at(7), race: { ...build().race, weeks_to_race: 0, days_to_race: 0 } }));
  assert.match(today.querySelector(".race-view-when").textContent, /^Race day is today/);
  const unnamed = paint(win, build({ race: { ...build().race, event: null } }));
  assert.equal(unnamed.querySelector(".race-view-event").textContent, "Your half marathon");
});

test("the estimate is a fit word — fits, stretch or beyond horizon — never a grade", () => {
  const win = load();
  const words = { fits: "Fits", stretch: "Stretch", beyond_horizon: "Beyond horizon" };
  for (const [fit, word] of Object.entries(words)) {
    const host = paint(win, build({ prediction: { ...build().prediction, fit } }));
    const el = host.querySelector(".race-estimate-word");
    assert.equal(el.textContent, word);
    assert.ok(el.classList.contains(`is-${fit}`));
    assert.doesNotMatch(host.textContent, SCORE);
  }
  const host = paint(win, build());
  assert.equal(host.querySelector(".race-estimate-clock.is-estimate dd").textContent, "2:04:30");
  assert.equal(host.querySelector(".race-estimate-clock.is-target dd").textContent, "1:59:59");
  assert.equal(
    host.querySelector(".race-estimate-source").textContent,
    "2 min faster over the last month. From the watch's race predictor."
  );
  // The gap is not printed as a verdict.
  assert.doesNotMatch(host.querySelector(".race-estimate").textContent, /4:31|off the/);
});

test("no target reads the estimate alone; no estimate says where one comes from", () => {
  const win = load();
  const noTarget = paint(
    win,
    build({ race: { ...build().race, target: null }, prediction: { ...build().prediction, fit: null } })
  );
  assert.equal(noTarget.querySelector(".race-estimate-word"), null);
  assert.equal(noTarget.querySelector(".race-estimate-clock.is-target"), null);
  assert.match(noTarget.querySelector(".race-estimate-line").textContent, /No target time/);
  const noEstimate = paint(win, build({ prediction: null }));
  assert.ok(noEstimate.querySelector(".race-estimate.is-empty"));
  assert.match(noEstimate.querySelector(".race-estimate-line").textContent, /No finish estimate yet/);
  assert.equal(noEstimate.querySelector(".race-estimate-clock.is-estimate"), null);
});

test("nothing on the view is a score", () => {
  const win = load();
  const host = paint(win, build());
  assert.doesNotMatch(host.textContent, SCORE);
});

test("caller strings are escaped", () => {
  const win = load();
  const host = paint(
    win,
    build({
      race: { ...build().race, event: "<b>Half</b>" },
      strength: { ...build().strength, layout: "<i>why</i>" },
    })
  );
  assert.equal(host.querySelector(".race-view-event b"), null);
  assert.equal(host.querySelector(".race-view-event").textContent, "<b>Half</b>");
  assert.equal(host.querySelector(".race-view-note i"), null);
});

test("the paces and the server's sentences sit behind a 44px fold", () => {
  const win = load();
  const host = paint(win, build());
  const more = host.querySelector("details.race-view-more");
  assert.ok(more);
  assert.equal(more.hasAttribute("open"), false);
  const paces = host.querySelectorAll(".race-view-pace").map((row) => row.querySelector("dt").textContent);
  assert.deepEqual(paces, ["Race pace", "Easy"]);
  assert.match(host.querySelectorAll(".race-view-pace")[1].querySelector("dd").textContent, /under 150 bpm/);
  const notes = host.querySelectorAll(".race-view-note").map((p) => p.textContent);
  // The server's why is not in the fold: the head, estimate and ladder already say it,
  // and its estimate clause prints the gap as a verdict.
  // The strength principle is "With your lifting" now; only the layout and ride remain.
  assert.deepEqual(notes, []);
  assert.doesNotMatch(more.textContent, /off the [0-9:]+ target|4:31/);
});

// ---------- against the real server read ----------

// A real raceBuild(asOf), through the JSON the route sends, painted as-is: the rows,
// km, kinds and the current rung are the server's, and the head counts what the
// ladder counts. Riverside Half is Sunday 2026-11-01, so the rounded-up day count and
// the ladder's calendar count disagree on every day but Monday.
const REAL_RACE = "2026-11-01";
const shiftDays = (iso, n) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * 864e5).toISOString().slice(0, 10);

function seedRealBuild(asOf) {
  resetTables("activities", "garmin_activities", "garmin_daily_metrics", "profile", "app_state");
  repo.setProfile({
    age: 40,
    sex: "male",
    primary_discipline: "hybrid",
    endurance_sport: "running",
    endurance_goal: { mode: "race", event: "Riverside Half", date: REAL_RACE, distance_km: 21.1, target: "sub-2:00" },
  });
  // Six weeks of Tue / Thu / Sat running, all before the as-of.
  for (let wk = 1; wk <= 6; wk++) {
    const base = shiftDays(asOf, -7 * wk);
    repo.addActivity({ type: "run", duration_min: 48, distance_km: 8, date: shiftDays(base, 1) });
    repo.addActivity({ type: "run", duration_min: 42, distance_km: 7.5, date: shiftDays(base, 3) });
    repo.addActivity({ type: "run", duration_min: 84, distance_km: 13, date: shiftDays(base, 5) });
  }
  return JSON.parse(JSON.stringify(raceBuild(asOf)));
}

for (const [asOf, head, currentOut] of [
  ["2026-09-16", "6 weeks to race", "6 wk out"], // a Wednesday: ceil(46 / 7) would say 7
  ["2026-10-19", "1 week to race", "1 wk out"], // the taper Monday: ceil(13 / 7) would say 2
  ["2026-10-27", "Race week", "Race week"], // race week, Tuesday: ceil(5 / 7) would say 1
]) {
  test(`a real raceBuild(${asOf}) paints its own ladder, and the head counts what the ladder counts`, () => {
    const data = seedRealBuild(asOf);
    assert.equal(data.available, true, data.reason);
    const win = load();
    const host = paint(win, data);
    const rows = host.querySelectorAll(".race-ladder-row");
    assert.equal(rows.length, data.weeks.length);
    assert.ok(rows.length > 0);
    rows.forEach((row, i) => {
      const week = data.weeks[i];
      assert.equal(row.getAttribute("data-race-week"), week.week_start);
      assert.equal(row.querySelector(".race-ladder-km").textContent, win.CairnRaceViewModel.kmText(week.km));
      assert.equal(
        row.querySelector(".race-ladder-kind").firstChild.textContent,
        win.CairnRaceViewModel.stageWord(week)
      );
      assert.equal(
        row.querySelector(".race-ladder-foot").textContent,
        week.kind === "race" ? row.querySelector(".race-ladder-foot").textContent : week.focus_short
      );
      assert.ok(row.classList.contains(`is-${week.kind}`) || !["taper", "race"].includes(week.kind));
      assert.equal(row.classList.contains("is-current"), week.current === true);
    });
    const here = data.weeks.findIndex((week) => week.current);
    assert.ok(here >= 0);
    assert.equal(rows[here].querySelector(".race-ladder-out").textContent, currentOut);
    assert.match(host.querySelector(".race-view-when").textContent, new RegExp(`^${head} · Sunday, Nov 1$`));
    // Never the server's why (its rounded-up count and its gap-as-verdict clause).
    assert.doesNotMatch(host.textContent, /off the .* target|weeks to Riverside Half/);
  });
}

// ---------- the controller ----------

test("a build in hand paints at once with one settle entrance; reduced motion paints still", async () => {
  const win = load();
  const loads = [];
  const host = createHost(win.document);
  win.CairnRaceViewController.mount(host, {
    initial: build(),
    load: () => {
      loads.push(1);
      return Promise.resolve(build());
    },
  });
  assert.equal(loads.length, 0, "no second read");
  const section = host.querySelector(".race-view");
  assert.ok(section.classList.contains("settle-in"));
  assert.ok(section.classList.contains("is-entering"));
  assert.equal(host.querySelectorAll(".race-ladder-row").length, WEEKS.length);

  const calm = createHost(win.document);
  win.CairnRaceViewController.mount(calm, { initial: build(), load: async () => build(), reducedMotion: () => true });
  const still = calm.querySelector(".race-view");
  assert.equal(still.classList.contains("settle-in"), false);
  assert.equal(still.classList.contains("is-entering"), false);
});

test("a cold mount shows the skeleton, then the view", async () => {
  const win = load();
  const host = createHost(win.document);
  let resolve;
  win.CairnRaceViewController.mount(host, { load: () => new Promise((r) => (resolve = r)) });
  await flush();
  assert.ok(host.querySelector(".race-view-skel[aria-busy='true']"));
  resolve(build());
  await flush();
  assert.equal(host.querySelector(".race-view-skel"), null);
  assert.equal(host.querySelectorAll(".race-ladder-row").length, WEEKS.length);
});

test("an unavailable build is the empty state with the server's own reason", async () => {
  const win = load();
  const host = createHost(win.document);
  const reason = "No dated race yet. Set one and the build lays out week by week.";
  win.CairnRaceViewController.mount(host, { load: async () => ({ available: false, reason, weeks: [] }) });
  await flush();
  assert.equal(host.querySelector(".race-ladder"), null);
  assert.equal(host.querySelector(".empty-state-line").textContent, "No race build yet");
  assert.equal(host.querySelector(".hpic-hero-sub").textContent, reason);
});

test("a failed read says so in one line and tries again on tap", async () => {
  const win = load();
  const host = createHost(win.document);
  let calls = 0;
  const unmount = win.CairnRaceViewController.mount(host, {
    load: () => (++calls === 1 ? Promise.reject(new Error("offline")) : Promise.resolve(build())),
  });
  await flush();
  assert.match(host.querySelector(".race-view-error-line").textContent, /couldn't be read just now/);
  const retry = host.querySelector("[data-race-view-retry]");
  assert.equal(retry.getAttribute("type"), "button");
  await retry.click();
  await flush();
  assert.equal(calls, 2);
  assert.equal(host.querySelectorAll(".race-ladder-row").length, WEEKS.length);
  unmount();
});

test("a remount replaces the listener, so one tap reads once", async () => {
  const win = load();
  const host = createHost(win.document);
  let calls = 0;
  const deps = {
    load: () => {
      calls++;
      return Promise.reject(new Error("offline"));
    },
  };
  win.CairnRaceViewController.mount(host, deps);
  win.CairnRaceViewController.mount(host, deps);
  await flush();
  assert.equal(calls, 2);
  await host.querySelector("[data-race-view-retry]").click();
  await flush();
  assert.equal(calls, 3);
});

test("a view the athlete has left is never painted", async () => {
  const win = load();
  const host = createHost(win.document);
  let resolve;
  win.CairnRaceViewController.mount(host, { load: () => new Promise((r) => (resolve = r)) });
  await flush();
  host.remove();
  resolve(build());
  await flush();
  assert.equal(host.querySelector(".race-ladder"), null);
});

// ---------- the race page holds the depth, Horizon the glance ----------

test("the race page draws no chart: the terrain is Horizon's glance, the ladder here is its table", () => {
  const win = loadClientModule([...MODULES.slice(0, -2), "horizon-terrain-client", "horizon-chart-client", ...MODULES.slice(-2)], {
    globals: {},
  });
  const host = paint(win, build());
  assert.equal(host.querySelector(".hz-terrain"), null);
  assert.equal(host.querySelector("details.race-view-weeks"), null);
  assert.equal(host.querySelectorAll(".race-ladder-row").length, 8);
});
