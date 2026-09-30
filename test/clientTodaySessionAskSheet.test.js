// "Ask for a session" as a sheet: the Today suggestion slot is borrowed into the
// shared overlay primitive while it is open, so the whole ask → draft → result flow
// runs in front of the athlete, and it goes back where it was on close.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadClientModule } from "./_dom.mjs";

function setup() {
  const observers = [];
  const win = loadClientModule(["html-utils", "ui-components", "ui-sheet", "today-session-ask-sheet"], {
    globals: {
      reducedMotion: () => true,
      setTimeout: (fn) => {
        fn();
        return 0;
      },
      clearTimeout: () => {},
      MutationObserver: class {
        constructor(cb) {
          this.cb = cb;
          observers.push(this);
        }
        observe() {}
        disconnect() {
          this.cb = null;
        }
      },
    },
  });
  const doc = win.document;
  doc.body.innerHTML = `<main id="today"><section class="brief">Brief</section><div id="sugSlot" class="sug-slot"></div><div class="after">rest of Today</div></main>`;
  const reveal = () => {
    doc.getElementById("sugSlot").innerHTML = `<div class="sug-composer"><input class="sug-prompt"><button data-sugcancel>Cancel</button></div>`;
  };
  const mutate = () => observers.forEach((o) => o.cb?.());
  return { win, doc, reveal, mutate };
}

test("the ask opens as a labelled sheet holding the composer, with the prompt focused", () => {
  const { win, doc, reveal } = setup();
  assert.equal(win.CairnTodaySessionAskSheet.open(reveal), true);

  const sheet = doc.querySelector(".sug-sheet");
  assert.ok(sheet, "the sheet is up");
  assert.equal(sheet.getAttribute("role"), "dialog");
  assert.equal(sheet.getAttribute("aria-labelledby"), "sugSheetTitle");
  assert.equal(doc.getElementById("sugSheetTitle").textContent, "Ask for a session");
  assert.ok(sheet.querySelector("#sugSlot .sug-composer"), "the borrowed slot carries the composer");
  assert.equal(doc.querySelector("#today #sugSlot"), null, "the slot left the page while the sheet is open");
  assert.equal(doc.activeElement === sheet.querySelector(".sug-prompt"), true, `focus is on ${doc.activeElement?.className}`);
});

test("closing puts the slot back where it was and clears the unsent composer", () => {
  const { win, doc, reveal } = setup();
  win.CairnTodaySessionAskSheet.open(reveal);
  doc.querySelector(".sug-sheet [data-ui-sheet-close]").click();

  assert.equal(doc.querySelector(".sug-sheet"), null);
  const slot = doc.querySelector("#today #sugSlot");
  assert.ok(slot, "the slot is home");
  const order = Array.from(doc.getElementById("today").children).map((el) => el.id || el.className);
  assert.deepEqual(order, ["brief", "sugSlot", "after"], "back in its original place");
  assert.equal(slot.innerHTML, "", "an unsent composer does not linger inline");
});

test("a draft in flight on close stays and lands inline; an emptied slot closes the sheet", () => {
  const { win, doc, reveal, mutate } = setup();
  win.CairnTodaySessionAskSheet.open(reveal);
  const slot = doc.getElementById("sugSlot");
  slot.innerHTML = `<div class="sug-card sug-loading">Drafting…</div>`;
  doc.querySelector(".sug-sheet [data-ui-sheet-close]").click();
  assert.ok(doc.querySelector("#today #sugSlot .sug-loading"), "the loader keeps going inline");

  // Reopening while a draft is under way inline declines, so the loader stays in view.
  assert.equal(win.CairnTodaySessionAskSheet.open(reveal), false);

  slot.innerHTML = "";
  assert.equal(win.CairnTodaySessionAskSheet.open(reveal), true);
  slot.innerHTML = ""; // Cancel / Dismiss / an accepted session empties the slot
  mutate();
  assert.equal(doc.querySelector(".sug-sheet"), null, "the sheet closes itself");
});

test("the sheet declines (inline fallback) when there is no slot", () => {
  const { win, doc, reveal } = setup();
  doc.getElementById("sugSlot").remove();
  assert.equal(win.CairnTodaySessionAskSheet.open(reveal), false);
  assert.equal(doc.querySelector(".sug-sheet"), null);
});
