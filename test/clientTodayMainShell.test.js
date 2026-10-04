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

test("Today lead omits standalone typed, mic, and goal controls; the weigh-in rides This week", () => {
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

  // The bodyweight tile lives in This week's tallies, so the lead says it nowhere.
  assert.doesNotMatch(html, /id="wtChipMini"|id="wtInlineInput"/);
  assert.doesNotMatch(html, /id="qlInput"|id="qlMic"|id="qlBtn"/);
  assert.doesNotMatch(html, /id="goalSlot"|id="goalLine"/);
  // Today only ever shows today: there is no way back to it from inside itself.
  assert.doesNotMatch(html, /backToday|Back to today/);
});

test("This week: the frame's tallies (lifts, km, the weigh-in tile), slots for the strip and gauges, the old detail folded", () => {
  const shell = loadMainShell();
  const html = shell.weekFoldHtml(
    { weekRecap: "2 lifts", cellsHtml: `<div class="stat">x</div>`, planned: 5, done: 4, weekKm: 22.34 },
    { escapeHtml: (v) => String(v).replace(/</g, "&lt;") },
    { currentWeight: 172.4, trendLbWk: -0.76, liftOpen: "Pull <b>", runs: true }
  );
  assert.match(html, /<section class="tweek" id="todayWeek" aria-label="This week">/);
  assert.match(html, /<span class="lbl">This week<\/span>/);
  // Lifts done of planned, with today's open lift named (escaped).
  assert.match(html, /data-cu="4">0<\/span><span class="tweek-u">\/5<\/span>/);
  assert.match(html, /lifts · Pull &lt;b> open/);
  // Kilometres, with the plan note filled later by the today-ahead bundle.
  assert.match(html, />22\.3<span class="tweek-u">km<\/span>/);
  assert.match(html, /id="tweekKmNote"/);
  // The weigh-in tile keeps the inline capture's id; its number has its own node so
  // a save rewrites it without dropping the sparkline beside it.
  assert.match(html, /<button id="wtChipMini" class="tweek-tally tweek-wt"[^>]*><span class="tweek-n num" data-wtval>172\.4<span class="tweek-u">lb<\/span><\/span><small>lb · −0\.8\/wk<\/small><span class="tweek-spark" id="tweekSpark"/);
  assert.match(html, /id="tweekStrip"/);
  assert.match(html, /id="tweekGauges"/);
  // The weight input opens under the tallies, outside the fold.
  assert.ok(html.indexOf('id="wtInlineInput"') < html.indexOf("<details"));
  // The older detail stays one tap away.
  assert.match(html, /<details class="weekfold tweek-more" id="weekFold">[\s\S]*More about this week[\s\S]*class="stat"[\s\S]*id="wearStrip"/);
  assert.doesNotMatch(html, /id="wtChip"/);
});

test("This week falls back to a cardio count for an athlete with no running", () => {
  const shell = loadMainShell();
  const html = shell.weekFoldHtml({ planned: 3, done: 1, weekKm: 0 }, { escapeHtml: String }, { weekCardio: 2, runs: false });
  assert.match(html, /data-cu="2">0<\/span><\/div><small>cardio/);
  assert.doesNotMatch(html, /tweekKmNote/);
  assert.match(html, /weight · tap to log/);
});

test("the redesigned Today's async slots: the digest before the week, Coming up and the board after", () => {
  const shell = loadMainShell();
  assert.equal(shell.digestSlotHtml(), `<div id="todayDigestSlot" class="tdg-slot"></div>`);
  assert.match(shell.aheadSlotsHtml(), /id="todayHorizonSlot"[\s\S]*id="todayHeadingSlot"/);
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

  assert.match(html, /^<section class="tweek"/);
  assert.match(html, /pace-fast/);
  assert.doesNotMatch(html, /paceOffer|ask the coach/);
});

test("Today exact-HTML snapshots use the v2 namespace after removing legacy controls", () => {
  assert.match(todayScreenSource, /const TODAY_PLAN_SNAP_KEY = "cairn\.today\.plan\.v2";/);
  assert.doesNotMatch(todayScreenSource, /cairn\.today\.plan\.v1/);
});
