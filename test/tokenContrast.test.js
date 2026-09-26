// Every text token clears WCAG AA (4.5:1) on every neutral it can sit on, in both
// themes, computed from src/styles/foundation/tokens.css itself (docs/DESIGN.md
// "Accessibility minimums"). A palette nudge that drops a pair under AA fails here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/styles/foundation/tokens.css", import.meta.url), "utf8");

function block(open) {
  const start = css.indexOf(open);
  assert.ok(start >= 0, `tokens.css has ${open}`);
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(css.indexOf("{", start) + 1, i);
  }
  throw new Error(`unclosed ${open}`);
}

function declarations(body) {
  const out = {};
  const clean = body.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of clean.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

const light = declarations(block(":root{"));
const darkForced = declarations(block(':root[data-theme="dark"]{'));
const darkSystem = declarations(block(':root:not([data-theme="light"]){'));
const dark = { ...light, ...darkForced };

function hex(value) {
  const h = value.replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16));
}

/** A token's colour as [r,g,b], following var() and srgb color-mix(). */
function resolve(tokens, value, depth = 0) {
  assert.ok(depth < 10, `token cycle at ${value}`);
  const v = value.trim();
  const ref = /^var\((--[\w-]+)\)$/.exec(v);
  if (ref) return resolve(tokens, tokens[ref[1]], depth + 1);
  if (/^#[0-9a-f]{3,6}$/i.test(v)) return hex(v);
  const mix = /^color-mix\(in srgb,\s*(.+?)\s+(\d+(?:\.\d+)?)%,\s*(.+)\)$/.exec(v);
  if (mix) {
    const p = Number(mix[2]) / 100;
    const a = resolve(tokens, mix[1], depth + 1);
    const b = resolve(tokens, mix[3], depth + 1);
    return a.map((c, i) => Math.round(c * p + b[i] * (1 - p)));
  }
  throw new Error(`cannot resolve ${v}`);
}

function luminance([r, g, b]) {
  const f = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function ratio(tokens, fg, bg) {
  const a = luminance(resolve(tokens, `var(${fg})`));
  const b = luminance(resolve(tokens, `var(${bg})`));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const THEMES = { light, dark };
const NEUTRALS = ["--ground", "--surface", "--surface2", "--well"];
const TEXT = [
  "--ink",
  "--ink2",
  "--muted",
  "--dawn",
  "--dawn-deep",
  "--sage-text",
  "--gold-deep",
  "--d-strength",
  "--d-endurance",
  "--d-recovery",
  "--d-fuel",
  "--d-body",
  "--d-heart",
];

test("the two dark blocks are identical", () => {
  assert.deepEqual(darkSystem, darkForced);
});

test("every text token clears AA on every neutral, in both themes", () => {
  const misses = [];
  for (const [theme, tokens] of Object.entries(THEMES)) {
    for (const fg of TEXT) {
      for (const bg of NEUTRALS) {
        const r = ratio(tokens, fg, bg);
        if (r < 4.5) misses.push(`${theme} ${fg} on ${bg}: ${r.toFixed(2)}`);
      }
    }
  }
  assert.deepEqual(misses, []);
});

test("text on an accent fill clears AA in both themes", () => {
  for (const [theme, tokens] of Object.entries(THEMES)) {
    for (const fill of ["--dawn", "--dawn-deep"]) {
      const r = ratio(tokens, "--on-accent", fill);
      assert.ok(r >= 4.5, `${theme} --on-accent on ${fill}: ${r.toFixed(2)}`);
    }
  }
});
