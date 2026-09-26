// The Horizon timeline (horizon-model/-client/-controller/-screen; docs/V2-PLAN.md
// wave 5, "Horizon"): three lanes on one line of time — the race (a read over
// GET /api/race-build through the race view's own model, never a second engine), the
// goal line (the journey read and the road-ahead timeline) and labs and scans (past
// draws from the health documents, what is ahead in the checkup's own words). Every
// lab row routes into You's Health pages; no lane ever sits empty, and nothing reads
// as a score. Synthetic fixtures only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHost, flush, loadClientModule } from "./_dom.mjs";

const MODULES = [
  "html-utils",
  "ui-components",
  "ui-actions-client",
  "ui-chart",
  "format-utils",
  "journey-progress-client",
  "journey-timeline-client",
  "race-view-model",
  "race-estimate-client",
  "race-ladder-client",
  "race-view-client",
  "horizon-model",
  "horizon-client",
  "horizon-controller",
];

function load(globals = {}) {
  return loadClientModule(MODULES, { globals });
}

const TODAY = "2026-09-16";
// Values built inside the client sandbox, compared as plain data.
const plain = (value) => JSON.parse(JSON.stringify(value));
const SCORE = /score|\/\s*100|\d\s*%|percent|grade|rating/i;

const WEEKS = [
  ["2026-09-07", 8, "build", 30, 12, false],
  ["2026-09-14", 7, "build", 32, 13, true],
  ["2026-09-21", 6, "down", 26, 13, false],
  ["2026-09-28", 5, "build", 35.5, 15, false],
  ["2026-10-05", 4, "build", 38, 16, false],
  ["2026-10-12", 3, "peak", 40, 18, false],
  ["2026-10-19", 2, "peak", 36, 16, false],
  ["2026-10-26", 1, "taper", 28, 12, false],
  ["2026-11-02", 0, "race", 30, 21.1, false],
].map(([week_start, weeks_to_race, kind, km, long_km, current]) => ({
  week_start,
  weeks_to_race,
  phase: "build",
  kind,
  km,
  long_km,
  quality_hint: "",
  strength_hint: "",
  current,
}));

function build(overrides = {}) {
  return {
    available: true,
    as_of: TODAY,
    race: {
      event: "Riverside Half",
      date: "2026-11-08",
      distance_km: 21.1,
      days_to_race: 53,
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
      as_of: TODAY,
      trend: null,
      gap_sec: 271,
      fit: "stretch",
    },
    paces: null,
    this_week: { week_start: "2026-09-14", km: 32, long_km: 13, logged_km: 18, quality: null, why: "" },
    weeks: WEEKS,
    leg_map: [],
    strength: null,
    ride: null,
    review: { weeks: [], longest_recent_km: 13, volume_word: "steady" },
    why: "4:31 off the target",
    reason: null,
    ...overrides,
  };
}

function journey() {
  return {
    profile: {
      start_weight_lb: 205,
      start_date: "2026-06-01",
      goal_weight_lb: 180,
      goal_bodyfat_pct: null,
      goal_mode: "lose",
    },
    body_fat: null,
    active_phase: { kind: "cut", start_date: "2026-06-01", target_weight_lb: 180 },
    proposed_phases: [],
    transition_suggestion: null,
    milestones: [],
    recomposition: {
      stage: { kind: "mid_cut", label: "Mid-cut" },
      progress: {
        current_weight_lb: 195.4,
        goal_weight_lb: 180,
        remaining_lb: 15.4,
        robust_trend_lb_wk: -0.84,
        progress_fraction: 0.4,
      },
    },
    goal_consistency: null,
  };
}

function timeline() {
  return [
    { id: "past", kind: "retest", when: { date: "2026-09-01" }, label: "Bench re-test", detail: null, basis: "" },
    { id: "recheck:ldl", kind: "recheck", when: { date: "2026-10-01" }, label: "LDL recheck", detail: null, basis: "" },
    {
      id: "rescan:dexa",
      kind: "rescan",
      when: { window: { start: "2026-10-20", end: "2026-11-17" } },
      label: "DEXA re-scan window",
      detail: null,
      basis: "",
    },
    { id: "block", kind: "block", when: { date: "2026-10-05" }, label: "Block ends", detail: "Week 6 of 6", basis: "" },
    {
      id: "goal",
      kind: "goal",
      when: { date: "2026-11-15" },
      label: "Goal weight",
      detail: null,
      basis: "declared goal",
    },
    { id: "std", kind: "milestone", when: {}, label: "Bodyweight bench on the horizon", detail: null, basis: "" },
  ];
}

function docs() {
  return [
    { id: 11, kind: "bloodwork", doc_date: "2026-08-02", original_name: "panel.pdf" },
    { id: 12, kind: "visit_note", doc_date: "2026-08-20" },
    { id: 13, kind: "dexa", doc_date: "2026-07-10" },
    { id: 14, kind: "bloodwork", doc_date: "2026-03-02" },
    { id: 15, kind: "imaging", doc_date: null, created_at: "2026-05-01T12:00:00Z" },
    { id: 16, kind: "bloodwork", doc_date: "2026-10-30" },
  ];
}

function checkup(overrides = {}) {
  return {
    lede: "The window for a LDL-C recheck is open.",
    due_now: [
      {
        signal_key: "lab:ldl",
        label: "LDL-C",
        kind: "lab",
        next_due: "2026-09-10",
        when_text: "window is open",
        why: "",
      },
    ],
    upcoming: [
      {
        signal_key: "dexa",
        label: "DEXA re-scan",
        kind: "dexa",
        next_due: "2026-10-20",
        when_text: "worth considering around late October",
        why: "",
      },
      {
        signal_key: "lab:a1c",
        label: "HbA1c",
        kind: "lab",
        next_due: "2026-12-01",
        when_text: "opens in about ten weeks",
        why: "",
      },
      {
        signal_key: "lab:tsh",
        label: "TSH",
        kind: "lab",
        next_due: "2027-01-01",
        when_text: "opens in about fifteen weeks",
        why: "",
      },
    ],
    follow_through: [],
    prep: { ordered_labs: [], bring: [], questions: [] },
    has_content: true,
    frame: "",
    ...overrides,
  };
}

// ---------- the race lane ----------

test("race lane: the build read through the race view's own model, this week onward, race week last", () => {
  const win = load();
  const lane = win.CairnHorizonModel.raceLane(build());
  assert.equal(lane.key, "race");
  assert.equal(lane.state, "set");
  assert.equal(lane.headline, "Riverside Half");
  assert.match(lane.when, /^7 weeks to race · Sunday, Nov 8$/);
  assert.equal(lane.fit, "stretch");
  assert.equal(lane.fit_word, "Stretch");
  // The ladder starts at the current week and keeps race week, whatever the cap.
  const rows = lane.ladder.rows;
  assert.equal(rows[0].week_start, "2026-09-14");
  assert.equal(rows[0].current, true);
  assert.equal(rows.at(-1).kind, "race");
  assert.ok(rows.length <= 4);
  // The km are the server's own, per week.
  for (const row of rows) {
    const week = WEEKS.find((w) => w.week_start === row.week_start);
    assert.equal(row.km, week.km);
    assert.match(row.km_text, / km$/);
  }
  assert.deepEqual(plain(lane.links[0].target), { tab: "plan", section: "endurance" });
});

test("race lane: no race is 'No race set' with the way to set one, never an empty lane", () => {
  const win = load();
  const lane = win.CairnHorizonModel.raceLane({ available: false, race: null, weeks: [], reason: "" });
  assert.equal(lane.state, "none");
  assert.equal(lane.headline, "No race set");
  assert.match(lane.lede, /You → Profile/);
  assert.equal(lane.links[0].label, "Set a race goal");
  assert.deepEqual(plain(lane.links[0].target), { tab: "me", section: "profile" });
  // The server's own reason wins when it has one.
  const reasoned = win.CairnHorizonModel.raceLane({
    available: false,
    race: null,
    weeks: [],
    reason: "The race is past.",
  });
  assert.equal(reasoned.lede, "The race is past.");
});

test("race lane: a failed read says so in one calm line", () => {
  const win = load();
  const lane = win.CairnHorizonModel.raceLane(null);
  assert.equal(lane.state, "unread");
  assert.match(lane.headline, /couldn't be read just now/);
});

// ---------- the goal line ----------

test("goal line: the phase read, the bodyweight toward the goal, and the non-lab rows still ahead", () => {
  const win = load();
  const lane = win.CairnHorizonModel.goalLane(journey(), timeline(), TODAY);
  assert.equal(lane.state, "set");
  assert.match(lane.headline, /Mid-cut/);
  assert.equal(lane.lede, "195.4 lb now, 180 lb the goal. Trending down about 0.8 lb a week.");
  const labels = lane.rows.map((row) => row.label);
  // Lab rows belong to the labs lane; a past re-test and an undated standard stay off.
  assert.deepEqual(plain(labels), ["Block ends", "Goal weight"]);
  assert.ok(lane.rows.every((row) => row.side === "ahead"));
  assert.deepEqual(plain(lane.links[0].target), { tab: "horizon", section: "goal" });
});

test("goal line: a steady trend reads steady; no journey and no road is 'No goal line yet'", () => {
  const win = load();
  const read = journey();
  read.recomposition.progress.robust_trend_lb_wk = 0.02;
  assert.match(win.CairnHorizonModel.weightLine(read), /holding steady/);
  const none = win.CairnHorizonModel.goalLane(null, [], TODAY);
  assert.equal(none.state, "none");
  assert.equal(none.headline, "No goal line yet");
  assert.deepEqual(plain(none.links[0].target), { tab: "me", section: "profile" });
  const unread = win.CairnHorizonModel.goalLane(null, null, TODAY);
  assert.equal(unread.state, "unread");
});

// ---------- labs and scans ----------

test("labs lane: the newest three draws and scans behind today, oldest first, each opening its record", () => {
  const win = load();
  const lane = win.CairnHorizonModel.labsLane(docs(), checkup(), timeline(), TODAY);
  const behind = lane.rows.filter((row) => row.side === "behind");
  // A visit note is not a draw; a document dated after today is not behind it.
  assert.deepEqual(plain(behind.map((row) => row.label)), ["Imaging", "DEXA scan", "Bloodwork"]);
  assert.deepEqual(plain(behind.map((row) => row.target)), [
    { tab: "stand", section: "records", id: "15" },
    { tab: "stand", section: "records", id: "13" },
    { tab: "stand", section: "records", id: "11" },
  ]);
});

test("labs lane: what is ahead is the checkup's own words, capped, with a DEXA row opening Body", () => {
  const win = load();
  const lane = win.CairnHorizonModel.labsLane(docs(), checkup(), timeline(), TODAY);
  const ahead = lane.rows.filter((row) => row.side === "ahead");
  assert.deepEqual(plain(ahead.map((row) => [row.label, row.when])), [
    ["LDL-C", "window is open"],
    ["DEXA re-scan", "worth considering around late October"],
    ["HbA1c", "opens in about ten weeks"],
  ]);
  assert.deepEqual(plain(ahead[0].target), { tab: "stand", section: "checkup" });
  assert.deepEqual(plain(ahead[1].target), { tab: "stand", section: "body" });
  assert.equal(lane.lede, "The window for a LDL-C recheck is open.");
  // Behind rows lead, ahead rows follow: one line of time.
  const sides = lane.rows.map((row) => row.side);
  assert.equal(sides.lastIndexOf("behind") < sides.indexOf("ahead"), true);
});

test("labs lane: with no checkup read, the timeline's own rechecks stand in", () => {
  const win = load();
  const lane = win.CairnHorizonModel.labsLane(docs(), null, timeline(), TODAY);
  const ahead = lane.rows.filter((row) => row.side === "ahead");
  assert.deepEqual(plain(ahead.map((row) => row.label)), ["LDL recheck", "DEXA re-scan window"]);
  assert.equal(ahead[1].target.section, "body");
  assert.equal(lane.lede, "");
});

test("labs lane: nothing yet is a way to add them; a failed read is one calm line", () => {
  const win = load();
  const none = win.CairnHorizonModel.labsLane(
    [],
    checkup({ due_now: [], upcoming: [], has_content: false }),
    [],
    TODAY
  );
  assert.equal(none.state, "none");
  assert.equal(none.headline, "No labs or scans yet");
  assert.equal(none.links[0].label, "Add labs or scan");
  assert.deepEqual(plain(none.links[0].target), { tab: "stand", section: null });
  const unread = win.CairnHorizonModel.labsLane(null, null, null, TODAY);
  assert.equal(unread.state, "unread");
});

// ---------- the view ----------

function lanes(win) {
  const m = win.CairnHorizonModel;
  return [
    m.raceLane(build()),
    m.goalLane(journey(), timeline(), TODAY),
    m.labsLane(docs(), checkup(), timeline(), TODAY),
  ];
}

test("each lane paints its words, the race lane the ladder, and every row a real link", () => {
  const win = load();
  const hrefFor = (t) => `/app/${t.tab}${t.section ? `/${t.section}` : ""}${t.id ? `?id=${t.id}` : ""}`;
  const host = createHost(win.document);
  host.innerHTML = lanes(win)
    .map((lane) => win.CairnHorizon.laneHtml(lane, { hrefFor }))
    .join("");
  const cards = host.querySelectorAll(".horizon-lane-card");
  assert.equal(cards.length, 3);
  assert.equal(cards[0].querySelectorAll(".race-ladder-row").length, 4);
  assert.equal(cards[0].querySelector(".race-estimate-word").textContent, "Stretch");
  const labRows = cards[2].querySelectorAll(".horizon-row-link");
  assert.equal(labRows.length, 6);
  assert.equal(labRows[0].getAttribute("href"), "/app/stand/records?id=15");
  // The rail carries one Today mark between behind and ahead.
  assert.equal(cards[2].querySelectorAll(".horizon-now").length, 1);
  assert.doesNotMatch(host.textContent, SCORE);
  // Never the server's why (its gap-as-verdict clause).
  assert.doesNotMatch(host.textContent, /off the target/);
});

test("server text stays text", () => {
  const win = load();
  const read = build({ race: { ...build().race, event: '<img src=x onerror="boom()">' } });
  const host = createHost(win.document);
  host.innerHTML = win.CairnHorizon.laneHtml(win.CairnHorizonModel.raceLane(read));
  assert.equal(host.querySelector("img"), null);
  assert.match(host.querySelector(".horizon-lane-title").textContent, /<img/);
});

// ---------- the controller ----------

function reads({ fail = [] } = {}) {
  const table = {
    "/race-build": build(),
    "/journey": journey(),
    "/journey/timeline": timeline(),
    "/health-docs": docs(),
    "/health/next-checkup": checkup(),
  };
  const calls = [];
  const load = (path) => {
    calls.push(path);
    if (fail.includes(path)) return Promise.reject(new Error("offline"));
    return Promise.resolve(table[path] ?? null);
  };
  return { load, calls };
}

test("the timeline paints the three lane skeletons, then each lane as its reads land", async () => {
  const win = load();
  const host = createHost(win.document);
  host.innerHTML = win.CairnHorizon.shellHtml();
  const root = host.querySelector("[data-horizon]");
  assert.equal(root.querySelectorAll(".horizon-lane-card.is-loading").length, 3);
  const { load: loader, calls } = reads();
  win.CairnHorizonController.mount(root, { today: TODAY, load: loader, navigate: () => {} });
  await flush();
  await flush();
  assert.equal(root.querySelectorAll(".is-loading").length, 0);
  assert.equal(root.querySelector('[data-horizon-lane="race"] .horizon-lane-title').textContent, "Riverside Half");
  assert.match(root.querySelector('[data-horizon-lane="goal"] .horizon-lane-title').textContent, /Mid-cut/);
  assert.equal(root.querySelector('[data-horizon-lane="labs"] .horizon-lane-title').textContent, "What's next");
  // The timeline is read once and shared by both lanes that need it.
  assert.equal(calls.filter((p) => p === "/journey/timeline").length, 1);
  assert.equal(root.querySelector(".horizon-lane-card").classList.contains("settle-in"), true);
});

test("one lane's failed read is that lane's calm line; the others still paint; reduced motion paints still", async () => {
  const win = load();
  const host = createHost(win.document);
  host.innerHTML = win.CairnHorizon.shellHtml();
  const root = host.querySelector("[data-horizon]");
  const { load: loader } = reads({ fail: ["/race-build"] });
  win.CairnHorizonController.mount(root, { today: TODAY, load: loader, navigate: () => {}, reducedMotion: () => true });
  await flush();
  await flush();
  const race = root.querySelector('[data-horizon-lane="race"] .horizon-lane-card');
  assert.ok(race.classList.contains("is-unread"));
  assert.match(race.textContent, /couldn't be read just now/);
  assert.match(root.querySelector('[data-horizon-lane="goal"]').textContent, /Mid-cut/);
  assert.equal(root.querySelectorAll(".settle-in").length, 0);
});

test("a lab row routes into Health through navigate; a modified click keeps the link", async () => {
  const win = load();
  const host = createHost(win.document);
  host.innerHTML = win.CairnHorizon.shellHtml();
  const root = host.querySelector("[data-horizon]");
  const went = [];
  const { load: loader } = reads();
  win.CairnHorizonController.mount(root, { today: TODAY, load: loader, navigate: (t) => went.push(t) });
  await flush();
  await flush();
  const rows = root.querySelectorAll('[data-horizon-lane="labs"] .horizon-row-link');
  await rows[0].click();
  assert.deepEqual(plain(went), [{ tab: "stand", section: "records", id: "15" }]);
  const goal = root.querySelector('[data-horizon-lane="goal"] .horizon-lane-link');
  await goal.click();
  assert.deepEqual(plain(went.at(-1)), { tab: "horizon", section: "goal" });
});

test("reads that land after the timeline was left write nothing", async () => {
  const win = load();
  const host = createHost(win.document);
  host.innerHTML = win.CairnHorizon.shellHtml();
  const root = host.querySelector("[data-horizon]");
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const teardown = win.CairnHorizonController.mount(root, {
    today: TODAY,
    load: (path) => gate.then(() => (path === "/race-build" ? build() : null)),
    navigate: () => {},
  });
  teardown();
  release();
  await flush();
  await flush();
  assert.equal(root.querySelectorAll(".is-loading").length, 3);
});

// ---------- the screen ----------

test("Horizon's landing is the timeline; its goal section is the journey story with a back link to the timeline", async () => {
  const document = (await import("./_dom.mjs")).createDocument();
  const view = createHost(document);
  const headerTitle = { textContent: "" };
  const state = { horizonSeg: null };
  const tabs = [];
  const win = loadClientModule([...MODULES, "horizon-screen"], {
    document,
    globals: {
      view,
      headerTitle,
      state,
      pollToken: 0,
      stagger: (i) => `--i:${i}`,
      loadingState: () => `<p class="loading">Reading…</p>`,
      localISO: () => TODAY,
      reducedMotion: () => true,
      homeBackHtml: (home, label) =>
        `<button class="home-back" type="button" data-home-back="${home}">‹ ${label}</button>`,
      activateTab: (name) => tabs.push(name),
      applyRouteState: (route) => {
        state.routed = route;
        return route.tab;
      },
      routeApi: () => null,
      api: (path) => reads().load(path),
    },
  });
  win.renderHorizon();
  assert.equal(headerTitle.textContent, "Horizon");
  assert.ok(view.querySelector("[data-horizon]"));

  state.horizonSeg = "goal";
  await win.renderHorizon();
  assert.equal(headerTitle.textContent, "Goal line");
  assert.ok(view.querySelector(".jprog-card"));
  assert.ok(view.querySelector(".ftl-card"));
  await view.querySelector("[data-home-back]").click();
  assert.equal(state.horizonSeg, null, "back is the timeline, never the goal section again");
  assert.deepEqual(tabs, ["horizon"]);

  // A lab row goes through the app's router, so Health's lazy bundle loads on arrival.
  win.horizonNavigate({ tab: "stand", section: "records", id: "11" });
  assert.equal(state.routed.tab, "stand");
  assert.equal(state.routed.section, "records");
  assert.equal(state.routed.id, "11");
  assert.deepEqual(tabs, ["horizon", "stand"]);
});
