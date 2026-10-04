// The design-token ratchet (scripts/check-design-tokens.mjs, docs/DESIGN.md "Tokens")
// snaps stylesheet literals onto the scales in src/styles/foundation/tokens.css. Its
// scale tables are a mirror of that file, so a token nudged there without the script
// (or the reverse) would silently snap onto a value that no longer exists — pinned here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { LEADING, RADIUS, SPACE, TEXT, TRACKING, WEIGHT, processCss } from "../scripts/check-design-tokens.mjs";

const tokens = Object.fromEntries(
  [
    ...readFileSync(new URL("../src/styles/foundation/tokens.css", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g),
  ].map((m) => [m[1], m[2].trim()])
);

test("every scale step in the ratchet is the value tokens.css declares", () => {
  const unit = { px: SPACE.concat(RADIUS), rem: TEXT, em: TRACKING, "": WEIGHT.concat(LEADING) };
  for (const [suffix, scale] of Object.entries(unit)) {
    for (const [value, name] of scale) {
      if (!name) continue; // a literal step (0, 1)
      assert.ok(name in tokens, `${name} is declared in tokens.css`);
      assert.equal(parseFloat(tokens[name]), value, `${name} is ${value}${suffix}`);
    }
  }
});

test("off-scale literals snap to the nearest step; geometry, hairlines and em sizes stay put", () => {
  const { fixed, found, left } = processCss(
    ".a{padding:3px 9px;margin:0 auto;gap:1px;margin-top:-6px;padding-left:calc(12px + 4px)}" +
      ".b{font-size:.84rem;font-weight:560;line-height:1.4;letter-spacing:.08em;border-radius:9px 99px}" +
      ".c{font-size:.9em;font-size:2rem}/* padding:7px stays prose */"
  );
  assert.match(
    fixed,
    /\.a\{padding:var\(--space-2\) var\(--space-5\);margin:0 auto;gap:1px;margin-top:-6px;padding-left:calc\(12px \+ 4px\)\}/
  );
  assert.match(
    fixed,
    /font-size:var\(--text-md\);font-weight:var\(--weight-semibold\);line-height:var\(--leading-normal\)/
  );
  assert.match(fixed, /letter-spacing:var\(--tracking-mono\);border-radius:var\(--radius-xs\) var\(--radius-pill\)/);
  assert.match(fixed, /font-size:\.9em;font-size:2rem/, "an em size and a value past tolerance are left for a person");
  assert.match(fixed, /\/\* padding:7px stays prose \*\//, "comments are never rewritten");
  assert.deepEqual(left.font, ["2rem"]);
  assert.equal(found.space.length, 2, "only the two on-rhythm spacing literals count");
});

test("the partials hold no literal the baseline does not already allow", () => {
  const baseline = JSON.parse(readFileSync(new URL("../scripts/design-token-baseline.json", import.meta.url), "utf8"));
  const root = new URL("../src/styles/", import.meta.url);
  const partials = readdirSync(root, { recursive: true })
    .filter((f) => f.endsWith(".css"))
    .map((f) => `src/styles/${f.split(path.sep).join("/")}`)
    .filter((rel) => !/foundation\/(tokens|fonts)\.css$/.test(rel));
  assert.ok(partials.length > 40, "the partials were found");
  for (const rel of partials) {
    const { found } = processCss(readFileSync(new URL(`../${rel}`, import.meta.url), "utf8"));
    for (const [metric, values] of Object.entries(found)) {
      const allowed = baseline.files[rel]?.[metric] ?? 0;
      assert.ok(
        values.length <= allowed,
        `${rel}: ${metric} ${values.length} > baseline ${allowed} (${values.join(", ")})`
      );
    }
  }
  // The scales cover the sheet: what remains is SVG text geometry, the 16px input
  // size iOS needs to not zoom, and a few display numerals and layout offsets.
  const totals = Object.values(baseline.files).reduce((n, f) => n + Object.values(f).reduce((a, b) => a + b, 0), 0);
  assert.ok(totals <= 60, `the baseline stays a short list of exceptions (${totals})`);
});

test("component shape tokens are built only from the scales", () => {
  const shapes = Object.entries(tokens).filter(([name]) => /^--(chip|badge|btn|btn-sm)-(pad|text|weight)$/.test(name));
  assert.equal(shapes.length, 12, "chip, badge, btn and btn-sm each declare pad, text and weight");
  for (const [name, value] of shapes) {
    const refs = [...value.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]);
    assert.ok(refs.length > 0 && value.replace(/var\(--[\w-]+\)/g, "").trim() === "", `${name} is tokens only`);
    for (const ref of refs) assert.match(ref, /^--(space|text|weight)-/, `${name} reads a scale token, not ${ref}`);
  }
});
