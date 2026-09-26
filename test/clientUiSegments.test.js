import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import ts from "typescript";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const styles = readFileSync(join(root, "public/styles.css"), "utf8");

function classList() {
  const values = new Set();
  return {
    add: (...items) => items.forEach((item) => values.add(item)),
    toggle: (item, force) => {
      if (force) values.add(item);
      else values.delete(item);
    },
    contains: (item) => values.has(item),
  };
}

function loadSegments() {
  const context = { Object, Promise, String };
  context.globalThis = context;
  context.window = context;
  // The Progress bars are built by the shared segmented control (CairnUi.segmentedHtml).
  for (const file of ["public/js/html-utils.js", "public/js/ui-components.js"]) {
    vm.runInNewContext(readFileSync(join(root, file), "utf8"), context);
  }
  const source = readFileSync(join(root, "src/client/ui-segments-client.ts"), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      alwaysStrict: false,
      ignoreDeprecations: "6.0",
      module: ts.ModuleKind.None,
      moduleDetection: ts.ModuleDetectionKind.Legacy,
      removeComments: false,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: "src/client/ui-segments-client.ts",
    reportDiagnostics: true,
  }).outputText;
  vm.runInNewContext(`(() => {\n${compiled.trimEnd()}\n})();\n`, context);
  return context;
}

function createController(context, overrides = {}) {
  const calls = [];
  const resizeListeners = [];
  const view = overrides.view || { querySelectorAll: () => [] };
  const state = overrides.state || {};
  const deps = {
    root: view,
    state,
    segmentedNavHtml: ({ active, items }) => `<seg data-active="${active}" data-items="${items.length}"></seg>`,
    withViewTransition: (fn) => {
      calls.push(["transition"]);
      return fn();
    },
    viewEnter: () => calls.push(["viewEnter"]),
    syncRouteFromState: () => calls.push(["syncRouteFromState"]),
    requestAnimationFrame: (fn) => {
      calls.push(["raf"]);
      fn();
      return 1;
    },
    cancelAnimationFrame: (handle) => calls.push(["cancelAnimationFrame", handle]),
    addResizeListener: (listener) => resizeListeners.push(listener),
    renderProgress: () => calls.push(["renderProgress"]),
    renderVolume: () => calls.push(["renderVolume"]),
    renderEndurance: () => calls.push(["renderEndurance"]),
    renderWeight: () => calls.push(["renderWeight"]),
    renderCalendar: () => calls.push(["renderCalendar"]),
    renderHistory: () => calls.push(["renderHistory"]),
    renderProgram: () => calls.push(["renderProgram"]),
    renderEnergy: () => calls.push(["renderEnergy"]),
    renderPlanEditor: () => calls.push(["renderPlanEditor"]),
    renderPlanEndurance: () => calls.push(["renderPlanEndurance"]),
    renderFoodJournal: () => calls.push(["renderFoodJournal"]),
    renderMeals: () => calls.push(["renderMeals"]),
    renderCoach: () => calls.push(["renderCoach"]),
    activateTab: (name) => calls.push(["activateTab", name]),
    ...overrides.deps,
  };
  const controller = context.CairnUiSegments.create(deps);
  return { calls, controller, resizeListeners, state, view };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

function segmentKeys(segments) {
  return Array.from(segments, ([key]) => key);
}

function segmentLabels(segments) {
  return Array.from(segments, ([, label]) => label);
}

test("UI segments expose compatibility globals and Plan endurance visibility", () => {
  const context = loadSegments();
  const { controller, state } = createController(context);

  assert.equal(context.CairnUiSegments, context.window.CairnUiSegments);
  assert.deepEqual(segmentKeys(controller.planSeg()), ["edit", "food", "coach"]);
  assert.deepEqual(segmentLabels(controller.planSeg()), ["Training", "Food", "Changes"]);
  assert.equal(
    Object.hasOwn(controller.planHandlers, "coach"),
    true,
    "the change record is reachable from the bar and keeps its own route"
  );

  context.CairnUiSegments.setDiscipline("hybrid");
  assert.equal(context.primaryDiscipline, "hybrid");
  assert.equal(context.CairnUiSegments.isHybrid(), true);
  assert.deepEqual(segmentKeys(controller.planSeg()), ["edit", "endurance", "food", "coach"]);

  context.CairnUiSegments.setDiscipline("strength");
  context.CairnUiSegments.setEnduranceGoalSet(true);
  assert.equal(context.enduranceGoalSet, true);
  assert.deepEqual(segmentKeys(controller.planSeg()), ["edit", "endurance", "food", "coach"]);

  context.CairnUiSegments.setEnduranceGoalSet(false);
  state.planJump = "endurance";
  assert.deepEqual(segmentKeys(controller.planSeg()), ["edit", "endurance", "food", "coach"]);

  context.primaryDiscipline = "custom";
  assert.equal(context.primaryDiscipline, "custom");
  assert.equal(context.CairnUiSegments.isEndurance(), false);
});

test("UI segments delegate rendering, click routing, resize fitting, and handlers", async () => {
  const context = loadSegments();
  const button = {
    dataset: { seg: "trend" },
    listeners: {},
    addEventListener(type, fn) {
      this.listeners[type] = fn;
    },
    closest() {
      return seg;
    },
  };
  const active = { offsetLeft: 80, offsetWidth: 20 };
  const seg = {
    classList: classList(),
    clientWidth: 100,
    scrollLeft: 0,
    scrollWidth: 220,
    style: {
      props: {},
      setProperty(name, value) {
        this.props[name] = value;
      },
    },
    querySelector(selector) {
      return selector === ".segbtn.active" ? active : null;
    },
    querySelectorAll(selector) {
      return selector === ".segbtn" ? [button] : [];
    },
  };
  const view = {
    querySelectorAll(selector) {
      if (selector === ".segbtn") return [button];
      if (selector === ".seg") return [seg];
      return [];
    },
  };
  const { calls, controller, resizeListeners } = createController(context, { view });

  assert.equal(controller.segBar("trend", [["trend", "1RM"]]), `<seg data-active="trend" data-items="1"></seg>`);
  assert.equal(resizeListeners.length, 1);

  controller.wireSeg(controller.progressHandlers);
  button.listeners.click();
  await flush();

  assert.equal(seg.style.props["--segi"], "0");
  assert.ok(calls.some((call) => call[0] === "transition"));
  assert.ok(calls.some((call) => call[0] === "renderProgress"));
  assert.ok(calls.some((call) => call[0] === "syncRouteFromState"));
  assert.ok(calls.some((call) => call[0] === "viewEnter"));

  controller.fitSeg(seg);
  assert.equal(seg.classList.contains("seg-scroll"), true);
  assert.equal(seg.scrollLeft, 40);

  resizeListeners[0]();
  assert.ok(calls.some((call) => call[0] === "cancelAnimationFrame"));
  assert.ok(calls.some((call) => call[0] === "raf"));

  // The Plan bar's segments NAVIGATE (a Plan section can live under another
  // home), so the lit tab and the URL follow the destination.
  controller.planHandlers.endurance();
  assert.deepEqual(calls.at(-1), ["activateTab", "plan"]);
});

test("Train's Plan leaf and the editor's Progress leaves are cross-view navigations", async () => {
  const context = loadSegments();
  const state = { planSeg: "food", planJump: "food", progressSeg: "overview" };
  const leaf = (key) => ({
    dataset: { seg: key },
    listeners: {},
    addEventListener(type, fn) {
      this.listeners[type] = fn;
    },
    closest() {
      return null;
    },
  });
  const planBtn = leaf("plan");
  const historyBtn = leaf("sessions");
  const view = {
    querySelectorAll(selector) {
      return selector === ".segbtn" ? [planBtn, historyBtn] : [];
    },
  };
  const { calls, controller } = createController(context, { view, state });

  // From Train: Program → Plan opens the editor through activateTab, bare (no
  // second transition, no extra route sync: activateTab owns both).
  controller.wireSeg(controller.progressHandlers);
  planBtn.listeners.click();
  await flush();
  assert.equal(state.planSeg, "edit");
  assert.equal(state.planJump, null);
  assert.deepEqual(plain(calls), [["activateTab", "plan"]]);

  // From the editor: a Progress leaf returns to the Progress view on that leaf.
  calls.length = 0;
  controller.wireSeg(controller.progressLinkHandlers);
  historyBtn.listeners.click();
  await flush();
  assert.equal(state.progressSeg, "sessions");
  assert.deepEqual(plain(calls), [["activateTab", "progress"]]);
  assert.equal(Object.hasOwn(controller.progressLinkHandlers, "plan"), true);
});

test("Train nav groups its views into 4 top groups with leaf sub-tabs", () => {
  const context = loadSegments();
  const { controller } = createController(context);
  const PROGRESS_SEG = context.CairnUiSegments.PROGRESS_SEG;

  // Leaf → group mapping: Program holds the program you run (the plan editor and
  // the program read); Fuel the nutrition trends.
  assert.deepEqual(segmentKeys(context.CairnUiSegments.PROGRESS_GROUPS), ["train", "program", "fuel", "body"]);
  assert.deepEqual(segmentLabels(context.CairnUiSegments.PROGRESS_GROUPS), ["Train", "Program", "Fuel", "Body"]);
  assert.equal(context.CairnUiSegments.progressGroupOf("sessions"), "train");
  assert.equal(context.CairnUiSegments.progressGroupOf("program"), "program");
  assert.equal(context.CairnUiSegments.progressGroupOf("plan"), "program");
  assert.equal(context.CairnUiSegments.progressGroupOf("energy"), "fuel");
  assert.equal(context.CairnUiSegments.progressGroupOf("intake"), "fuel");
  assert.equal(context.CairnUiSegments.progressGroupOf("weight"), "body");

  // A multi-leaf group (Train) renders a top group bar + a leaf sub-bar; the
  // Endurance leaf is hidden for a strength athlete.
  context.CairnUiSegments.setDiscipline("strength");
  const trainNav = controller.segBar("volume", PROGRESS_SEG);
  assert.match(trainNav, /data-proggroup="train"[^>]*aria-pressed="true"/);
  assert.match(trainNav, /class="segwrap prog-subwrap"/);
  assert.match(trainNav, /data-seg="volume"[^>]*aria-pressed="true"/);
  assert.match(trainNav, /data-seg="sessions"/);
  assert.doesNotMatch(trainNav, /data-seg="endurance"/);

  // Fuel exposes Intake before Energy in its compact leaf bar.
  const fuelNav = controller.segBar("energy", PROGRESS_SEG);
  assert.match(fuelNav, /class="segwrap prog-subwrap"/);
  assert.match(fuelNav, />Intake</);
  assert.match(fuelNav, />Energy</);
  assert.match(fuelNav, /data-proggroup="fuel"[^>]*aria-pressed="true"/);
  assert.match(fuelNav, /data-seg="intake"/);
  assert.match(fuelNav, /data-seg="energy"[^>]*aria-pressed="true"/);

  // Program carries two leaves: Plan (the editor) and Program (the read).
  const programNav = controller.segBar("program", PROGRESS_SEG);
  assert.match(programNav, /data-proggroup="program"[^>]*aria-pressed="true"/);
  assert.match(programNav, /data-seg="plan"[^>]*>Plan</);
  assert.match(programNav, /data-seg="program"[^>]*aria-pressed="true"/);
  // The editor paints the same nav with its own leaf lit.
  const editorNav = controller.segBar("plan", PROGRESS_SEG);
  assert.match(editorNav, /data-proggroup="program"[^>]*aria-pressed="true"/);
  assert.match(editorNav, /data-seg="plan"[^>]*aria-pressed="true"/);

  // A non-Progress seg-set is untouched (still the flat sliding bar).
  assert.equal(controller.segBar("trend", [["trend", "1RM"]]), `<seg data-active="trend" data-items="1"></seg>`);
});

test("Progress group and leaf thumbs have distinct view-transition names", () => {
  assert.match(
    styles,
    /\.prog-subseg \.seg-thumb\s*\{view-transition-name:prog-subseg-thumb\}/,
    "the simultaneously rendered Progress leaf thumb must not share seg-thumb with the group bar"
  );
  assert.match(
    styles,
    /::view-transition-group\(prog-subseg-thumb\)\{animation-duration:var\(--dur-2\);animation-timing-function:var\(--ease\)\}/,
    "the scoped thumb retains the standard segmented transition timing"
  );
});

test("Progress endurance leaf appears for an endurance athlete or when it's active", () => {
  const context = loadSegments();
  const { controller } = createController(context);
  const PROGRESS_SEG = context.CairnUiSegments.PROGRESS_SEG;

  context.CairnUiSegments.setDiscipline("endurance");
  const nav = controller.segBar("endurance", PROGRESS_SEG);
  assert.match(nav, /data-proggroup="train"[^>]*aria-pressed="true"/);
  assert.match(nav, /data-seg="endurance"[^>]*aria-pressed="true"/);

  // A strength athlete deep-linked to Endurance still sees the tab (never stranded).
  context.CairnUiSegments.setDiscipline("strength");
  assert.match(controller.segBar("endurance", PROGRESS_SEG), /data-seg="endurance"/);
});

test("Progress top-group buttons route to the group's default leaf", async () => {
  const context = loadSegments();
  const groupBtn = {
    classList: classList(),
    dataset: { proggroup: "program" },
    listeners: {},
    addEventListener(type, fn) {
      this.listeners[type] = fn;
    },
    closest() {
      return seg;
    },
  };
  const seg = {
    style: { setProperty() {} },
    querySelectorAll() {
      return [groupBtn];
    },
  };
  const view = {
    querySelectorAll(selector) {
      if (selector === ".segbtn[data-proggroup]") return [groupBtn];
      if (selector === ".seg") return [];
      return [];
    },
  };
  const { calls, controller } = createController(context, { view });
  controller.wireSeg(controller.progressHandlers);
  groupBtn.listeners.click();
  await flush();

  assert.ok(
    calls.some((call) => call[0] === "renderProgram"),
    "the Program group opens the Program read, staying in the view it was tapped from"
  );
  assert.ok(calls.some((call) => call[0] === "syncRouteFromState"));
});

// v2 wave 5: Fuel logging moved to Today (/app/today/fuel). Train's Fuel group keeps
// the trends and carries one "Log food" line there; no other group does.
test("Train's Fuel group carries a Log food line to Today's Fuel, and only the Fuel group", () => {
  const context = loadSegments();
  Object.assign(context, { URL, URLSearchParams });
  vm.runInNewContext(readFileSync(join(root, "public/js/route-state.js"), "utf8"), context);
  context.routeApi = () => context.window.CairnRoutes;
  const { controller } = createController(context);
  const PROGRESS_SEG = context.CairnUiSegments.PROGRESS_SEG;
  for (const leaf of ["intake", "energy"]) {
    const html = controller.segBar(leaf, PROGRESS_SEG);
    assert.match(html, /<a class="tov-jpoint" href="\/app\/today\/fuel" data-fuel-log-point>/, leaf);
    assert.match(html, />Log food</);
  }
  for (const leaf of ["overview", "sessions", "program", "weight"]) {
    assert.doesNotMatch(controller.segBar(leaf, PROGRESS_SEG), /data-fuel-log-point/, leaf);
  }

  const link = {
    listeners: {},
    addEventListener(type, fn) {
      this.listeners[type] = fn;
    },
  };
  const view = {
    querySelectorAll: (selector) => (selector === "[data-fuel-log-point]" ? [link] : []),
  };
  const wired = createController(context, { view });
  wired.controller.wireSeg(wired.controller.progressHandlers);
  // A modified click keeps the link's own behaviour (a new tab).
  link.listeners.click({ button: 0, metaKey: true, preventDefault: () => assert.fail("not intercepted") });
  assert.deepEqual(plain(wired.calls), []);
  let prevented = false;
  link.listeners.click({ button: 0, preventDefault: () => (prevented = true) });
  assert.equal(prevented, true);
  assert.equal(wired.state.planJump, "food");
  assert.deepEqual(plain(wired.calls), [["activateTab", "plan"]]);
});
