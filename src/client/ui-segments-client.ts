// @ts-check
// Segmented navigation plus the discipline state that gates Plan's Endurance tab.
// Train's group/leaf nav also carries one CROSS-VIEW leaf: Program → Plan opens the
// plan editor (the Plan view, which lives under the Train home), so its handler
// navigates with activateTab instead of repainting the Progress view in place.

type UiSegmentsSegment = readonly [string, string];
type UiSegmentsHandlerMap = Record<string, () => unknown>;
type UiSegmentsDeps = {
  root: ParentNode;
  state: Pick<ClientAppState, "planSeg" | "planJump" | "progressSeg">;
  activateTab(name: string): unknown;
  segmentedNavHtml(options: { active: unknown; items: ReadonlyArray<UiSegmentsSegment> }): string;
  withViewTransition(fn: () => unknown): Promise<unknown> | unknown;
  viewEnter(): unknown;
  syncRouteFromState(): unknown;
  requestAnimationFrame(callback: FrameRequestCallback): number;
  cancelAnimationFrame(handle: number): void;
  addResizeListener(listener: () => void): void;
  renderTrainOverview(): unknown;
  renderProgress(): unknown;
  renderVolume(): unknown;
  renderEndurance(): unknown;
  renderWeight(): unknown;
  renderMeasurements(): unknown;
  renderCalendar(): unknown;
  renderHistory(): unknown;
  renderProgram(): unknown;
  renderIntake(): unknown;
  renderEnergy(): unknown;
  renderPlanEditor(): unknown;
  renderPlanEndurance(): unknown;
  renderFoodJournal(): unknown;
  renderMeals(): unknown;
  renderCoach(): unknown;
};
type UiSegmentsController = {
  segBar(active: unknown, items: ReadonlyArray<UiSegmentsSegment>): string;
  wireSeg(handlers: UiSegmentsHandlerMap): void;
  fitSeg(seg: Element | null | undefined): void;
  progressHandlers: UiSegmentsHandlerMap;
  /** Train's nav as painted OUTSIDE the Progress view (the plan editor): every
   *  Progress leaf navigates there, and Plan repaints the editor in place. */
  progressLinkHandlers: UiSegmentsHandlerMap;
  planSeg(): readonly UiSegmentsSegment[];
  planHandlers: UiSegmentsHandlerMap;
};
type UiSegmentsApi = {
  PROGRESS_SEG: readonly UiSegmentsSegment[];
  PROGRESS_GROUPS: readonly UiSegmentsSegment[];
  progressGroupOf(leaf: unknown): string;
  progressNav(activeLeaf: string): string;
  create(deps: UiSegmentsDeps): UiSegmentsController;
  setDiscipline(discipline: unknown): string;
  isEndurance(): boolean;
  isHybrid(): boolean;
  setEnduranceGoalSet(present: unknown): boolean;
  showEnduranceTab(): boolean;
};

declare var primaryDiscipline: string;
declare var enduranceGoalSet: boolean;

const UI_PROGRESS_SEGMENTS: readonly UiSegmentsSegment[] = [
  ["overview", "Overview"],
  ["sessions", "History"],
  ["trend", "1RM"],
  ["volume", "Volume"],
  ["endurance", "Endurance"],
  ["weight", "Weight"],
  ["measurements", "Measurements"],
  ["calendar", "Calendar"],
  ["plan", "Plan"],
  ["program", "Program"],
  ["intake", "Intake"],
  ["energy", "Energy"],
];

// Train's two-level nav: the flat views regroup into 4 top GROUPS, each with an
// optional sub-bar of leaves. Program holds the program you are running — the plan
// editor (Plan) and the program read (Program) — and Fuel the adaptive-nutrition
// trends, as their own top slots instead of the tail of a wide scroll bar; "Body"
// is the home for body-composition reads. The ROUTE stays the leaf
// (/app/train/<leaf>), so every deep link is unchanged.
const UI_PROGRESS_GROUPS: readonly UiSegmentsSegment[] = [
  ["train", "Train"],
  ["program", "Program"],
  ["fuel", "Fuel"],
  ["body", "Body"],
];
const UI_PROGRESS_GROUP_LEAVES: Record<string, readonly string[]> = {
  train: ["overview", "sessions", "trend", "volume", "endurance", "calendar"],
  program: ["plan", "program"],
  fuel: ["intake", "energy"],
  body: ["weight", "measurements"],
};
// Leaves that open ANOTHER view (the Plan view's editor) rather than a Progress one.
const UI_PROGRESS_CROSS_VIEW_LEAVES: ReadonlySet<string> = new Set(["plan"]);
const UI_PROGRESS_LEAF_GROUP: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const group of Object.keys(UI_PROGRESS_GROUP_LEAVES)) {
    for (const leaf of UI_PROGRESS_GROUP_LEAVES[group]) map[leaf] = group;
  }
  return map;
})();

function uiProgressGroupOf(leaf: unknown): string {
  return UI_PROGRESS_LEAF_GROUP[String(leaf || "")] || "train";
}
function uiProgressLeafLabel(leaf: string): string {
  const found = UI_PROGRESS_SEGMENTS.find(([k]) => k === leaf);
  return found ? found[1] : leaf;
}
// A group's visible leaves — endurance is hidden unless the user's discipline
// shows it OR it's the active view (so a deep-link to it is never stranded).
function uiProgressVisibleLeaves(group: string, activeLeaf: string): string[] {
  const leaves = UI_PROGRESS_GROUP_LEAVES[group] || [];
  return leaves.filter((leaf) => leaf !== "endurance" || uiSegmentsShowEnduranceTab() || activeLeaf === "endurance");
}
// A group tap stays in the view it was tapped from when it can: Program opens the
// Program read, and the editor stays one leaf away.
function uiProgressGroupDefaultLeaf(group: string): string {
  const leaves = uiProgressVisibleLeaves(group, "");
  return leaves.find((leaf) => !UI_PROGRESS_CROSS_VIEW_LEAVES.has(leaf)) || leaves[0] || "sessions";
}

// Top group bar — the sliding segmented control, but the buttons carry
// data-proggroup, wired to their group's default leaf.
function uiProgressGroupBar(activeGroup: string): string {
  return CairnUi.segmentedHtml({
    items: UI_PROGRESS_GROUPS,
    active: activeGroup,
    label: "Progress sections",
    attr: "proggroup",
  });
}
// Sub-bar of the active group's leaves (leaf buttons keep data-seg so the existing
// wireSeg handler map drives them). The leaf variant omits a single-view group.
function uiProgressSubBar(group: string, activeLeaf: string): string {
  const leaves = uiProgressVisibleLeaves(group, activeLeaf);
  return CairnUi.segmentedHtml({
    items: leaves.map((leaf) => [leaf, uiProgressLeafLabel(leaf)] as const),
    active: activeLeaf,
    label: "Progress view",
    variant: "leaf",
    className: "prog-subseg",
    wrapClass: "prog-subwrap",
  });
}
function uiProgressNav(activeLeaf: string): string {
  const group = uiProgressGroupOf(activeLeaf);
  return uiProgressGroupBar(group) + uiProgressSubBar(group, activeLeaf);
}

let uiPrimaryDiscipline = "strength";
let uiEnduranceGoalSet = false;

function normalizeUiDiscipline(discipline: unknown): string {
  return discipline === "endurance" || discipline === "hybrid" ? discipline : "strength";
}

function uiDisciplinePropertyValue(discipline: unknown): string {
  return String(discipline || "strength");
}

function uiSegmentsSetDiscipline(discipline: unknown): string {
  uiPrimaryDiscipline = normalizeUiDiscipline(discipline);
  return uiPrimaryDiscipline;
}

function uiSegmentsIsEndurance(): boolean {
  return uiPrimaryDiscipline === "endurance";
}

function uiSegmentsIsHybrid(): boolean {
  return uiPrimaryDiscipline === "hybrid";
}

function uiSegmentsSetEnduranceGoalSet(present: unknown): boolean {
  uiEnduranceGoalSet = !!present;
  return uiEnduranceGoalSet;
}

function uiSegmentsShowEnduranceTab(): boolean {
  return uiSegmentsIsEndurance() || uiSegmentsIsHybrid() || uiEnduranceGoalSet;
}

Object.defineProperty(globalThis, "primaryDiscipline", {
  configurable: true,
  get: () => uiPrimaryDiscipline,
  set: (value) => {
    uiPrimaryDiscipline = uiDisciplinePropertyValue(value);
  },
});

Object.defineProperty(globalThis, "enduranceGoalSet", {
  configurable: true,
  get: () => uiEnduranceGoalSet,
  set: (value) => {
    uiEnduranceGoalSet = !!value;
  },
});

function createUiSegments(deps: UiSegmentsDeps): UiSegmentsController {
  let segFitRaf = 0;
  // Handlers that navigate to another view. They run bare: activateTab owns the
  // swap, the route sync and the focus, so wrapping them in a second transition
  // would double-animate.
  const crossView = new WeakSet<() => unknown>();
  function navigation(fn: () => unknown): () => unknown {
    crossView.add(fn);
    return fn;
  }

  function segBar(active: unknown, items: ReadonlyArray<UiSegmentsSegment>): string {
    // The Progress seg-set renders as a two-level group/leaf nav; every other
    // caller keeps the flat sliding segmented bar unchanged.
    if (items === UI_PROGRESS_SEGMENTS) return uiProgressNav(String(active ?? ""));
    return deps.segmentedNavHtml({ active, items });
  }

  function fitSeg(seg: Element | null | undefined): void {
    if (!seg) return;
    const el = seg as HTMLElement;
    el.classList.add("seg-scroll");
    const overflow = el.scrollWidth > el.clientWidth + 1;
    seg.classList.toggle("seg-scroll", overflow);
    if (overflow) {
      const active = el.querySelector<HTMLElement>(".segbtn.active");
      if (active) el.scrollLeft = active.offsetLeft - (el.clientWidth - active.offsetWidth) / 2;
    }
  }

  function wireSeg(handlers: UiSegmentsHandlerMap): void {
    const drive = (button: HTMLElement, handler: () => unknown): void => {
      if (crossView.has(handler)) {
        handler();
        return;
      }
      const seg = button.closest(".seg");
      if (seg) {
        const index = [...seg.querySelectorAll<HTMLElement>(".segbtn")].indexOf(button);
        (seg as HTMLElement).style.setProperty("--segi", String(index));
      }
      deps.withViewTransition(() =>
        Promise.resolve(handler()).then(() => {
          deps.syncRouteFromState();
          return deps.viewEnter();
        })
      );
    };
    deps.root.querySelectorAll<HTMLElement>(".segbtn").forEach((button) =>
      button.addEventListener("click", () => {
        const handler = handlers[String(button.dataset.seg || "")];
        if (!handler) return; // group buttons (data-proggroup, no data-seg) fall to the loop below
        drive(button, handler);
      })
    );
    // Progress top-group buttons — a tap lands on the group's default leaf. Tapping
    // the group you're already in is a no-op (its sub-bar already holds the choice).
    deps.root.querySelectorAll<HTMLElement>(".segbtn[data-proggroup]").forEach((button) =>
      button.addEventListener("click", () => {
        if (button.classList.contains("active")) return;
        const handler = handlers[uiProgressGroupDefaultLeaf(String(button.dataset.proggroup || ""))];
        if (handler) drive(button, handler);
      })
    );
    deps.root.querySelectorAll(".seg").forEach(fitSeg);
  }

  function scheduleFit(): void {
    deps.cancelAnimationFrame(segFitRaf);
    segFitRaf = deps.requestAnimationFrame(() => deps.root.querySelectorAll(".seg").forEach(fitSeg));
  }

  const progressHandlers: UiSegmentsHandlerMap = {
    overview: () => deps.renderTrainOverview(),
    trend: () => deps.renderProgress(),
    volume: () => deps.renderVolume(),
    endurance: () => deps.renderEndurance(),
    weight: () => deps.renderWeight(),
    measurements: () => deps.renderMeasurements(),
    calendar: () => deps.renderCalendar(),
    sessions: () => deps.renderHistory(),
    program: () => deps.renderProgram(),
    intake: () => deps.renderIntake(),
    energy: () => deps.renderEnergy(),
    plan: () => openPlan("edit"),
  };
  navigation(progressHandlers.plan);

  function openPlan(section: ClientPlanSection): void {
    deps.state.planSeg = section;
    deps.state.planJump = section === "edit" ? null : section;
    deps.activateTab("plan");
  }

  const progressLinkHandlers: UiSegmentsHandlerMap = { plan: () => deps.renderPlanEditor() };
  for (const [leaf] of UI_PROGRESS_SEGMENTS) {
    if (UI_PROGRESS_CROSS_VIEW_LEAVES.has(leaf)) continue;
    progressLinkHandlers[leaf] = navigation(() => {
      deps.state.progressSeg = leaf as ClientProgressSection;
      deps.activateTab("progress");
    });
  }

  // The Plan seg bar. Fuel (Today), Changes (Ask) and the editor (Train) no longer
  // wear it; the race view still does until Horizon takes it over, so each segment
  // NAVIGATES (activateTab) and the lit home and URL follow the destination.
  // Food is the Fuel surface; the old Meals segment redirects into it (its weekly
  // journal is history in Food's fold), so the bar no longer carries a Meals pill.
  // "Changes" is the /app/plan/coach route — the background-coaching change record.
  // It rides the bar as its own segment (last, after the things you edit) so the
  // screen is reachable from the bar and paints its own active pill instead of
  // being a dead-end drill-in you could only reach from a deep link. The KEY stays
  // "coach" so every existing route, jump and deep link is unchanged; the LABEL is
  // "Changes" because the Coach *tab* is chat, and two "Coach" affordances on one
  // screen would be the same word for two different places.
  function planSeg(): readonly UiSegmentsSegment[] {
    const routedToEndurance = deps.state.planSeg === "endurance" || deps.state.planJump === "endurance";
    return uiSegmentsShowEnduranceTab() || routedToEndurance
      ? [
          ["edit", "Training"],
          ["endurance", "Endurance"],
          ["food", "Food"],
          ["coach", "Changes"],
        ]
      : [
          ["edit", "Training"],
          ["food", "Food"],
          ["coach", "Changes"],
        ];
  }

  const planHandlers: UiSegmentsHandlerMap = {
    edit: () => openPlan("edit"),
    endurance: () => openPlan("endurance"),
    food: () => openPlan("food"),
    meals: () => openPlan("meals"),
    coach: () => openPlan("coach"),
  };
  for (const handler of Object.values(planHandlers)) navigation(handler);

  deps.addResizeListener(scheduleFit);

  return {
    segBar,
    wireSeg,
    fitSeg,
    progressHandlers,
    progressLinkHandlers,
    planSeg,
    planHandlers,
  };
}

const CAIRN_UI_SEGMENTS: UiSegmentsApi = {
  PROGRESS_SEG: UI_PROGRESS_SEGMENTS,
  PROGRESS_GROUPS: UI_PROGRESS_GROUPS,
  progressGroupOf: uiProgressGroupOf,
  progressNav: uiProgressNav,
  create: createUiSegments,
  setDiscipline: uiSegmentsSetDiscipline,
  isEndurance: uiSegmentsIsEndurance,
  isHybrid: uiSegmentsIsHybrid,
  setEnduranceGoalSet: uiSegmentsSetEnduranceGoalSet,
  showEnduranceTab: uiSegmentsShowEnduranceTab,
};

Object.assign(globalThis, { CairnUiSegments: CAIRN_UI_SEGMENTS });

if (typeof window !== "undefined") {
  Object.assign(window, { CairnUiSegments: CAIRN_UI_SEGMENTS });
}
