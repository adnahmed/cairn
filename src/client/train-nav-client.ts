// @ts-check
// Train's navigation is ONE level. The Progress views fold into 4 top GROUPS, and
// each group has one LANDING leaf that wears the group bar (Train → Overview,
// Program → the Program read, Fuel → Intake, Body → Weight). Every other leaf sits
// one tap deeper: its landing lists it as a hairline row, and the leaf itself wears
// one quiet "‹ Group" step back instead of a second row of tabs. The ROUTE stays the
// leaf (/app/train/<leaf>), so every deep link is unchanged. ui-segments-client.ts
// wires what this module builds.

type TrainNavSegment = readonly [string, string];
type TrainNavApi = {
  GROUPS: readonly TrainNavSegment[];
  groupOf(leaf: unknown): string;
  landingOf(group: string): string;
  isLanding(leaf: string): boolean;
  /** The nav a leaf wears: the group bar on a landing, the step back elsewhere. */
  navHtml(activeLeaf: string): string;
  /** A landing's rows into its deeper leaves ("" on a deeper leaf). */
  deeperHtml(activeLeaf: string, showEndurance: boolean): string;
};

const TRAIN_NAV_GROUPS: readonly TrainNavSegment[] = [
  ["train", "Train"],
  ["program", "Program"],
  ["fuel", "Fuel"],
  ["body", "Body"],
];
// Each group's leaves, its landing first.
const TRAIN_NAV_GROUP_LEAVES: Record<string, readonly string[]> = {
  train: ["overview", "sessions", "trend", "volume", "endurance", "calendar"],
  program: ["program", "plan"],
  fuel: ["intake", "energy"],
  body: ["weight", "measurements"],
};
// A deeper leaf's row on its landing: a plain name and one muted line on what sits
// behind it. Words only; the numbers live one tap deeper.
const TRAIN_NAV_DEEPER_ROWS: Record<string, readonly [string, string]> = {
  sessions: ["History", "Every session, lift by lift"],
  trend: ["Lift trends", "Estimated 1RM over time, one lift at a time"],
  volume: ["Volume", "Working sets by muscle, the last 30 days"],
  endurance: ["Endurance", "Runs and rides, the week and the build"],
  calendar: ["Calendar", "Twelve weeks of training at a glance"],
  plan: ["The plan", "Edit the days, the lifts and their targets"],
  energy: ["Energy balance", "What you burn against what you eat"],
  measurements: ["Measurements", "Tape sites and what they add up to"],
};

function trainNavGroupOf(leaf: unknown): string {
  const key = String(leaf || "");
  return Object.keys(TRAIN_NAV_GROUP_LEAVES).find((group) => TRAIN_NAV_GROUP_LEAVES[group].includes(key)) || "train";
}
function trainNavLandingOf(group: string): string {
  return (TRAIN_NAV_GROUP_LEAVES[group] || TRAIN_NAV_GROUP_LEAVES.train)[0];
}
function trainNavIsLanding(leaf: string): boolean {
  return trainNavLandingOf(trainNavGroupOf(leaf)) === leaf;
}
function trainNavGroupLabel(group: string): string {
  return (TRAIN_NAV_GROUPS.find(([key]) => key === group) || TRAIN_NAV_GROUPS[0])[1];
}

// The Fuel group reads the trends (Intake, Energy); logging is a same-day act that
// Today's Fuel owns. One quiet text link leads there, so the trends never strand
// someone who came to log — a link, not a card: it must not read as a second place
// to log, nor lead the screen above the read itself.
function trainNavFuelPointerHtml(): string {
  const routes = typeof routeApi === "function" ? routeApi() : null;
  const href = routes?.routeToUrl({ tab: "plan", section: "food" }) || "/app/today/fuel";
  return `<a class="train-fuel-link" href="${escAttr(href)}" data-fuel-log-point>Log food on Today's Fuel <span aria-hidden="true">›</span></a>`;
}

// A landing wears the group bar (its buttons carry data-proggroup) plus a hidden
// marker that tells wireSeg to lay the landing's deeper rows in; a deeper leaf
// wears only its step back.
function trainNavHtml(activeLeaf: string): string {
  const group = trainNavGroupOf(activeLeaf);
  const pointer = group === "fuel" ? trainNavFuelPointerHtml() : "";
  if (!trainNavIsLanding(activeLeaf)) {
    return `<button class="home-back linkbtn linkbtn-plain train-crumb" type="button" data-train-leaf="${escAttr(trainNavLandingOf(group))}">‹ ${escHtml(trainNavGroupLabel(group))}</button>${pointer}`;
  }
  const bar = CairnUi.segmentedHtml({ items: TRAIN_NAV_GROUPS, active: group, label: "Train sections", attr: "proggroup" });
  return `${bar}<span hidden data-train-landing="${escAttr(activeLeaf)}"></span>${pointer}`;
}

// Endurance is listed only for an athlete who runs (the leaf itself is always
// routable, and a deep link to it always has its step back).
function trainNavDeeperHtml(activeLeaf: string, showEndurance: boolean): string {
  if (!trainNavIsLanding(activeLeaf)) return "";
  const group = trainNavGroupOf(activeLeaf);
  const rows = TRAIN_NAV_GROUP_LEAVES[group]
    .filter((leaf) => leaf !== activeLeaf && TRAIN_NAV_DEEPER_ROWS[leaf] && (leaf !== "endurance" || showEndurance))
    .map((leaf) => {
      const [name, meta] = TRAIN_NAV_DEEPER_ROWS[leaf];
      return `<button class="train-deeper-row" type="button" data-train-leaf="${escAttr(leaf)}">
      <span class="train-deeper-main"><span class="train-deeper-name">${escHtml(name)}</span><span class="train-deeper-meta">${escHtml(meta)}</span></span>
      <span class="train-deeper-arw" aria-hidden="true">›</span>
    </button>`;
    })
    .join("");
  if (!rows) return "";
  const kicker = group === "train" ? "Deeper" : `More in ${trainNavGroupLabel(group)}`;
  return `<nav class="train-deeper" aria-label="${escAttr(kicker)}"><div class="lbl train-deeper-kick">${escHtml(kicker)}</div>${rows}</nav>`;
}

const CAIRN_TRAIN_NAV: TrainNavApi = {
  GROUPS: TRAIN_NAV_GROUPS,
  groupOf: trainNavGroupOf,
  landingOf: trainNavLandingOf,
  isLanding: trainNavIsLanding,
  navHtml: trainNavHtml,
  deeperHtml: trainNavDeeperHtml,
};

Object.assign(globalThis, { CairnTrainNav: CAIRN_TRAIN_NAV });
