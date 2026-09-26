#!/usr/bin/env node
// Style ratchet for the client (docs/DESIGN.md "Component architecture": "Tokens"
// and "Size limits"). Three numbers per `src/client/**/*.ts` file may go down but
// never up against the checked-in baseline `scripts/client-style-baseline.json`:
//
//   - hex   — hex color literals. TypeScript never writes a hex color; SVG built in
//             TS styles itself through classes or `var(--token)`. The authored
//             illustration library (`cairn-body-figure.ts`) is exempt.
//   - style — inline `style="…"` attributes that do more than carry data. Custom
//             properties (`--i`, `--frac`, a `${stagger(n)}` that emits one) and
//             data geometry (`left`/`width`/… set from an interpolated value) are
//             data and not counted; any other declaration makes the attribute count.
//   - lines — module length. A module stays under 400 lines (the soft limit), so a
//             file only needs a baseline entry once it is over that; an oversize
//             file may shrink but never grow, and 600 is the hard ceiling for any
//             file the baseline does not already hold above it.
//
// A file absent from the baseline is held to 0 hex, 0 presentational styles and
// the 400-line soft limit. When a number drops, the check still passes and says so;
// run `--update` to lock the lower number in (that rewrite is the only way to
// loosen it too, so a baseline diff is a review signal).
//
// Usage: node scripts/check-client-style.mjs [--update] [--report]
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLIENT_DIR = "src/client";
const BASELINE_FILE = "scripts/client-style-baseline.json";
const SOFT_LINE_LIMIT = 400;
const HARD_LINE_LIMIT = 600;
/** Authored illustration geometry; its colors are the art, not UI chrome. */
const HEX_EXEMPT = new Set(["src/client/cairn-body-figure.ts"]);
/** Properties whose interpolated value is data geometry, not presentation. */
const GEOMETRY_PROPS = new Set([
  "left",
  "right",
  "top",
  "bottom",
  "inset",
  "width",
  "height",
  "min-width",
  "max-width",
  "min-height",
  "max-height",
  "flex-basis",
]);

const HEX_RE = /(?<![&\w#])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g;

function listClientFiles(dir) {
  const out = [];
  for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...listClientFiles(rel));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) out.push(rel);
  }
  return out.sort();
}

function lineCount(src) {
  if (!src) return 0;
  return src.split("\n").length - (src.endsWith("\n") ? 1 : 0);
}

/** Reads a `style="…"` value starting at `start`, skipping quotes inside `${…}`. */
function readStyleValue(src, start) {
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (depth === 0 && ch === '"') return { value: src.slice(start, i), end: i };
    if (ch === "$" && src[i + 1] === "{") {
      depth++;
      i++;
    } else if (depth > 0 && ch === "{") depth++;
    else if (depth > 0 && ch === "}") depth--;
    else if (depth === 0 && ch === "\n") break;
  }
  return null;
}

const INTERP = "\u0000"; // any `${…}` value
const STAGGER = "\u0001"; // a `${stagger(n)}` helper, which emits only `--i:n`

/** Replaces each `${…}` with a placeholder so declarations can be split on `;`. */
function maskInterpolations(value) {
  let out = "";
  let depth = 0;
  let expr = "";
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (depth === 0 && ch === "$" && value[i + 1] === "{") {
      depth = 1;
      expr = "";
      i++;
    } else if (depth > 0) {
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      if (depth === 0) out += /^\s*(?:deps\.)?stagger\(/.test(expr) ? STAGGER : INTERP;
      else expr += ch;
    } else out += ch;
  }
  return out;
}

function isDataOnlyStyle(value) {
  const decls = maskInterpolations(value)
    .split(";")
    .map((d) => d.trim())
    .filter(Boolean);
  return decls.every((decl) => {
    if (decl === STAGGER) return true;
    const colon = decl.indexOf(":");
    if (colon < 0) return false;
    const prop = decl.slice(0, colon).trim().toLowerCase();
    const val = decl.slice(colon + 1);
    if (prop.startsWith("--")) return true;
    return GEOMETRY_PROPS.has(prop) && (val.includes(INTERP) || val.includes(STAGGER));
  });
}

function presentationalStyleCount(src) {
  let count = 0;
  const re = /\bstyle="/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const read = readStyleValue(src, m.index + m[0].length);
    if (!read) {
      count++;
      continue;
    }
    if (!isDataOnlyStyle(read.value)) count++;
    re.lastIndex = read.end + 1;
  }
  return count;
}

function measure() {
  const files = {};
  for (const rel of listClientFiles(CLIENT_DIR)) {
    const src = readFileSync(path.join(root, rel), "utf8");
    files[rel] = {
      lines: lineCount(src),
      hex: HEX_EXEMPT.has(rel) ? 0 : (src.match(HEX_RE) || []).length,
      style: presentationalStyleCount(src),
    };
  }
  return files;
}

/** The baseline records only what is above the free allowance for each metric. */
function toBaseline(files) {
  const out = {};
  for (const [rel, m] of Object.entries(files)) {
    const entry = {};
    if (m.lines > SOFT_LINE_LIMIT) entry.lines = m.lines;
    if (m.hex > 0) entry.hex = m.hex;
    if (m.style > 0) entry.style = m.style;
    if (Object.keys(entry).length) out[rel] = entry;
  }
  return out;
}

function totals(files) {
  const t = { files: 0, hex: 0, style: 0, over400: 0, over600: 0 };
  for (const m of Object.values(files)) {
    t.files++;
    t.hex += m.hex;
    t.style += m.style;
    if (m.lines > SOFT_LINE_LIMIT) t.over400++;
    if (m.lines > HARD_LINE_LIMIT) t.over600++;
  }
  return t;
}

/** Totals for the baseline header; the file count is left out so adding a module never touches it. */
function summaryTotals(files) {
  const { hex, style, over400, over600 } = totals(files);
  return { hex, style, over400, over600 };
}

function readBaseline() {
  try {
    return JSON.parse(readFileSync(path.join(root, BASELINE_FILE), "utf8")).files || {};
  } catch (err) {
    if (err && err.code === "ENOENT") return null;
    throw err;
  }
}

function writeBaseline(files) {
  const body = {
    note: "Ratchet for scripts/check-client-style.mjs. Numbers may only go down; run it with --update after one does.",
    totals: summaryTotals(files),
    files: toBaseline(files),
  };
  writeFileSync(path.join(root, BASELINE_FILE), `${JSON.stringify(body, null, 2)}\n`);
}

function check(files, baseline) {
  const failures = [];
  const improvements = [];
  for (const [rel, m] of Object.entries(files)) {
    const base = baseline[rel] || {};
    const allowedLines = base.lines ?? SOFT_LINE_LIMIT;
    if (m.lines > allowedLines) {
      const why = base.lines
        ? `grew from ${base.lines} to ${m.lines} lines (an oversize module may shrink, never grow)`
        : `is ${m.lines} lines, over the ${SOFT_LINE_LIMIT}-line module limit (split it)`;
      failures.push(`${rel} ${why}`);
    }
    if (!base.lines && m.lines > HARD_LINE_LIMIT) {
      failures.push(`${rel} is over the ${HARD_LINE_LIMIT}-line hard ceiling`);
    }
    for (const [key, label] of [
      ["hex", "hex color literal(s); use a class or var(--token) from src/styles/foundation/tokens.css"],
      ["style", "presentational inline style(s); inline style carries data only (custom properties, data geometry)"],
    ]) {
      const allowed = base[key] ?? 0;
      if (m[key] > allowed) failures.push(`${rel} has ${m[key]} ${label} (baseline ${allowed})`);
      else if (m[key] < allowed) improvements.push(`${rel} ${key} ${allowed} → ${m[key]}`);
    }
    if (base.lines && m.lines < base.lines) improvements.push(`${rel} lines ${base.lines} → ${m.lines}`);
  }
  for (const rel of Object.keys(baseline)) {
    if (!files[rel]) improvements.push(`${rel} no longer exists`);
  }
  return { failures, improvements };
}

const args = new Set(process.argv.slice(2));
const files = measure();

if (args.has("--report")) {
  console.log(JSON.stringify({ totals: totals(files), files: toBaseline(files) }, null, 2));
  process.exit(0);
}

if (args.has("--update")) {
  writeBaseline(files);
  const t = totals(files);
  console.log(
    `client style baseline written: ${t.hex} hex, ${t.style} presentational inline styles, ${t.over400} modules over ${SOFT_LINE_LIMIT} lines`,
  );
  process.exit(0);
}

const baseline = readBaseline();
if (!baseline) {
  console.error(`${BASELINE_FILE} is missing; create it with: node scripts/check-client-style.mjs --update`);
  process.exit(1);
}

const { failures, improvements } = check(files, baseline);
if (failures.length) {
  console.error("client style ratchet failed (docs/DESIGN.md, Tokens / Size limits):");
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
const t = totals(files);
console.log(
  `client style ratchet ok: ${t.hex} hex, ${t.style} presentational inline styles, ${t.over400} modules over ${SOFT_LINE_LIMIT} lines`,
);
if (improvements.length) {
  console.log("  lower than the baseline (lock it in with --update):");
  for (const i of improvements) console.log(`    ${i}`);
}
