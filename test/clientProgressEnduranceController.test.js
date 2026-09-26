import { test } from "node:test";
import assert from "node:assert/strict";
import { createDocument, createHost, loadClientModule } from "./_dom.mjs";

function loadProgressEnduranceController() {
  const globals = {
    enduranceGoalCard: () => "",
    runComplianceLine: () => "",
    weeklyRunPlanCard: () => "",
    raceBuildCard: (build, opts) => (build?.available ? `race-build:open${opts?.underGoal ? ":underGoal" : ""}` : ""),
    trainingAgendaCard: (agenda) => agenda?.available ? "agenda:open" : "",
    enduranceCoachLine: () => "",
    enduranceCalibrationLine: (status) =>
      status && Array.isArray(status.items) && status.items.some((item) => item.domain === "endurance")
        ? "calibration:aging"
        : "",
    cardioSyncLine: undefined,
    wireCardioSync: undefined,
    fmtKm: (value) => String(value),
    fmtPaceKm: (value) => String(value),
    escHtml: (value) => String(value ?? "").replace(/[&<>]/g, ""),
    stagger: (index) => `--i:${index}`,
    paceTrendWord: () => "",
    zoneBarHtml: () => "",
    enduranceBestRows: () => [],
    enduranceSportCardHtml: () => "",
    hybridLoadCardHtml: () => "",
    localISO: () => "2026-06-30",
  };
  return loadClientModule("progress-endurance-controller", { globals }).CairnProgressEnduranceController;
}

function controllerDeps(overrides = {}) {
  const apiCalls = [];
  let token = 0;
  const view = createHost(createDocument());
  const deps = {
    view,
    headerTitle: { textContent: "" },
    state: { tab: "progress", progressSeg: "sessions" },
    api: async (path) => {
      apiCalls.push(path);
      if (path === "/stats") return { endurance: null };
      if (path === "/endurance-prs") return { sports: [], longest_km: null, longest_min: null, best_pace: [] };
      if (path === "/settings") return { settings: {} };
      if (path.startsWith("/training-agenda")) return { available: true, intents: [] };
      if (path === "/program-state") return { hybrid: null };
      if (path.startsWith("/calibration/status"))
        return { status: { as_of: "2026-06-30", items: [] }, due: [] };
      return null;
    },
    nextToken: () => {
      token += 1;
      return token;
    },
    isCurrent: (value) => value === token,
    segmentHtml: (active) => `seg:${active}`,
    wireSegments: () => {
      deps.wired = (deps.wired || 0) + 1;
    },
    loading: (message) => `loading:${message}`,
    empty: (image, message) => `empty:${image}:${message}`,
    hero: (title, stats) => `hero:${title}:${stats.length}`,
    art: (kind, label) => `art:${kind}:${label}`,
    runCountUps: () => {
      deps.counted = true;
    },
    renderSelf: () => {
      deps.renderedSelf = true;
    },
    ...overrides,
  };
  return { deps, apiCalls, view };
}

test("progress endurance controller fans out reads and paints the empty endurance state", async () => {
  const controller = loadProgressEnduranceController();
  const { deps, apiCalls, view } = controllerDeps();

  await controller.render(deps);

  assert.equal(deps.headerTitle.textContent, "Endurance");
  assert.equal(deps.state.progressSeg, "endurance");
  assert.equal(deps.wired, 1);
  assert.deepEqual(apiCalls, [
    "/stats",
    "/endurance-prs",
    "/endurance-goal",
    "/run-compliance",
    "/settings",
    "/run-plan",
    "/race-build",
    "/training-agenda?date=2026-06-30",
    "/program-state",
    "/calibration/status?date=2026-06-30",
  ]);
  assert.match(view.querySelector("#endBody").innerHTML, /hero:Endurance:0/);
  assert.match(view.querySelector("#endBody").innerHTML, /agenda:open/);
  assert.match(view.querySelector("#endBody").innerHTML, /No runs or rides logged yet/);
});

test("progress endurance controller paints the calibration line when the ladder has endurance items", async () => {
  const controller = loadProgressEnduranceController();
  const { deps, view } = controllerDeps({
    api: async (path) => {
      if (path === "/stats") return { endurance: null };
      if (path === "/endurance-prs") return { sports: [], longest_km: null, longest_min: null, best_pace: [] };
      if (path === "/settings") return { settings: {} };
      if (path.startsWith("/training-agenda")) return { available: true, intents: [] };
      if (path === "/program-state") return { hybrid: null };
      if (path.startsWith("/calibration/status"))
        return {
          status: {
            as_of: "2026-06-30",
            items: [
              { key: "lthr", domain: "endurance", label: "Your threshold HR", last_anchored: "2026-02-01", freshness: "aging", due: false },
            ],
          },
          due: [],
        };
      return null;
    },
  });

  await controller.render(deps);
  assert.match(view.querySelector("#endBody").innerHTML, /calibration:aging/);
});

test("progress endurance controller keeps stale reads from repainting", async () => {
  const controller = loadProgressEnduranceController();
  const { deps, view } = controllerDeps({ isCurrent: () => false });

  await controller.render(deps);

  // No cached snapshot in this environment (no sessionStorage global in the vm
  // sandbox) -> the synchronous pre-fetch loading placeholder is what's showing.
  // The contract under test is that the FETCHED real content (hero/empty state)
  // never overwrites it once the read is stale — not that the placeholder itself
  // is blank.
  assert.equal(view.querySelector("#endBody").innerHTML, "loading:Reading your week...");
});

test("progress endurance controller asks the race build card to drop its own countdown, since the goal card above already states it", async () => {
  const controller = loadProgressEnduranceController();
  const { deps, view } = controllerDeps({
    api: async (path) => {
      if (path === "/stats") return { endurance: null };
      if (path === "/endurance-prs") return { sports: [], longest_km: null, longest_min: null, best_pace: [] };
      if (path === "/settings") return { settings: {} };
      if (path === "/race-build") return { available: true, race: { weeks_to_race: 4, phase: "build" } };
      if (path.startsWith("/training-agenda")) return { available: true, intents: [] };
      if (path === "/program-state") return { hybrid: null };
      if (path.startsWith("/calibration/status")) return { status: { as_of: "2026-06-30", items: [] }, due: [] };
      return null;
    },
  });

  await controller.render(deps);

  assert.match(view.querySelector("#endBody").innerHTML, /race-build:open:underGoal/);
});

test("the endurance voice line never sums several sports into one km figure", async () => {
  const controller = loadProgressEnduranceController();
  const paint = async (endurance) => {
    let voice = null;
    const { deps } = controllerDeps({
      hero: (title, stats, v) => {
        voice = v;
        return `hero:${title}:${stats.length}`;
      },
      api: async (path) => {
        if (path === "/stats") return { endurance };
        if (path === "/endurance-prs") return { sports: [], longest_km: null, longest_min: null, best_pace: [] };
        if (path === "/settings") return { settings: {} };
        if (path.startsWith("/training-agenda")) return { available: false, intents: [] };
        if (path === "/program-state") return { hybrid: null };
        if (path.startsWith("/calibration/status")) return { status: { as_of: "2026-06-30", items: [] }, due: [] };
        return null;
      },
    });
    await controller.render(deps);
    return voice;
  };
  const hybrid = await paint({
    week_km: 50,
    total_moving_min: 250,
    longest_km: 40,
    by_sport: {
      run: { sport: "run", distance_km: 10, moving_min: 60 },
      ride: { sport: "ride", distance_km: 40, moving_min: 190 },
    },
  });
  assert.equal(hybrid.line, "4 h 10 min moving this week.");
  assert.equal(hybrid.fact, "longest 40 km");
  assert.doesNotMatch(hybrid.line, /50 km/);

  const noTime = await paint({
    week_km: 50,
    by_sport: {
      run: { sport: "run", distance_km: 10 },
      ride: { sport: "ride", distance_km: 40 },
    },
  });
  assert.equal(noTime.line, "10 km of running this week.");

  const runOnly = await paint({ week_km: 12, total_moving_min: 70, by_sport: { run: { sport: "run", distance_km: 12, moving_min: 70 } } });
  assert.equal(runOnly.line, "12 km of running this week.");
});
