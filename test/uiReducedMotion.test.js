// One reduced-motion predicate (docs/DESIGN.md "Motion system"): every JS motion
// decision asks `reducedMotion()` (ui-feedback-client.ts), never its own matchMedia.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createFakeTimers, createHost, loadClientModule } from "./_dom.mjs";

function mediaQuery(reduce) {
  const asked = [];
  return {
    asked,
    matchMedia: (query) => {
      asked.push(query);
      return { matches: reduce && query === "(prefers-reduced-motion: reduce)" };
    },
  };
}

test("reducedMotion reads the media query, and a browser without matchMedia reads full motion", () => {
  const reduce = mediaQuery(true);
  assert.equal(
    loadClientModule(["html-utils", "ui-feedback-client"], {
      globals: { matchMedia: reduce.matchMedia },
    }).reducedMotion(),
    true
  );
  assert.deepEqual(reduce.asked, ["(prefers-reduced-motion: reduce)"]);
  assert.equal(
    loadClientModule(["html-utils", "ui-feedback-client"], { globals: mediaQuery(false) }).reducedMotion(),
    false
  );
  assert.equal(loadClientModule(["html-utils", "ui-feedback-client"]).reducedMotion(), false);
});

test("collapseEl follows the one predicate: finished at once under reduced motion, animated otherwise", () => {
  for (const reduce of [true, false]) {
    const timers = createFakeTimers();
    const win = loadClientModule(["html-utils", "ui-feedback-client", "ui-motion-client"], {
      globals: { ...mediaQuery(reduce), setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout },
    });
    const host = createHost(win.document, { html: `<div class="card">x</div>` });
    let done = 0;
    win.CairnUiMotion.collapseEl(host.querySelector(".card"), () => done++);
    assert.equal(done, reduce ? 1 : 0);
    timers.tick(400);
    assert.equal(done, 1);
  }
});

test("no client module keeps its own reduced-motion check", () => {
  const dir = new URL("../src/client/", import.meta.url);
  const offenders = [];
  const walk = (base) => {
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      const url = new URL(entry.name + (entry.isDirectory() ? "/" : ""), base);
      if (entry.isDirectory()) walk(url);
      else if (entry.name.endsWith(".ts") && entry.name !== "ui-feedback-client.ts") {
        const source = readFileSync(url, "utf8");
        if (/matchMedia\(\s*["'`]\(prefers-reduced-motion/.test(source) || /\bmotionReduced\b/.test(source)) {
          offenders.push(url.pathname.split("/src/client/")[1]);
        }
      }
    }
  };
  walk(dir);
  assert.deepEqual(offenders, []);
});
