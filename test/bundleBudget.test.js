import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BUDGET_MARGIN,
  budgetFromMeasurements,
  ceilingFor,
  evaluateBudget,
  formatDelta,
} from "../scripts/check-bundle-budget.mjs";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

const measured = [
  { output: "public/js/bundle-a.js", lazy: null, raw: 100_000, brotli: 20_000 },
  { output: "public/js/bundle-b.js", lazy: "b", raw: 50_000, brotli: 9_000 },
];

test("a budget sits a small margin above the measured size, rounded up to a whole KiB", () => {
  assert.equal(ceilingFor(100_000), Math.ceil((100_000 * (1 + BUDGET_MARGIN)) / 1024) * 1024);
  assert.ok(ceilingFor(100_000) > 100_000);
  assert.ok(ceilingFor(100_000) <= 100_000 * (1 + BUDGET_MARGIN) + 1024);
  assert.equal(ceilingFor(1024, 0), 1024);
  const budget = budgetFromMeasurements(measured);
  assert.equal(budget.margin, BUDGET_MARGIN);
  assert.deepEqual(budget.bundles["public/js/bundle-a.js"].measured, { raw: 100_000, brotli: 20_000 });
  assert.equal(budget.bundles["public/js/bundle-b.js"].lazy, "b");
  assert.equal(budget.bundles["public/js/bundle-a.js"].lazy, undefined);
});

test("bundles within budget pass; the budget just set always passes", () => {
  const { failures, rows } = evaluateBudget(measured, budgetFromMeasurements(measured));
  assert.deepEqual(failures, []);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.over.length === 0));
});

test("growing past either ceiling fails and names the delta", () => {
  const budget = budgetFromMeasurements(measured);
  const limit = budget.bundles["public/js/bundle-a.js"].budget.brotli;
  const grown = [{ ...measured[0], brotli: limit + 2048 }, measured[1]];
  const { failures, rows } = evaluateBudget(grown, budget);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /bundle-a\.js brotli .* is \+2\.0 KB over its .* budget/);
  assert.match(failures[0], /since the budget was set/);
  assert.deepEqual(rows[0].over, ["brotli"]);

  const rawGrown = [measured[0], { ...measured[1], raw: 90_000 }];
  const raw = evaluateBudget(rawGrown, budget);
  assert.equal(raw.failures.length, 1);
  assert.match(raw.failures[0], /bundle-b\.js raw/);
});

test("a bundle with no budget, or a budget for a bundle that is gone, fails", () => {
  const budget = budgetFromMeasurements([measured[0]]);
  const added = evaluateBudget(measured, budget);
  assert.equal(added.failures.length, 1);
  assert.match(added.failures[0], /bundle-b\.js has no budget .*--update/);

  const stale = evaluateBudget([measured[0]], budgetFromMeasurements(measured));
  assert.equal(stale.failures.length, 1);
  assert.match(stale.failures[0], /bundle-b\.js has a budget but is no longer a bundle/);
});

test("deltas read signed", () => {
  assert.equal(formatDelta(0), "±0");
  assert.equal(formatDelta(2048), "+2.0 KB");
  assert.equal(formatDelta(-512), "-512 B");
});

test("the checked-in budget covers exactly the BUNDLES manifest and runs in verify", async () => {
  const { BUNDLES } = await import("../scripts/build-client.mjs");
  const budget = JSON.parse(read("scripts/bundle-budget.json"));
  assert.deepEqual(Object.keys(budget.bundles).sort(), BUNDLES.map((bundle) => bundle.output).sort());
  for (const bundle of BUNDLES) {
    const entry = budget.bundles[bundle.output];
    assert.equal(entry.lazy ?? null, bundle.lazy ?? null, `${bundle.output} lazy flag matches the manifest`);
    for (const kind of ["raw", "brotli"]) {
      assert.ok(
        entry.budget[kind] >= entry.measured[kind],
        `${bundle.output} ${kind} budget is at or above its measured size`
      );
    }
  }
  assert.match(read("scripts/run-verify.mjs"), /node",\s*"scripts\/check-bundle-budget\.mjs"/);
});
