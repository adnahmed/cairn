#!/usr/bin/env node
// Design-token ratchet for the stylesheet partials (docs/DESIGN.md "Tokens": the
// scales). Every spacing, font size, weight, radius, tracking and leading value in
// `src/styles/**/*.css` is a token from `src/styles/foundation/tokens.css`. Six
// numbers per partial may go down but never up against the checked-in baseline
// `scripts/design-token-baseline.json`:
//
//   - space    — a px literal in margin*/padding*/gap. Allowed literally: 0, a
//                sub-2px hairline offset, a negative pull, and any value inside
//                calc()/min()/max()/clamp()/env() (that is geometry, not rhythm).
//   - font     — a font-size that is not a --text-* token or a component shape
//                token (--chip-text, --btn-text …). em sizes (relative to the
//                parent), inherit, 0 and 100% are allowed.
//   - weight   — a font-weight that is not a --weight-* or --*-weight token
//                (inherit allowed).
//   - radius   — a border-radius part that is not a --radius-* token (0 and
//                percentages allowed).
//   - tracking — a letter-spacing that is not a --tracking-* token (0, normal,
//                inherit allowed).
//   - leading  — a line-height that is not a --leading* token (0, 1, normal,
//                inherit allowed).
//
// A partial absent from the baseline is held to 0 of each. `tokens.css` (the
// scales themselves) and `fonts.css` (@font-face descriptors) are exempt.
//
// Usage: node scripts/check-design-tokens.mjs [--fix] [--update] [--report]
//   --fix     snap every literal that sits near a scale step onto that token, in
//             place (a value too far from any step is left for a person to place)
//   --update  rewrite the baseline to the current counts (the only way to loosen it)
//   --report  print the remaining literals per category
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STYLES_DIR = "src/styles";
const EXEMPT = new Set(["src/styles/foundation/tokens.css", "src/styles/foundation/fonts.css"]);
const BASELINE_FILE = "scripts/design-token-baseline.json";
const METRICS = ["space", "font", "weight", "radius", "tracking", "leading"];

// ---------- the scales (mirror tokens.css; the test below the fold keeps them honest) ----------
export const SPACE = [
  [2, "--space-1"],
  [4, "--space-2"],
  [6, "--space-3"],
  [8, "--space-4"],
  [10, "--space-5"],
  [12, "--space-6"],
  [14, "--space-7"],
  [16, "--space-8"],
  [18, "--space-9"],
  [20, "--space-10"],
  [24, "--space-11"],
  [28, "--space-12"],
  [32, "--space-13"],
  [40, "--space-14"],
  [48, "--space-15"],
];
export const TEXT = [
  [0.62, "--text-2xs"],
  [0.74, "--text-xs"],
  [0.8, "--text-sm"],
  [0.88, "--text-md"],
  [0.94, "--text-base"],
  [1.05, "--text-lead"],
  [1.15, "--text-lg"],
  [1.4, "--text-xl"],
  [1.72, "--text-2xl"],
  [2.4, "--text-3xl"],
];
export const WEIGHT = [
  [400, "--weight-regular"],
  [500, "--weight-medium"],
  [600, "--weight-semibold"],
  [700, "--weight-bold"],
];
export const RADIUS = [
  [2, "--radius-3xs"],
  [6, "--radius-2xs"],
  [10, "--radius-xs"],
  [12, "--radius-sm"],
  [14, "--radius-md"],
  [18, "--radius"],
  [22, "--radius-lg"],
];
export const TRACKING = [
  [-0.015, "--tracking-tight"],
  [0, null], // a literal 0
  [0.02, "--tracking-wide"],
  [0.05, "--tracking-wider"],
  [0.09, "--tracking-mono"],
  [0.14, "--tracking-widest"],
];
export const LEADING = [
  [1, null], // a literal 1
  [1.15, "--leading-tight"],
  [1.3, "--leading-snug"],
  [1.45, "--leading-normal"],
  [1.5, "--leading"],
];

/** The step nearest `v` (ties go to the larger step), or null past `tolerance` (relative). */
function nearest(scale, v, tolerance = Infinity) {
  let best = null;
  for (const step of scale) {
    const d = Math.abs(step[0] - v);
    if (!best || d < best.d - 1e-9 || (Math.abs(d - best.d) < 1e-9 && step[0] > best.step[0])) best = { step, d };
  }
  if (!best) return null;
  const rel = best.step[0] === 0 ? best.d : best.d / Math.abs(best.step[0]);
  return rel <= tolerance ? best.step : null;
}
const tok = (step) => (step[1] ? `var(${step[1]})` : String(step[0]));

const SPACE_PROPS =
  "margin|margin-top|margin-right|margin-bottom|margin-left|margin-block|margin-inline|margin-block-start|margin-block-end|margin-inline-start|margin-inline-end|padding|padding-top|padding-right|padding-bottom|padding-left|padding-block|padding-inline|padding-block-start|padding-block-end|padding-inline-start|padding-inline-end|gap|row-gap|column-gap";
const GEOMETRY_FN = /\b(?:calc|min|max|clamp|env)\(/;

// Each rule: which properties, and how to judge/snap one value. `judge` returns
// { literals: string[], fixed: string } — `fixed` is the value with every snappable
// literal replaced; `literals` the ones that remain after fixing.
const RULES = {
  space: {
    props: SPACE_PROPS,
    judge(value) {
      if (GEOMETRY_FN.test(value)) return { literals: [], fixed: value };
      const literals = [];
      const snapped = [];
      const fixed = value.replace(/(^|[\s,])(-?\d*\.?\d+)px\b/g, (m, lead, num) => {
        const v = Number(num);
        if (v === 0 || (v > 0 && v < 2) || v < 0) return m; // hairline offsets, negative pulls
        const step = v <= 33 ? nearest(SPACE, Math.round(v)) : SPACE.find((s) => s[0] === v);
        if (!step) {
          literals.push(`${num}px`);
          return m;
        }
        snapped.push(`${num}px`);
        return `${lead}${tok(step)}`;
      });
      return { literals, snapped, fixed };
    },
  },
  font: {
    props: "font-size",
    judge(value) {
      const v = value.trim();
      if (/^var\(--(?:text-|[\w-]+-text\))/.test(v) || /^(inherit|0|100%|[\d.]+em)$/.test(v) || GEOMETRY_FN.test(v))
        return { literals: [], fixed: value };
      const rem = /^(\d*\.?\d+)rem$/.exec(v);
      if (rem) {
        const step = nearest(TEXT, Number(rem[1]), 0.12);
        if (step) return { literals: [], snapped: [v], fixed: value.replace(v, tok(step)) };
      }
      return { literals: [v], fixed: value };
    },
  },
  weight: {
    props: "font-weight",
    judge(value) {
      const v = value.trim();
      if (/^var\(--(?:weight-|[\w-]+-weight\))/.test(v) || v === "inherit") return { literals: [], fixed: value };
      const n = v === "normal" ? 400 : v === "bold" ? 700 : /^\d+$/.test(v) ? Number(v) : null;
      if (n == null) return { literals: [v], fixed: value };
      // 550–659 reads as semibold, 660+ as bold, below 450 regular
      const step = n < 450 ? WEIGHT[0] : n < 550 ? WEIGHT[1] : n < 660 ? WEIGHT[2] : WEIGHT[3];
      return { literals: [], snapped: [v], fixed: value.replace(v, tok(step)) };
    },
  },
  radius: {
    props: "border-radius|border-top-left-radius|border-top-right-radius|border-bottom-left-radius|border-bottom-right-radius",
    judge(value) {
      if (GEOMETRY_FN.test(value)) return { literals: [], fixed: value };
      const literals = [];
      const snapped = [];
      const fixed = value.replace(/(^|[\s/])(\d*\.?\d+)px\b/g, (m, lead, num) => {
        const v = Number(num);
        if (v === 0) return m;
        const step = v >= 99 ? [v, "--radius-pill"] : v <= 24 ? nearest(RADIUS, v) : null;
        if (!step) {
          literals.push(`${num}px`);
          return m;
        }
        snapped.push(`${num}px`);
        return `${lead}${tok(step)}`;
      });
      return { literals, snapped, fixed };
    },
  },
  tracking: {
    props: "letter-spacing",
    judge(value) {
      const v = value.trim();
      if (/^var\(--tracking-/.test(v) || /^(0|normal|inherit)$/.test(v)) return { literals: [], fixed: value };
      const em = /^(-?\d*\.?\d+)em$/.exec(v);
      if (em) {
        // absolute tolerance: a spaced-out .3em display caption is a decision, not drift
        const n = Number(em[1]);
        const step = nearest(TRACKING, n);
        if (Math.abs(step[0] - n) <= 0.03)
          return { literals: [], snapped: [v], fixed: value.replace(v, tok(step)) };
      }
      return { literals: [v], fixed: value };
    },
  },
  leading: {
    props: "line-height",
    judge(value) {
      const v = value.trim();
      if (/^var\(--leading/.test(v) || /^(0|1|normal|inherit)$/.test(v)) return { literals: [], fixed: value };
      if (/^\d*\.?\d+$/.test(v)) {
        const step = nearest(LEADING, Number(v), 0.08);
        if (step) return { literals: [], snapped: [v], fixed: value.replace(v, tok(step)) };
      }
      return { literals: [v], fixed: value };
    },
  },
};

/** Masks comments so neither the count nor the fix ever reads or rewrites prose. */
function maskComments(src) {
  const comments = [];
  const masked = src.replace(/\/\*[\s\S]*?\*\//g, (c) => {
    comments.push(c);
    return `\u0002${comments.length - 1}\u0003`;
  });
  return { masked, restore: (s) => s.replace(/\u0002(\d+)\u0003/g, (_, i) => comments[Number(i)]) };
}

/**
 * Runs every rule over one partial: `found` is every literal as the source stands,
 * `left` the ones --fix cannot place on a scale, and `fixed` the snapped source.
 */
export function processCss(src) {
  const { masked, restore } = maskComments(src);
  const found = Object.fromEntries(METRICS.map((m) => [m, []]));
  const left = Object.fromEntries(METRICS.map((m) => [m, []]));
  let out = masked;
  for (const metric of METRICS) {
    const rule = RULES[metric];
    const re = new RegExp(`(^|[{;\\s])(${rule.props})(\\s*:\\s*)([^;{}]+?)(\\s*!important)?(?=\\s*[;}])`, "g");
    out = out.replace(re, (m, lead, prop, colon, value, important = "") => {
      const { literals, snapped = [], fixed } = rule.judge(value);
      left[metric].push(...literals);
      found[metric].push(...literals, ...snapped);
      return `${lead}${prop}${colon}${fixed}${important}`;
    });
  }
  return { found, left, fixed: restore(out) };
}

function listStyleFiles(dir) {
  const out = [];
  for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...listStyleFiles(rel));
    else if (entry.name.endsWith(".css") && !EXEMPT.has(rel)) out.push(rel);
  }
  return out.sort();
}

function main() {
  const args = new Set(process.argv.slice(2));
  const files = {};
  const remaining = Object.fromEntries(METRICS.map((m) => [m, {}]));
  let fixedFiles = 0;
  for (const rel of listStyleFiles(STYLES_DIR)) {
    const file = path.join(root, rel);
    const src = readFileSync(file, "utf8");
    const { found, left, fixed } = processCss(src);
    const fix = args.has("--fix");
    if (fix && fixed !== src) {
      writeFileSync(file, fixed);
      fixedFiles++;
    }
    // after a fix the partial holds only what could not be snapped
    const literals = fix ? left : found;
    const counts = {};
    for (const m of METRICS) {
      if (literals[m].length) counts[m] = literals[m].length;
      for (const v of literals[m]) remaining[m][v] = (remaining[m][v] || 0) + 1;
    }
    if (Object.keys(counts).length) files[rel] = counts;
  }
  if (args.has("--fix")) console.log(`✓ snapped literals onto the scales in ${fixedFiles} partial(s)`);

  if (args.has("--report")) {
    for (const m of METRICS) {
      const entries = Object.entries(remaining[m]).sort((a, b) => b[1] - a[1]);
      const total = entries.reduce((n, [, c]) => n + c, 0);
      console.log(`${m.padEnd(9)} ${String(total).padStart(4)}  ${entries.map(([v, c]) => `${v}×${c}`).join("  ")}`);
    }
  }

  const baselinePath = path.join(root, BASELINE_FILE);
  if (args.has("--update")) {
    const totals = Object.fromEntries(METRICS.map((m) => [m, Object.values(files).reduce((n, f) => n + (f[m] || 0), 0)]));
    writeFileSync(baselinePath, `${JSON.stringify({ totals, files }, null, 2)}\n`);
    console.log(`✓ wrote ${BASELINE_FILE} (${METRICS.map((m) => `${m} ${totals[m]}`).join(", ")})`);
    return;
  }

  let baseline = { files: {} };
  try {
    baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  } catch {
    // no baseline yet: every partial is held to zero
  }
  const failures = [];
  const improved = [];
  for (const rel of new Set([...Object.keys(files), ...Object.keys(baseline.files || {})])) {
    const now = files[rel] || {};
    const was = baseline.files?.[rel] || {};
    for (const m of METRICS) {
      const n = now[m] || 0;
      const b = was[m] || 0;
      if (n > b) failures.push(`${rel}: ${m} ${b} → ${n}`);
      else if (n < b) improved.push(`${rel}: ${m} ${b} → ${n}`);
    }
  }
  if (improved.length) {
    console.log(`design tokens: ${improved.length} count(s) dropped — run --update to lock them in:`);
    for (const line of improved) console.log(`  ${line}`);
  }
  if (failures.length) {
    console.error("✗ design tokens: literal values crept into the stylesheet partials.");
    console.error("  Use a token from src/styles/foundation/tokens.css (see docs/DESIGN.md \"Tokens\"),");
    console.error("  or run `node scripts/check-design-tokens.mjs --fix` to snap them:");
    for (const line of failures) console.error(`  ${line}`);
    process.exit(1);
  }
  console.log("✓ design tokens: no new literal spacing, type, weight, radius, tracking or leading");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
