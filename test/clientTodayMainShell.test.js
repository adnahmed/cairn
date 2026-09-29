import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const todayScreenSource = readFileSync(join(root, "src/client/today-screen.ts"), "utf8");

function loadMainShell() {
  const context = { Object, String };
  context.window = context;
  context.globalThis = context;
  vm.runInNewContext(readFileSync(join(root, "public/js/today-main-shell-client.js"), "utf8"), context);
  return context.CairnTodayMainShell;
}

test("Today lead omits standalone typed, mic, and goal controls; the weigh-in rides the week row", () => {
  const shell = loadMainShell();
  const html = shell.leadHtml(
    {
      isToday: true,
      briefHtml: `<section id="brief">Rest today.</section>`,
      conductorHtml: "",
      currentWeight: 172.4,
    },
    { escapeHtml: String }
  );

  // v2 wave 7: the bodyweight chip moved onto the week row, so the lead says it nowhere.
  assert.doesNotMatch(html, /id="wtChipMini"|id="wtInlineInput"/);
  assert.doesNotMatch(html, /id="qlInput"|id="qlMic"|id="qlBtn"/);
  assert.doesNotMatch(html, /id="goalSlot"|id="goalLine"/);
  // Today only ever shows today: there is no way back to it from inside itself.
  assert.doesNotMatch(html, /backToday|Back to today/);
});

test("the week row is ONE line: This week, its recap, and the weigh-in chip that never toggles the fold", () => {
  const shell = loadMainShell();
  const html = shell.weekFoldHtml(
    { weekRecap: "2 lifts", cellsHtml: "" },
    { escapeHtml: String },
    { currentWeight: 172.4 }
  );
  const summary = /<summary class="weekfold-sum">([\s\S]*?)<\/summary>/.exec(html)?.[1] || "";
  assert.match(summary, /This week/);
  assert.match(summary, /2 lifts/);
  assert.match(summary, /<button id="wtChipMini"[^>]*data-keep-fold[^>]*>172\.4<span class="wt-mini-unit">lb/);
  // The weight input opens under the row, outside the fold, so it works while it is closed.
  assert.ok(html.indexOf('id="wtInlineInput"') > html.indexOf("</details>"));
  // No weight said twice: no weigh-in tile inside the fold.
  assert.doesNotMatch(html, /id="wtChip"/);
});

test("Today lead leaves the check-in to the Brief and keeps the tag chips, without the retired frequents strip", () => {
  const shell = loadMainShell();
  const html = shell.leadHtml(
    {
      isToday: true,
      briefHtml: `<section id="brief">Rest today.</section>`,
      conductorHtml: "",
      currentWeight: 172.4,
    },
    { escapeHtml: String }
  );

  assert.doesNotMatch(html, /id="freqFoods"/);
  assert.match(html, /id="tagsSlot" class="tags-slot"/);
  // The check-in moved under the Brief's own sentence (today-brief-client.ts) —
  // a footer three surfaces below the question was never where it belonged.
  assert.doesNotMatch(html, /id="checkinSlot"/);
});

test("Today lead omits the day-scoped slots when browsing a day other than today", () => {
  const shell = loadMainShell();
  const html = shell.leadHtml(
    {
      isToday: false,
      briefHtml: `<section id="brief">Rest today.</section>`,
      conductorHtml: "",
      currentWeight: 172.4,
    },
    { escapeHtml: String }
  );

  assert.doesNotMatch(html, /id="freqFoods"/);
  assert.doesNotMatch(html, /id="checkinSlot"|id="tagsSlot"/);
});

test("This week owns trajectory stats without rendering a standalone pace offer", () => {
  const shell = loadMainShell();
  const html = shell.weekFoldHtml(
    {
      weekRecap: "2 lifts",
      cellsHtml: `<div class="stat stat-pace pace-fast">-1.7</div>`,
      paceOfferHtml: `<button id="paceOffer">ask the coach</button>`,
    },
    { escapeHtml: String }
  );

  assert.match(html, /^<div class="weekrow">\s*<details class="weekfold"/);
  assert.match(html, /pace-fast/);
  assert.doesNotMatch(html, /paceOffer|ask the coach/);
});

test("Today exact-HTML snapshots use the v2 namespace after removing legacy controls", () => {
  assert.match(todayScreenSource, /const TODAY_PLAN_SNAP_KEY = "cairn\.today\.plan\.v2";/);
  assert.doesNotMatch(todayScreenSource, /cairn\.today\.plan\.v1/);
});
