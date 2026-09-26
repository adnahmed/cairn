import { test } from "node:test";
import assert from "node:assert/strict";
import { loadClientModule } from "./_dom.mjs";

// The sparkline is the chart module's (ui-chart.ts, CairnUiChart.sparkSvg): a pure
// string renderer, so the built module runs on its own.
function loadSparklineSvg() {
  const win = loadClientModule(["html-utils", "ui-chart"]);
  return (values, w, h) => win.CairnUiChart.sparkSvg(values, w, h);
}

function points(svg) {
  const match = svg.match(/<polyline points="([^"]+)"/);
  assert.ok(match, "polyline points attribute present");
  return match[1].split(" ").map((pair) => pair.split(",").map(Number));
}

// The pre-fix formula: y mapped directly from [min, max] with no floor — a clearly wide
// series should produce identical output under the fix (span >= floor leaves it untouched).
function oldFormulaPoints(vals, w, h) {
  const min = Math.min(...vals), max = Math.max(...vals);
  const x = (i) => 2 + (i * (w - 4)) / (vals.length - 1);
  const y = (n) => (max === min ? h / 2 : h - 3 - ((n - min) / (max - min)) * (h - 6));
  return vals.map((n, i) => `${x(i).toFixed(1)},${y(n).toFixed(1)}`).join(" ");
}

test("sparklineSvg leaves a wide-range series exactly as before", () => {
  const sparklineSvg = loadSparklineSvg();
  const vals = [10, 100, 50, 80];
  const svg = sparklineSvg(vals);
  const match = svg.match(/<polyline points="([^"]+)"/);
  assert.equal(match[1], oldFormulaPoints(vals, 132, 30));
});

test("sparklineSvg floors the y-span for a near-flat series instead of a full-height zigzag", () => {
  const sparklineSvg = loadSparklineSvg();
  const h = 30;
  const vals = [70.0, 70.1, 69.9, 70.05];
  const svg = sparklineSvg(vals, 132, h);
  const ys = points(svg).map(([, y]) => y);
  const extent = Math.max(...ys) - Math.min(...ys);
  // Old formula would have stretched this 0.2-unit spread across the full h-6=24 drawable
  // range; the floored version keeps it to a small band centered near mid-height.
  assert.ok(extent < h * 0.2, `expected a small y-extent, got ${extent}`);
  const mid = h / 2;
  for (const y of ys) {
    assert.ok(Math.abs(y - mid) < h * 0.15, `expected ${y} to sit near mid-height ${mid}`);
  }
});

test("sparklineSvg handles an all-equal series without dividing by zero", () => {
  const sparklineSvg = loadSparklineSvg();
  const h = 30;
  const svg = sparklineSvg([5, 5, 5], 132, h);
  const ys = points(svg).map(([, y]) => y);
  for (const y of ys) assert.equal(y, h / 2);
});

test("sparklineSvg returns empty for fewer than two values", () => {
  const sparklineSvg = loadSparklineSvg();
  assert.equal(sparklineSvg([]), "");
  assert.equal(sparklineSvg([1]), "");
});
