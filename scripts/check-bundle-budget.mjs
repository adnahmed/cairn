#!/usr/bin/env node
// Byte budget for the served client bundles (docs/DESIGN.md "Size limits"; v2 Wave 6
// "Performance"). Every bundle in `BUNDLES` (scripts/build-client.mjs) has two ceilings
// in the checked-in `scripts/bundle-budget.json`: its raw size and its brotli size
// (compressed exactly the way `precompressAssets()` writes the `.br` the server
// ships). The check fails when a built bundle is over either ceiling, when a bundle
// has no budget, or when a budget names a bundle that no longer exists, and prints
// each bundle's delta against the size recorded at the last `--update`.
//
// A budget sits a small margin above the size it was set at, so ordinary work fits
// and a real jump does not. Raising one is deliberate: build, then run `--update`,
// which re-measures every bundle and rewrites the file (so a budget diff is a
// review signal, like the style ratchet's baseline). `--report` also lists each
// bundle's largest inputs, which is how you see what a lazy split would move.
//
// The render-blocking stylesheet (`public/styles.css`, built from src/styles/**) and the
// two SVG libraries index.html loads next to the bundles (`public/art.js`,
// `public/cairn-body-figure.js`) ride the same budget as non-bundle assets
// (`BUDGETED_ASSETS`), so their growth is a review signal too.
//
// On top of the per-file ceilings sit two EAGER totals (`eager` in the budget file):
// the brotli bytes of every script index.html loads, and of the stylesheet. The check
// reads index.html's own <script src> list and fails on any eager script it does not
// budget, so the total cannot silently undercount what the first open downloads. They are
// fixed design limits for the first open (the athlete's per-screen load-time ask),
// not re-measured by `--update`: per-file headroom may never add up past them.
//
// Reads the BUILT bundles, so it runs after `npm run build` (the post-build lane of
// `npm run verify`).
//
// Usage: node scripts/check-bundle-budget.mjs [--update] [--report]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const currentFile = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(currentFile), "..");
const BUDGET_FILE = "scripts/bundle-budget.json";
/** Headroom above the measured size when a budget is (re)set: 3%, rounded up to a whole KiB. */
export const BUDGET_MARGIN = 0.03;
const KIB = 1024;
/**
 * Served assets outside BUNDLES that are budgeted the same way: the stylesheet every
 * page blocks on, and the two SVG libraries index.html loads eagerly beside the bundles.
 */
export const BUDGETED_ASSETS = [
  { output: "public/styles.css", lazy: null, inputs: [] },
  { output: "public/art.js", lazy: null, inputs: [] },
  { output: "public/cairn-body-figure.js", lazy: null, inputs: [] },
];

/**
 * Default eager totals (brotli bytes) for a budget file that has none yet. Eager JS:
 * every script index.html loads (the non-lazy bundles plus art.js and the body
 * figure); styles: the render-blocking stylesheet. Eager JS moved 220 → 225 KB in v2
 * wave 7 for Today's in-frame taps and quiet rewrites (today-slot-hold.ts, the
 * check-in save lane); the Today route still passes scripts/check-perf.mjs.
 */
export const DEFAULT_EAGER_BUDGET = { js: { brotli: 225 * KIB }, styles: { brotli: 70 * KIB } };

/** The `public/...` path of every same-origin <script src> in index.html, in order. */
export function eagerScriptsFromIndex(html) {
  const out = [];
  for (const match of String(html).matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)) {
    const src = match[1].split(/[?#]/)[0];
    if (!src.startsWith("/") || src.startsWith("//")) continue;
    out.push(`public${src}`);
  }
  return out;
}

/** Failures for eager scripts index.html loads that the budget does not measure as eager. */
export function unbudgetedEagerScripts(html, measurements) {
  const eager = new Set(measurements.filter((m) => !m.lazy).map((m) => m.output));
  return eagerScriptsFromIndex(html)
    .filter((output) => !eager.has(output))
    .map((output) => `index.html loads ${output} eagerly but the eager JS total does not count it — add it to BUDGETED_ASSETS`);
}

/** Brotli totals of what the first open downloads: eager bundles, and the stylesheet. */
export function eagerTotals(measurements) {
  const isStyles = (m) => m.output.endsWith(".css");
  const sum = (list) => list.reduce((acc, m) => ({ raw: acc.raw + m.raw, brotli: acc.brotli + m.brotli }), { raw: 0, brotli: 0 });
  return {
    js: sum(measurements.filter((m) => !m.lazy && !isStyles(m))),
    styles: sum(measurements.filter((m) => isStyles(m))),
  };
}

/** Failures for eager totals over their fixed brotli ceilings. */
export function evaluateEagerBudget(measurements, budgetFile) {
  const totals = eagerTotals(measurements);
  const caps = budgetFile?.eager ?? {};
  const failures = [];
  for (const kind of ["js", "styles"]) {
    const limit = caps[kind]?.brotli;
    if (typeof limit !== "number") {
      failures.push(`eager ${kind} has no brotli budget — add "eager" to ${BUDGET_FILE} (run --update)`);
      continue;
    }
    if (totals[kind].brotli > limit) {
      failures.push(
        `eager ${kind} total ${formatBytes(totals[kind].brotli)} brotli is ${formatDelta(totals[kind].brotli - limit)} over its ${formatBytes(limit)} budget — move a surface into a lazy bundle`,
      );
    }
  }
  return { totals, failures };
}

/** Everything the budget covers: the BUNDLES manifest plus the budgeted assets. */
export function budgetedOutputs(bundles) {
  return [...bundles, ...BUDGETED_ASSETS];
}

/** Brotli with the same parameters `precompressAssets()` uses for the served `.br`. */
export function brotliSize(bytes) {
  return zlib.brotliCompressSync(bytes, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: zlib.constants.BROTLI_MAX_QUALITY,
      [zlib.constants.BROTLI_PARAM_SIZE_HINT]: bytes.length,
    },
  }).length;
}

/** The ceiling for one measured size: the margin on top, rounded up to a whole KiB. */
export function ceilingFor(bytes, margin = BUDGET_MARGIN) {
  return Math.ceil((bytes * (1 + margin)) / KIB) * KIB;
}

/** A budget file for the given measurements (`[{ output, lazy, raw, brotli }]`). */
export function budgetFromMeasurements(measurements, margin = BUDGET_MARGIN, eager = DEFAULT_EAGER_BUDGET) {
  const bundles = {};
  for (const m of measurements) {
    bundles[m.output] = {
      ...(m.lazy ? { lazy: m.lazy } : {}),
      measured: { raw: m.raw, brotli: m.brotli },
      budget: { raw: ceilingFor(m.raw, margin), brotli: ceilingFor(m.brotli, margin) },
    };
  }
  return {
    note:
      "Byte budget for scripts/check-bundle-budget.mjs (run in npm run verify). A bundle may not grow past its budget; raise one deliberately with `node scripts/check-bundle-budget.mjs --update` after npm run build.",
    margin,
    eager: {
      js: { brotli: eager.js.brotli },
      styles: { brotli: eager.styles.brotli },
    },
    bundles,
  };
}

export function formatBytes(n) {
  const abs = Math.abs(n);
  if (abs < KIB) return `${n} B`;
  return `${(n / KIB).toFixed(1)} KB`;
}

export function formatDelta(n) {
  if (n === 0) return "±0";
  return `${n > 0 ? "+" : "-"}${formatBytes(Math.abs(n))}`;
}

/**
 * Compare measurements against a budget file. Pure: returns one row per bundle and
 * a list of human-readable failures (empty when everything fits).
 */
export function evaluateBudget(measurements, budgetFile) {
  const entries = budgetFile?.bundles ?? {};
  const rows = [];
  const failures = [];
  const seen = new Set();
  for (const m of measurements) {
    seen.add(m.output);
    const entry = entries[m.output];
    if (!entry) {
      rows.push({ ...m, entry: null, over: [] });
      failures.push(`${m.output} has no budget — build, then run node scripts/check-bundle-budget.mjs --update`);
      continue;
    }
    const over = [];
    for (const kind of ["raw", "brotli"]) {
      const limit = entry.budget?.[kind];
      if (typeof limit !== "number") {
        failures.push(`${m.output} has no ${kind} budget`);
        continue;
      }
      if (m[kind] > limit) {
        over.push(kind);
        const since = typeof entry.measured?.[kind] === "number" ? m[kind] - entry.measured[kind] : null;
        failures.push(
          `${m.output} ${kind} ${formatBytes(m[kind])} is ${formatDelta(m[kind] - limit)} over its ${formatBytes(limit)} budget` +
            (since == null ? "" : ` (${formatDelta(since)} since the budget was set)`),
        );
      }
    }
    rows.push({ ...m, entry, over });
  }
  for (const output of Object.keys(entries)) {
    if (!seen.has(output)) failures.push(`${output} has a budget but is no longer a bundle — run --update to drop it`);
  }
  return { rows, failures };
}

function pad(text, width, right = false) {
  const s = String(text);
  return right ? s.padStart(width) : s.padEnd(width);
}

export function renderTable(rows) {
  const lines = [];
  const header = [
    pad("bundle", 30),
    pad("raw", 10, true),
    pad("budget", 10, true),
    pad("Δ set", 10, true),
    pad("brotli", 10, true),
    pad("budget", 10, true),
    pad("Δ set", 10, true),
  ].join(" ");
  lines.push(header);
  for (const row of rows) {
    const name = `${path.basename(row.output)}${row.lazy ? " (lazy)" : ""}`;
    const cell = (kind) => {
      if (!row.entry) return [pad(formatBytes(row[kind]), 10, true), pad("—", 10, true), pad("—", 10, true)];
      const measured = row.entry.measured?.[kind];
      const delta = typeof measured === "number" ? formatDelta(row[kind] - measured) : "—";
      const mark = row.over.includes(kind) ? "!" : "";
      return [
        pad(`${mark}${formatBytes(row[kind])}`, 10, true),
        pad(formatBytes(row.entry.budget?.[kind] ?? 0), 10, true),
        pad(delta, 10, true),
      ];
    };
    lines.push([pad(name, 30), ...cell("raw"), ...cell("brotli")].join(" "));
  }
  return lines.join("\n");
}

function measureBuilt(bundles) {
  const measurements = [];
  const missing = [];
  for (const bundle of bundles) {
    const file = path.join(root, bundle.output);
    if (!existsSync(file)) {
      missing.push(bundle.output);
      continue;
    }
    const bytes = readFileSync(file);
    measurements.push({ output: bundle.output, lazy: bundle.lazy ?? null, raw: bytes.length, brotli: brotliSize(bytes) });
  }
  return { measurements, missing };
}

function inputReport(bundles) {
  const lines = ["", "Largest inputs per bundle (raw / brotli of the individual module):"];
  for (const bundle of bundles) {
    const sizes = [];
    for (const input of bundle.inputs) {
      const file = path.join(root, input);
      if (!existsSync(file)) continue;
      const bytes = readFileSync(file);
      sizes.push({ input, raw: bytes.length, brotli: brotliSize(bytes) });
    }
    sizes.sort((a, b) => b.raw - a.raw);
    lines.push(`  ${path.basename(bundle.output)}${bundle.lazy ? ` (lazy: ${bundle.lazy})` : ""}`);
    for (const s of sizes.slice(0, 8)) {
      lines.push(`    ${pad(formatBytes(s.raw), 9, true)} ${pad(formatBytes(s.brotli), 9, true)}  ${path.basename(s.input)}`);
    }
  }
  return lines.join("\n");
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const { BUNDLES } = await import("./build-client.mjs");
  const { measurements, missing } = measureBuilt(budgetedOutputs(BUNDLES));
  if (missing.length) {
    console.error(`Bundle budget: ${missing.length} bundle(s) not built — run npm run build first:`);
    for (const m of missing) console.error(`  ${m}`);
    process.exit(1);
  }

  const budgetPath = path.join(root, BUDGET_FILE);
  if (args.has("--update")) {
    const previous = existsSync(budgetPath) ? JSON.parse(readFileSync(budgetPath, "utf8")) : null;
    // The eager totals are design limits: keep the ones already set.
    const next = budgetFromMeasurements(measurements, BUDGET_MARGIN, previous?.eager?.js && previous?.eager?.styles ? previous.eager : DEFAULT_EAGER_BUDGET);
    writeFileSync(budgetPath, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`✓ wrote ${BUDGET_FILE} (${measurements.length} bundles, ${Math.round(BUDGET_MARGIN * 100)}% margin)`);
    for (const [output, entry] of Object.entries(next.bundles)) {
      const old = previous?.bundles?.[output]?.budget;
      if (!old) {
        console.log(`  + ${path.basename(output)}: raw ${formatBytes(entry.budget.raw)}, brotli ${formatBytes(entry.budget.brotli)}`);
      } else if (old.raw !== entry.budget.raw || old.brotli !== entry.budget.brotli) {
        console.log(
          `  ~ ${path.basename(output)}: raw ${formatBytes(old.raw)} → ${formatBytes(entry.budget.raw)} (${formatDelta(entry.budget.raw - old.raw)}), ` +
            `brotli ${formatBytes(old.brotli)} → ${formatBytes(entry.budget.brotli)} (${formatDelta(entry.budget.brotli - old.brotli)})`,
        );
      }
    }
    for (const output of Object.keys(previous?.bundles ?? {})) {
      if (!next.bundles[output]) console.log(`  - ${path.basename(output)} dropped`);
    }
    if (args.has("--report")) console.log(inputReport(BUNDLES));
    return;
  }

  if (!existsSync(budgetPath)) {
    console.error(`${BUDGET_FILE} is missing; create it with: node scripts/check-bundle-budget.mjs --update`);
    process.exit(1);
  }
  const budget = JSON.parse(readFileSync(budgetPath, "utf8"));
  const { rows, failures } = evaluateBudget(measurements, budget);
  const eager = evaluateEagerBudget(measurements, budget);
  failures.push(...eager.failures);
  failures.push(...unbudgetedEagerScripts(readFileSync(path.join(root, "public/index.html"), "utf8"), measurements));
  const eagerRaw = measurements.filter((m) => !m.lazy).reduce((sum, m) => sum + m.raw, 0);
  const eagerBrotli = measurements.filter((m) => !m.lazy).reduce((sum, m) => sum + m.brotli, 0);
  const eagerLine =
    `eager JS ${formatBytes(eager.totals.js.brotli)} / ${formatBytes(budget.eager?.js?.brotli ?? 0)} brotli, ` +
    `styles ${formatBytes(eager.totals.styles.brotli)} / ${formatBytes(budget.eager?.styles?.brotli ?? 0)} brotli`;

  if (failures.length || args.has("--report")) console.log(renderTable(rows));
  if (args.has("--report")) {
    console.log(`\nEager (index.html, stylesheet included) total: ${formatBytes(eagerRaw)} raw, ${formatBytes(eagerBrotli)} brotli`);
    console.log(`Eager budgets: ${eagerLine}`);
    console.log(inputReport(BUNDLES));
  }
  if (failures.length) {
    console.error(`\nBundle budget exceeded (${failures.length}):`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    console.error(
      "\nShrink the bundle, move a heavy surface into a lazy bundle, or — if the growth is deliberate —\n" +
        "raise the budget with: node scripts/check-bundle-budget.mjs --update",
    );
    process.exit(1);
  }
  console.log(
    `✓ bundle budget: ${measurements.length} bundles within budget; ${eagerLine}`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  await main();
}
