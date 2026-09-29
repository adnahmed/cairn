// The Fuel surface's composition (coach-meals-screen.ts renderFoodJournal/renderMeals,
// docs/V2-PLAN.md wave 2). Fuel (/app/today/fuel, opened from Today) paints its
// shell at once, titled "Fuel" with a "‹ Today" back link, and mounts each Fuel
// component into its own slot; a meal logged from the composer refreshes every slot
// that reads the day without leaving the screen; "Start from this" opens the composer
// filled; Plan → Meals redirects here with the meal-plan journal open as history.
// Components are faked: their own tests drive them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHost, flush, loadClientModule } from "./_dom.mjs";

const TODAY = "2026-04-25";

function load({ logDate = "", firstPaint = () => null } = {}) {
  const mounts = {};
  const events = [];
  const fakeController = (name, extra = {}) => ({
    // The read keys Fuel primes on a cold open (the real controllers' own spelling).
    dayKey: (date) => `food:day:${date}`,
    bandKey: (date) => `fuel:band:${date}`,
    dayPath: (date) => `/nutrition/day?date=${date}`,
    bandPath: (date) => `/nutrition/intake-band?date=${date}`,
    key: (date) => `fuel:ideas:${date}`,
    path: (date, hour) => `/fuel/ideas?date=${date}&hour=${hour}`,
    mount: (host, deps) => {
      mounts[name] = { host, deps };
      const handle = () => events.push(`${name}:teardown`);
      handle.refresh = async () => {
        events.push(`${name}:refresh`);
      };
      Object.assign(handle, extra);
      return handle;
    },
  });
  const state = { logDate, planSeg: "edit", tab: "plan" };
  const routes = [];
  const tabs = [];
  const bundles = [];
  const journal = [];
  const globals = {
    state,
    escHtml: (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
    escAttr: (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
    activateTab: (name) => tabs.push(name),
    // The shell's home-back helpers (ui-shell.ts), faked the way they behave.
    homeBackHtml: (home, label) => `<button class="home-back" type="button" data-home-back="${home}">‹ ${label}</button>`,
    wireHomeBack: (root) =>
      root.querySelector("[data-home-back]")?.addEventListener("click", (e) => tabs.push(e.currentTarget.dataset.homeBack)),
    pollToken: 0,
    headerTitle: { textContent: "" },
    CairnUiHeader: {
      shortDate: (iso) => `short(${iso})`,
      setEyebrowTitle: (el, text) => {
        el.textContent = text;
      },
    },
    segBar: (active) => `<div class="seg" data-active="${active}"></div>`,
    planSeg: () => [],
    wireSeg: () => {},
    localISO: () => TODAY,
    loadingState: (label) => `<p>${label}</p>`,
    skelLines: () => `<div class="skel-card"></div>`,
    reducedMotion: () => true,
    peekCached: () => null,
    cachedApi: () => new Promise(() => {}),
    paintSWR: async () => undefined,
    swrInvalidate: (key) => events.push(`invalidate:${key}`),
    markRefreshing: () => {},
    runCountUps: () => {},
    syncRouteFromState: (mode) => routes.push(mode),
    // The meal-plan journal lives in the lazy meals bundle, reached through withBundle.
    withBundle: (name, fn) => {
      bundles.push(name);
      return fn();
    },
    CairnMealJournal: {
      paint: async (token, slot) => {
        journal.push({ token, slot });
      },
    },
    CairnFuelDeps: {
      today: (date, today) => ({ date, today }),
      meals: (date, today, _token, onChanged) => ({ date, today, onChanged }),
      log: (onLogged) => ({ onLogged }),
      ideas: (date, onStart) => ({ date, onStart }),
      // Warm by default (null: paint at once); a test hands in a pending first paint.
      firstPaint: (date, isToday) => firstPaint(date, isToday),
    },
    CairnFuelToday: { skeletonHtml: () => `<div class="fuel-today-skel"></div>` },
    CairnFuelTodayController: fakeController("today"),
    CairnFuelMealsController: fakeController("meals"),
    CairnFuelLogController: fakeController("log", {
      open: (prefill) => events.push(`log:open:${prefill ?? ""}`),
    }),
    CairnIdeaCardController: fakeController("ideas"),
  };
  const win = loadClientModule(["06-coach-meals"], { globals });
  const view = createHost(win.document);
  win.view = view;
  win.$ = (sel) => view.querySelector(sel);
  return { win, view, mounts, events, state, routes, tabs, bundles, journal };
}

test("Fuel paints its shell under Today and mounts every component into its slot", () => {
  const { win, view, mounts, state, tabs } = load();
  win.renderFoodJournal();
  assert.equal(state.planSeg, "food");
  // Fuel lives under Today: its own title, no Plan seg bar, one quiet way back.
  // v2 wave 7: Fuel wears the Today home's mono eyebrow and names the day it shows.
  assert.equal(win.headerTitle.textContent, `Fuel · short(${TODAY})`);
  assert.equal(view.querySelector(".seg"), null);
  const back = view.querySelector("[data-home-back]");
  assert.equal(back.getAttribute("data-home-back"), "today");
  assert.match(back.textContent, /‹ Today/);
  back.click();
  assert.deepEqual(tabs, ["today"]);
  for (const id of ["dayFuelSlot", "fuelLogSlot", "fuelMealsSlot", "fuelIdeasSlot", "energyCard", "fuelHistory"]) {
    assert.ok(view.querySelector(`#${id}`), `#${id}`);
  }
  assert.equal(mounts.today.host, view.querySelector("#dayFuelSlot"));
  assert.equal(mounts.log.host, view.querySelector("#fuelLogSlot"));
  assert.equal(mounts.meals.host, view.querySelector("#fuelMealsSlot"));
  assert.equal(mounts.ideas.host, view.querySelector("#fuelIdeasSlot"));
  assert.equal(mounts.today.deps.date, TODAY);
  assert.equal(view.querySelector("#fuelHistory").hasAttribute("open"), false, "history stays folded");
});

test("a folded history never loads the meal planner: Fuel's first paint is eager only", () => {
  const { win, bundles } = load();
  win.renderFoodJournal();
  assert.deepEqual(bundles, [], "no withBundle(\"meals\") until the fold opens");
});

test("a cold open holds the day card's skeleton and writes the surface once the slots' reads answer", async () => {
  let answer;
  const asked = [];
  const { win, view, mounts, state } = load({
    firstPaint: (date, isToday) => {
      asked.push([date, isToday]);
      return new Promise((resolve) => (answer = resolve));
    },
  });
  const painted = win.renderFoodJournal();
  // The day card's own skeleton holds the top; no slot is mounted yet, so nothing
  // can fill in and push the others down one by one.
  assert.ok(view.querySelector(".fuel-today-skel"));
  assert.equal(view.querySelector("#dayFuelSlot"), null);
  assert.equal(mounts.today, undefined);
  assert.deepEqual(asked, [[TODAY, true]]);
  answer();
  await painted;
  assert.equal(state.planSeg, "food");
  assert.equal(mounts.today.host, view.querySelector("#dayFuelSlot"));
  assert.equal(mounts.ideas.host, view.querySelector("#fuelIdeasSlot"));
  assert.equal(view.querySelector(".fuel-today-skel"), null);
});

test("a cold open whose person has left writes nothing when the reads answer", async () => {
  let answer;
  const { win, view, mounts, state } = load({ firstPaint: () => new Promise((resolve) => (answer = resolve)) });
  const painted = win.renderFoodJournal();
  state.tab = "today";
  answer();
  await painted;
  assert.equal(mounts.today, undefined);
  assert.equal(view.querySelector("#dayFuelSlot"), null);
});

test("a meal logged from the composer refreshes every slot that reads the day", () => {
  const { win, mounts, events } = load();
  win.renderFoodJournal();
  events.length = 0;
  mounts.log.deps.onLogged({ turnId: 1, notes: [{ id: 9 }], reply: null });
  assert.ok(events.includes("meals:refresh"));
  assert.ok(events.includes("today:refresh"));
  assert.ok(events.includes("ideas:refresh"));
  assert.ok(events.includes("invalidate:progress:intake"));
});

test("Start from this opens the composer filled — the surface never logs it", () => {
  const { win, mounts, events } = load();
  win.renderFoodJournal();
  mounts.ideas.deps.onStart("Greek yogurt (a half portion)", { key: "yogurt@0.5" });
  assert.ok(events.includes("log:open:Greek yogurt (a half portion)"));
});

test("a correction in a meal card refreshes today's numbers and the ideas", () => {
  const { win, mounts, events } = load();
  win.renderFoodJournal();
  events.length = 0;
  mounts.meals.deps.onChanged();
  assert.ok(events.includes("today:refresh"));
  assert.ok(events.includes("ideas:refresh"));
});

test("another day is read and corrected only: no composer, no ideas", () => {
  const { win, view, mounts } = load({ logDate: "2026-04-20" });
  win.renderFoodJournal();
  assert.equal(view.querySelector("#fuelLogSlot"), null);
  assert.equal(view.querySelector("#fuelIdeasSlot"), null);
  assert.equal(mounts.log, undefined);
  assert.equal(mounts.ideas, undefined);
  assert.equal(mounts.today.deps.date, "2026-04-20");
});

test("Plan → Meals redirects into Fuel with the meal-plan journal open as history", async () => {
  const { win, view, state, routes, bundles, journal } = load();
  await win.renderMeals();
  assert.equal(state.planSeg, "food");
  assert.ok(view.querySelector(".food-journal"));
  assert.equal(view.querySelector("#fuelHistory").hasAttribute("open"), true);
  assert.equal(view.querySelector("#fuelHistory").dataset.painted, "1", "the journal paints into the fold");
  assert.deepEqual(bundles, ["meals"], "the planner is the lazy meals bundle's");
  assert.equal(journal[0]?.slot, view.querySelector("#fuelHistorySlot"));
  assert.deepEqual(routes, ["replace"], "the URL follows to /app/today/fuel");
});

test("a second visit tears the previous mounts down first", async () => {
  const { win, events } = load();
  win.renderFoodJournal();
  events.length = 0;
  win.renderFoodJournal();
  await flush();
  for (const name of ["today", "meals", "log", "ideas"]) assert.ok(events.includes(`${name}:teardown`), name);
});

test("a meal-plan history action repaints the fold alone: Today, Log and Meals stay mounted", async () => {
  const { win, view, mounts, events, routes } = load();
  await win.renderMeals();
  const todaySlot = view.querySelector("#dayFuelSlot");
  const logSlot = view.querySelector("#fuelLogSlot");
  routes.length = 0;
  events.length = 0;
  const token = win.pollToken;
  await win.repaintMealHistory();
  assert.deepEqual(
    events.filter((e) => e.endsWith(":teardown")),
    [],
    "no component is torn down by a history action"
  );
  assert.ok(events.includes("invalidate:meals:plans"), "the journal re-reads");
  assert.equal(view.querySelector("#dayFuelSlot"), todaySlot, "the shell is the same node");
  assert.equal(view.querySelector("#fuelLogSlot"), logSlot);
  assert.equal(mounts.log.host, logSlot);
  assert.equal(win.pollToken, token, "no re-render, so no watcher is orphaned");
  assert.deepEqual(routes, [], "and no navigation");
});

test("off the Fuel surface a history action still reaches the journal", async () => {
  const { win, view, state } = load();
  view.innerHTML = `<div id="meallist"></div>`;
  await win.repaintMealHistory();
  assert.equal(state.planSeg, "food");
  assert.equal(view.querySelector("#fuelHistory").hasAttribute("open"), true);
});
