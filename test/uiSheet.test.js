// The shared overlay primitive (src/client/ui-sheet.ts, CairnUiSheet): the
// overlay rules in docs/DESIGN.md "Accessibility minimums" — role="dialog",
// aria-modal, a label, focus in and back to the opener, Escape and backdrop close,
// Tab stays inside, and the background is inert.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createFakeTimers, fire, loadClientModule } from "./_dom.mjs";

function load(globals = {}) {
  const timers = createFakeTimers();
  const win = loadClientModule(["html-utils", "ui-sheet"], {
    globals: { setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout, ...globals },
  });
  const doc = win.document;
  doc.body.innerHTML = `<main id="app"><button id="opener">Open</button></main><div class="toast" role="status"></div>`;
  return { win, doc, timers, sheet: win.CairnUiSheet };
}

const FORM = `<h2 id="t">Title &lt;b&gt;</h2><button type="button" data-ui-sheet-close>Close</button><input id="a"><button type="button" id="last">Save</button>`;

test("a sheet opens as a labelled modal dialog with the default classes", () => {
  const { doc, sheet, timers } = load();
  const handle = sheet.open({ html: FORM, labelledBy: "t", describedBy: "t" });
  const overlay = doc.querySelector(".ui-sheet-ov");
  const dialog = overlay.querySelector(".ui-sheet");
  assert.equal(handle.overlay, overlay);
  assert.equal(handle.sheet, dialog);
  assert.equal(dialog.getAttribute("role"), "dialog");
  assert.equal(dialog.getAttribute("aria-modal"), "true");
  assert.equal(dialog.getAttribute("aria-labelledby"), "t");
  assert.equal(dialog.getAttribute("aria-describedby"), "t");
  assert.equal(dialog.querySelector("h2").textContent, "Title <b>", "the caller's escaped markup is used as given");
  timers.runPending();
  assert.equal(doc.activeElement, dialog.querySelector("[data-ui-sheet-close]"), "focus moves to the first control");
});

test("an aria-label is escaped when no visible title is referenced", () => {
  const { doc, sheet } = load();
  sheet.open({ html: "<p>x</p>", label: `Connect "<Claude>"` });
  const dialog = doc.querySelector(".ui-sheet");
  assert.equal(dialog.getAttribute("aria-label"), `Connect "<Claude>"`);
  assert.equal(dialog.children.length, 1, "the label never becomes markup");
});

test("Escape and a backdrop tap close a dismissible sheet and focus returns to the opener", async () => {
  const { doc, sheet, timers } = load();
  const opener = doc.getElementById("opener");
  opener.focus();
  const reasons = [];
  sheet.open({ html: FORM, label: "A", onClose: (reason) => reasons.push(reason) });
  timers.runPending();
  await fire(doc.activeElement, "keydown", { key: "Escape" });
  assert.equal(doc.querySelector(".ui-sheet-ov"), null);
  assert.equal(doc.activeElement, opener);

  sheet.open({ html: FORM, label: "B", onClose: (reason) => reasons.push(reason) });
  await doc.querySelector(".ui-sheet").click();
  assert.ok(doc.querySelector(".ui-sheet-ov"), "a tap inside the dialog is not a backdrop tap");
  await doc.querySelector(".ui-sheet-ov").click();
  assert.equal(doc.querySelector(".ui-sheet-ov"), null);

  sheet.open({ html: FORM, label: "C", onClose: (reason) => reasons.push(reason) });
  await doc.querySelector("[data-ui-sheet-close]").click();
  assert.deepEqual(reasons, ["escape", "backdrop", "button"]);
});

test("a non-dismissible sheet ignores Escape and the backdrop", async () => {
  const { doc, sheet, timers } = load();
  const handle = sheet.open({ html: FORM, label: "Token", dismissible: false });
  timers.runPending();
  await fire(doc.activeElement, "keydown", { key: "Escape" });
  await doc.querySelector(".ui-sheet-ov").click();
  assert.equal(handle.isOpen(), true);
  handle.close();
  assert.equal(handle.isOpen(), false);
  assert.equal(doc.querySelector(".ui-sheet-ov"), null);
});

test("Tab wraps inside the sheet and skips hidden and disabled controls", async () => {
  const { doc, sheet, timers } = load();
  sheet.open({
    html: `<button type="button" id="first">One</button><div hidden><button type="button">Hidden</button></div><button type="button" disabled>Off</button><button type="button" id="end">End</button>`,
    label: "Trap",
  });
  timers.runPending();
  const first = doc.getElementById("first");
  const end = doc.getElementById("end");
  assert.equal(doc.activeElement, first);
  const back = await fire(first, "keydown", { key: "Tab", shiftKey: true });
  assert.equal(back.defaultPrevented, true);
  assert.equal(doc.activeElement, end);
  const forward = await fire(end, "keydown", { key: "Tab" });
  assert.equal(forward.defaultPrevented, true);
  assert.equal(doc.activeElement, first);
});

test("the background is inert while open, toasts keep speaking, and closing restores it", () => {
  const { doc, sheet } = load();
  const app = doc.getElementById("app");
  const toast = doc.querySelector(".toast");
  const handle = sheet.open({ html: FORM, label: "A" });
  assert.equal(app.hasAttribute("inert"), true);
  assert.equal(toast.hasAttribute("inert"), false);
  assert.equal(handle.overlay.hasAttribute("inert"), false);
  handle.close();
  assert.equal(app.hasAttribute("inert"), false);
});

test("stacked sheets: only the top closes on Escape, and closing a lower one never frees the page", async () => {
  const { doc, sheet } = load();
  const app = doc.getElementById("app");
  const lower = sheet.open({ html: FORM, label: "Lower", bodyClass: "sheet-open" });
  const upper = sheet.open({ html: `<button type="button" id="u">U</button>`, label: "Upper" });
  assert.equal(lower.overlay.hasAttribute("inert"), true, "the lower sheet is behind the upper one");
  await fire(doc.getElementById("u"), "keydown", { key: "Escape" });
  assert.equal(upper.isOpen(), false);
  assert.equal(lower.isOpen(), true);
  assert.equal(lower.overlay.hasAttribute("inert"), false);

  const again = sheet.open({ html: FORM, label: "Again" });
  lower.close();
  assert.equal(app.hasAttribute("inert"), true, "the sheet still open keeps the page inert");
  assert.equal(doc.body.classList.contains("sheet-open"), false, "the body class goes with the sheet that held it");
  again.close();
  assert.equal(app.hasAttribute("inert"), false);
  assert.equal(sheet.top(), null);
});

test("an entrance class lands on the next frame and the exit waits for it unless motion is reduced", () => {
  let reduce = false;
  const { doc, sheet, timers } = load({ reducedMotion: () => reduce, requestAnimationFrame: (fn) => fn() });
  const handle = sheet.open({
    html: FORM,
    label: "Meal",
    overlayClass: "sheet",
    sheetClass: "sheet-card",
    openClass: "sheet-in",
    exitMs: 360,
    bodyClass: "sheet-open",
  });
  assert.equal(handle.overlay.classList.contains("sheet-in"), true);
  assert.equal(doc.body.classList.contains("sheet-open"), true);
  handle.close();
  assert.equal(handle.overlay.classList.contains("sheet-in"), false, "the exit transition starts");
  assert.equal(handle.overlay.isConnected, true, "the node stays for the exit");
  assert.equal(doc.body.classList.contains("sheet-open"), false);
  timers.tick(360);
  assert.equal(handle.overlay.isConnected, false);

  reduce = true;
  const quick = sheet.open({ html: FORM, label: "Meal", openClass: "sheet-in", exitMs: 360 });
  quick.close();
  assert.equal(quick.overlay.isConnected, false, "reduced motion removes it at once");
});

test("sheetFor finds the open sheet from any element inside it; a custom close selector and id work", async () => {
  const { doc, sheet } = load();
  const handle = sheet.open({
    html: `<button type="button" class="x">×</button><span id="inner"></span>`,
    label: "BP",
    id: "bpSheetOv",
    overlayClass: "bpsheet-ov",
    sheetClass: "bpsheet",
    closeSelector: ".x",
    attrs: { "data-key": `1:"2"` },
  });
  assert.equal(doc.getElementById("bpSheetOv"), handle.overlay);
  assert.equal(handle.overlay.dataset.key, `1:"2"`);
  assert.equal(sheet.sheetFor(doc.getElementById("inner")), handle);
  assert.equal(sheet.top(), handle);
  await doc.querySelector(".x").click();
  assert.equal(doc.getElementById("bpSheetOv"), null);
  assert.equal(sheet.sheetFor(handle.overlay), handle, "the handle stays addressable");
  assert.equal(handle.isOpen(), false);
});
