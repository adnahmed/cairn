// The v2 controls that render under 44px keep their calm visual size and take the
// shared invisible hit overlay (src/styles/foundation/a11y.css §38), and the v2
// controls that stand alone clear 44px themselves (docs/DESIGN.md "Accessibility
// minimums").
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

test("small v2 pills, chips and the back link carry the 44px hit overlay", () => {
  const a11y = read("src/styles/foundation/a11y.css");
  const overlay = /([^}]*)\{\s*content:"";position:absolute;top:50%;left:50%;transform:translate\(-50%,-50%\);\s*min-width:44px;min-height:44px;/.exec(
    a11y
  );
  assert.ok(overlay, "the shared 44px overlay rule exists");
  const relative = /([^}]*)\{position:relative\}/.exec(a11y)[1];
  for (const cls of [".pillbtn", ".home-back", ".stone-detail-chip", ".hdr-changes", ".wt-mini", ".tag-chip"]) {
    assert.ok(overlay[1].includes(`${cls}::before`), `${cls} takes the overlay`);
    assert.ok(relative.split(",").map((s) => s.trim()).includes(cls), `${cls} anchors it`);
  }
});

test("v2 controls pinned at a height clear 44px", () => {
  const pins = [
    ["src/styles/ask/ask.css", ".ripple-actions .pillbtn{"],
    ["src/styles/ask/ask.css", ".ripple-actions .linkbtn-quiet,.ripple-changes{"],
    ["src/styles/ask/changes.css", ".chfeed-undo{"],
    ["src/styles/fuel/today.css", ".idea-card-start,.idea-card-another{"],
    ["src/styles/today/brief.css", ".brief-around-sum{"],
  ];
  for (const [file, head] of pins) {
    const css = read(file);
    const at = css.indexOf(head);
    assert.ok(at >= 0, `${file} has ${head}`);
    const body = css.slice(at, css.indexOf("}", at));
    assert.match(body, /min-height:44px/, `${head} clears 44px`);
  }
});
