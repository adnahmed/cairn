// The one segmented control (CairnUi.segmentedHtml, src/client/ui-components.ts)
// and the call sites built on it: the section bar, the Progress group/leaf bars,
// the Health sub-tabs, the Profile choice groups, and the Stand clinical flags.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadClientModule, renderHtml } from "./_dom.mjs";

function load() {
  return loadClientModule(["html-utils", "ui-components"]);
}

test("sliding variant: a labelled group with its thumb, one pressed button, keys escaped", () => {
  const win = load();
  const host = renderHtml(
    win.CairnUi.segmentedHtml({
      items: [
        ["read", "Read"],
        [`mark"ers`, "Markers <all>"],
      ],
      active: `mark"ers`,
      label: "Health sections",
      attr: "hseg",
      className: "hseg",
      wrapClass: "hsegwrap",
    }),
    { document: win.document }
  );
  const wrap = host.querySelector(".segwrap.hsegwrap");
  const group = wrap.querySelector(".seg.seg-sliding.hseg");
  assert.equal(group.getAttribute("role"), "group");
  assert.equal(group.getAttribute("aria-label"), "Health sections");
  assert.equal(group.style.getPropertyValue("--segn"), "2");
  assert.equal(group.style.getPropertyValue("--segi"), "1");
  assert.equal(group.querySelector(".seg-thumb").getAttribute("aria-hidden"), "true");
  const buttons = [...group.querySelectorAll("button.segbtn")];
  assert.deepEqual(
    buttons.map((b) => [
      b.getAttribute("type"),
      b.dataset.hseg,
      b.getAttribute("aria-pressed"),
      b.classList.contains("active"),
    ]),
    [
      ["button", "read", "false", false],
      ["button", `mark"ers`, "true", true],
    ]
  );
  assert.equal(buttons[1].textContent, "Markers <all>");
  assert.equal(buttons[1].children.length, 0, "a label never becomes markup");
});

test("plain variant: an inline choice group with no wrapper, thumb or aria-pressed", () => {
  const win = load();
  const host = renderHtml(
    win.CairnUi.segmentedHtml({
      variant: "plain",
      id: "sexSeg",
      className: "sex-seg",
      label: "Sex",
      attr: "sex",
      active: "male",
      items: [
        ["female", "Female"],
        ["male", "Male"],
      ],
      attrs: { "data-clinflag": "smoking" },
    }),
    { document: win.document }
  );
  const group = host.querySelector("#sexSeg");
  assert.equal(group.className, "seg sex-seg");
  assert.equal(group.dataset.clinflag, "smoking");
  assert.equal(host.querySelector(".segwrap, .seg-thumb"), null);
  assert.equal(group.querySelector("[aria-pressed]"), null);
  assert.equal(group.querySelector(".segbtn.active").dataset.sex, "male");
});

test("leaf variant is omitted when there is nothing to choose", () => {
  const win = load();
  assert.equal(
    win.CairnUi.segmentedHtml({
      variant: "leaf",
      label: "Progress view",
      items: [["program", "Program"]],
      active: "program",
    }),
    ""
  );
  const two = win.CairnUi.segmentedHtml({
    variant: "leaf",
    label: "Progress view",
    items: [
      ["intake", "Intake"],
      ["energy", "Energy"],
    ],
    active: "energy",
  });
  assert.match(two, /seg-sliding/);
});

test("segmentedNavHtml is the section-navigation sliding bar", () => {
  const win = load();
  const nav = win.CairnUi.segmentedNavHtml({ items: [["edit", "Training"]], active: "edit" });
  const expected = win.CairnUi.segmentedHtml({
    items: [["edit", "Training"]],
    active: "edit",
    label: "Section navigation",
  });
  assert.equal(nav, expected);
});

test("Health sub-tabs are the shared control and keep aria-pressed in step with the choice", async () => {
  const win = loadClientModule(["html-utils", "ui-components", "me-health-tabs-controller"]);
  const root = renderHtml("", { document: win.document });
  const painted = [];
  const deps = {
    root,
    headerTitle: win.document.createElement("h1"),
    state: { healthSeg: "markers", healthSegPicked: true, tab: "me", meSeg: "health" },
    segments: [],
    handlers: {},
    segBar: () => "",
    wireSeg: () => {},
    fitSeg: () => {},
    invalidatePoll: () => {},
    healthDocsKnownEmpty: () => false,
    syncRouteFromState: () => {},
    withViewTransition: (fn) => fn(),
    select: () => null,
    paintRecords: () => painted.push("records"),
    paintShare: () => painted.push("share"),
    paintLearned: () => painted.push("learned"),
    paintMarkers: () => painted.push("markers"),
    paintRead: () => painted.push("read"),
  };
  await win.CairnMeHealthTabsController.renderHealth(deps);
  const group = root.querySelector(".hsegwrap .hseg");
  assert.equal(group.getAttribute("role"), "group");
  assert.equal(group.querySelector('[data-hseg="markers"]').getAttribute("aria-pressed"), "true");
  await group.querySelector('[data-hseg="share"]').click();
  assert.equal(group.querySelector('[data-hseg="share"]').getAttribute("aria-pressed"), "true");
  assert.equal(group.querySelector('[data-hseg="markers"]').getAttribute("aria-pressed"), "false");
  assert.equal(group.style.getPropertyValue("--segi"), "3");
  assert.deepEqual(painted, ["markers", "share"]);
});
