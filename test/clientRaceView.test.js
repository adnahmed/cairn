// The race view (race-view-model/-client/-controller, race-ladder-client,
// race-estimate-client; docs/V2-PLAN.md wave 4). A read over GET /api/race-build and
// never a second engine: the ladder's weeks and kilometres ARE the fixture build's,
// the taper and race week read as the server's kinds, run volume is km per week
// whatever the pace units, and the finish estimate is a fit word — never a score.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHost, flush, loadClientModule, renderHtml } from "./_dom.mjs";

const MODULES = [
  "html-utils",
  "ui-components",
  "ui-actions-client",
  "ui-chart",
  "format-utils",
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
      weeks_to_race: 7,
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
    why: "7 weeks to Riverside Half: this week is 32 km with a 13 km long run.",
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
  assert.equal(row.querySelector(".race-ladder-foot").textContent, "18 km run so far of 32 km.");
  assert.equal(Number(row.querySelector(".race-ladder-logged").style.getPropertyValue("--frac")), 0.45);
  // Only this week has a logged fill.
  assert.equal(host.querySelectorAll(".race-ladder-logged").length, 1);
});

test("a banked week says so; nothing run yet says nothing (never a zero)", () => {
  const win = load();
  const banked = paint(win, build({ this_week: { ...build().this_week, logged_km: 33.4 } }));
  assert.equal(
    banked.querySelector(".is-current .race-ladder-foot").textContent,
    "33.4 km run, the week's 32 km is in."
  );
  assert.equal(Number(banked.querySelector(".race-ladder-logged").style.getPropertyValue("--frac")), 0.835);
  const none = paint(win, build({ this_week: { ...build().this_week, logged_km: 0 } }));
  assert.equal(none.querySelector(".is-current .race-ladder-foot"), null);
  assert.equal(none.querySelector(".race-ladder-logged"), null);
  assert.doesNotMatch(none.querySelector(".is-current").textContent, /\b0 km\b/);
});

test("the taper and race week read as the server's kinds, with race day on race week", () => {
  const win = load();
  const host = paint(win, build());
  const kinds = host
    .querySelectorAll(".race-ladder-row")
    .map((row) => row.querySelector(".race-ladder-kind").firstChild.textContent);
  assert.deepEqual(kinds, ["Build", "Down week", "Build", "Build", "Peak", "Peak", "Taper", "Race"]);
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

test("run volume is km per week, whatever the pace units", () => {
  const win = load();
  const host = paint(win, build(), { units: "mi" });
  for (const km of host.querySelectorAll(".race-ladder-km")) assert.match(km.textContent, /^\d+(\.\d)? km$/);
  assert.doesNotMatch(host.querySelector(".race-ladder").textContent, /\bmi\b|mile/);
  assert.equal(host.querySelector(".race-ladder-unit").textContent, "km per week");
  // Paces follow the athlete's units; volume never does.
  assert.match(host.querySelector(".race-view-pace dd").textContent, /\/mi/);
});

// ---------- the head and the estimate ----------

test("the head frames the race: its name, weeks to race and race day", () => {
  const win = load();
  const host = paint(win, build());
  assert.equal(host.querySelector(".race-view-event").textContent, "Riverside Half");
  assert.equal(host.querySelector(".race-view-when").textContent, "7 weeks to race · Sunday, Nov 8");
  assert.match(host.querySelector(".race-view-head .lbl").textContent, /Building/);
  const week = paint(win, build({ race: { ...build().race, weeks_to_race: 0, days_to_race: 4 } }));
  assert.match(week.querySelector(".race-view-when").textContent, /^Race week/);
  const one = paint(win, build({ race: { ...build().race, weeks_to_race: 1, days_to_race: 9 } }));
  assert.match(one.querySelector(".race-view-when").textContent, /^1 week to race/);
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
  const host = paint(win, build({ race: { ...build().race, event: "<b>Half</b>" }, why: "<i>why</i>" }));
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
  assert.deepEqual(notes, [build().why, build().strength.principle]);
});

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
  const reason = "No dated race on file — set one and the build reads from it.";
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
