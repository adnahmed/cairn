import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadProgressHistory() {
  const context = {
    Date,
    Math,
    Number,
    Object,
    String,
    fmtDur(seconds) {
      const value = Number(seconds) || 0;
      return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
    },
    fmtK(value) {
      return `K${value}`;
    },
    fmtShortDate(value) {
      return `short ${value}`;
    },
    fmtWeight(value) {
      return String(value);
    },
    setsTonnage(sets) {
      return (sets || []).reduce((sum, set) => sum + (Number(set.weight) || 0) * (Number(set.reps) || 0), 0);
    },
    stagger(index) {
      return `--i:${index}`;
    },
  };
  context.window = context;
  vm.runInNewContext(readFileSync(join(root, "public/js/html-utils.js"), "utf8"), context);
  vm.runInNewContext(readFileSync(join(root, "public/js/progress-history-model-client.js"), "utf8"), context);
  vm.runInNewContext(readFileSync(join(root, "public/js/progress-history-render-client.js"), "utf8"), context);
  vm.runInNewContext(readFileSync(join(root, "public/js/progress-history-client.js"), "utf8"), context);
  return context.CairnProgressHistory;
}

test("progress history session card renders safely", () => {
  const history = loadProgressHistory();
  const html = history.sessionCardHtml(
    {
      id: '42" onclick="bad',
      date: "2026-06-29",
      title: "Upper <A>",
      duration_min: 47,
      notes: "Felt <good>",
      sets: [
        { exercise: "Bench <press>", weight: 100, reps: 5 },
        { exercise: "Bench <press>", weight: 110, reps: 5 },
        { exercise: "Plank <core>", duration_sec: 90 },
      ],
    },
    3,
  );

  assert.match(html, /data-sessid="42&quot; onclick=&quot;bad"/);
  assert.match(html, /aria-label="Edit Monday session"/);
  assert.match(html, /short 2026-06-29 · Upper &lt;A&gt;/);
  assert.match(html, /Bench &lt;press&gt;/);
  assert.match(html, /100×5/);
  assert.match(html, /hist-best">110×5/);
  assert.match(html, /Plank &lt;core&gt;/);
  assert.match(html, /1:30/);
  assert.match(html, /K1050 lb/);
  assert.match(html, /47 min/);
  assert.match(html, /3 sets/);
  assert.match(html, /“Felt &lt;good&gt;”/);
  assert.match(html, /--i:3/);
  assert.doesNotMatch(html, /onclick="bad|<A>|<press>|<core>|<good>/);
});

test("a lift with many sets reads as its best and a count; every set stays in the markup", () => {
  const history = loadProgressHistory();
  const html = history.sessionCardHtml(
    {
      id: 7,
      date: "2026-06-29",
      sets: [
        { exercise: "Squat", weight: 135, reps: 5 },
        { exercise: "Squat", weight: 155, reps: 5 },
        { exercise: "Squat", weight: 175, reps: 3 },
        { exercise: "Curl", weight: 30, reps: 10 },
      ],
    },
    0,
  );
  const squat = html.split('<div class="hist-line">')[1];
  assert.match(squat, /hist-sets is-many/);
  assert.match(squat, /hist-count">3 sets/);
  // The ramp is all there for assistive tech and the edit sheet; the eye gets the best.
  for (const figure of ["135×5", "155×5", "175×3"]) assert.match(squat, new RegExp(figure));
  assert.equal((squat.match(/hist-best/g) || []).length, 1);
  const curl = html.split('<div class="hist-line">')[2];
  assert.doesNotMatch(curl, /is-many|hist-count/);
});

test("progress history handles empty sessions and number coercion", () => {
  const history = loadProgressHistory();
  const html = history.sessionCardHtml({ id: 7, date: "2026-06-30", sets: [] }, 1);

  assert.match(html, /No sets/);
  // "No sets" says it once; no "0 sets" chip repeats it.
  assert.doesNotMatch(html, /0 sets/);
  assert.equal(history.numOrNull(""), null);
  assert.equal(history.numOrNull(null), null);
  assert.equal(history.numOrNull("12.5"), 12.5);
  assert.equal(history.numOrNull("bad"), null);
});
