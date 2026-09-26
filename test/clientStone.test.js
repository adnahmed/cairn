// The stone renderer (ui-stone-model + ui-stone, docs/DESIGN.md "Stones"): a seeded
// superellipse that keeps its shape on every paint, a cairn whose base is widest and
// whose stones rest on each other, and SVG that carries each stone's OWN hue as a class
// — never a tone, never a colour literal — with the dawn dot as the only state mark.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadClientModule, renderHtml } from "./_dom.mjs";

const MODULES = ["html-utils", "ui-stone-model", "ui-stone"];
const load = () => loadClientModule(MODULES);
const plain = (value) => JSON.parse(JSON.stringify(value));

test("the generator is seeded: one seed, one sequence; another seed, another", () => {
  const win = load();
  const a = win.CairnStoneModel.rng(42);
  const b = win.CairnStoneModel.rng(42);
  const c = win.CairnStoneModel.rng(43);
  const seqA = [a(), a(), a()];
  assert.deepEqual(seqA, [b(), b(), b()]);
  assert.notDeepEqual(seqA, [c(), c(), c()]);
  for (const v of seqA) assert.ok(v > 0 && v < 1, "values sit in (0, 1)");
  const zero = win.CairnStoneModel.rng(0);
  assert.ok(zero() > 0, "a zero seed still runs");
});

test("a stone's outline is stable, closed, and jittered by its seed", () => {
  const { stonePath } = load().CairnStoneModel;
  const d = stonePath(50, 30, 20, 10, 3);
  assert.equal(d, stonePath(50, 30, 20, 10, 3), "same seed, same outline");
  assert.notEqual(d, stonePath(50, 30, 20, 10, 4), "another seed, another stone");
  assert.match(d, /^M[\d.,-]+(C[\d., -]+){16}Z$/, "16 cubic segments, closed");
  const nums = d.match(/-?\d+(?:\.\d+)?/g).map(Number);
  const xs = nums.filter((_, i) => i % 2 === 0);
  const ys = nums.filter((_, i) => i % 2 === 1);
  assert.ok(Math.max(...xs) <= 50 + 20 * 1.1 && Math.min(...xs) >= 50 - 20 * 1.1, "stays near its width");
  assert.ok(Math.max(...ys) - 30 < 30 - Math.min(...ys), "the lower half sits flatter than the top");
  for (const n of nums) assert.ok(Number.isFinite(n));
});

test("a stone's geometry: contact shadow under it, under-curve across it", () => {
  const g = load().CairnStoneModel.stoneGeometry({ cx: 40, cy: 20, rx: 30, ry: 12, seed: 5 });
  assert.ok(g.shadow.cy > 20 && g.shadow.cy < 20 + 12, "the shadow sits under the stone's belly");
  assert.ok(g.shadow.rx < 30 && g.shadow.ry < 12);
  assert.match(g.under, /^M[\d.,-]+ Q[\d.,-]+ [\d.,-]+$/);
});

test("the cairn: top first, the base widest, each stone resting on the one below", () => {
  const { cairnLayout } = load().CairnStoneModel;
  const six = cairnLayout(6);
  assert.equal(six.stones.length, 6);
  const widths = plain(six.stones.map((s) => s.rx));
  assert.deepEqual([...widths].sort((a, b) => a - b), widths, "widths grow toward the base");
  for (let i = 1; i < six.stones.length; i++) {
    const above = six.stones[i - 1];
    const below = six.stones[i];
    assert.ok(above.cy < below.cy, "stacked top to bottom");
    assert.ok(above.cy + above.ry > below.cy - below.ry, "each overlaps the one below it: resting, not floating");
  }
  assert.ok(six.stones[0].cy - six.stones[0].ry >= 0, "the top stone is inside the box");
  const base = six.stones[5];
  assert.ok(six.height >= base.cy + base.ry, "the base (and its shadow) fit");
  const offsets = new Set(six.stones.map((s) => s.cx));
  assert.ok(offsets.size > 1, "gentle x-offsets, never a ruler-straight column");
  const three = cairnLayout(3);
  assert.deepEqual(plain(three.stones.map((s) => s.rx)), plain(widths.slice(3)), "a shorter cairn keeps the base end");
  assert.equal(cairnLayout(0).stones.length, 0);
  const big = cairnLayout(6, { scale: 2 });
  assert.equal(big.stones[5].rx, six.stones[5].rx * 2);
});

test("stone keys: the six, each with its own fixed seed", () => {
  const { isStoneKey, seedFor, STONE_KEYS } = load().CairnStoneModel;
  assert.deepEqual(plain(STONE_KEYS), ["strength", "endurance", "recovery", "fuel", "body", "heart"]);
  assert.equal(isStoneKey("heart"), true);
  assert.equal(isStoneKey("mood"), false);
  assert.equal(isStoneKey(null), false);
  assert.equal(new Set(STONE_KEYS.map((k) => seedFor(k))).size, 6);
  assert.equal(seedFor("heart"), seedFor("heart"));
});

test("a pebble carries its own hue as a class, a sheen, a shadow and an under-curve — no colour literal", () => {
  const win = load();
  const html = win.CairnStone.pebbleSvg("fuel", { idPrefix: "t-fuel" });
  assert.doesNotMatch(html, /#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i, "colour lives in CSS, never in markup");
  const host = renderHtml(html, { document: win.document });
  const stone = host.querySelector("g.stone");
  assert.ok(stone.classList.contains("stone-fuel"));
  assert.ok(host.querySelector(".stone-contact"));
  assert.ok(host.querySelector(".stone-rock"));
  assert.equal(host.querySelector(".stone-sheen").getAttribute("fill"), "url(#t-fuel-sheen)");
  assert.ok(host.querySelector("linearGradient#t-fuel-sheen"));
  assert.ok(host.querySelector(".stone-under"));
  assert.equal(host.querySelector(".stone-flag"), null, "no dot unless it is worth a look");
  assert.equal(host.querySelector("svg").getAttribute("aria-hidden"), "true");
  assert.equal(host.textContent.trim(), "", "a stone says nothing itself; words sit beside it");
});

test("state is a dawn dot, never a fill; an unknown key is a plain stone", () => {
  const win = load();
  const flagged = renderHtml(win.CairnStone.pebbleSvg("heart", { idPrefix: "h", flag: true }), { document: win.document });
  assert.ok(flagged.querySelector(".stone-flag"));
  assert.ok(flagged.querySelector("g.stone").classList.contains("stone-heart"), "the hue does not change with the state");
  assert.equal(win.CairnStone.hueClass("mood"), "stone-plain");
  assert.equal(win.CairnStone.hueClass('"><script>'), "stone-plain");
});

test("the cairn svg: one stone per entry, painted base-first so each upper stone sits in front, hooks on each stone, drift optional, text escaped", () => {
  const win = load();
  const html = win.CairnStone.cairnSvg(
    [
      { key: "strength", attrs: { "data-go": "strength", style: "--i:0" } },
      { key: "heart", flag: true, cls: "extra", attrs: { "data-go": '"><b>x</b>', style: "--i:1", "bad name": "no" } },
    ],
    { idPrefix: "t-cairn", drift: true, label: "Your <cairn>" }
  );
  const host = renderHtml(html, { document: win.document });
  const stones = host.querySelectorAll("g.stone");
  assert.equal(stones.length, 2);
  // Document order is paint order: the base (heart, the last entry) comes first.
  assert.ok(stones[0].classList.contains("stone-heart") && stones[0].classList.contains("extra"));
  assert.ok(stones[1].classList.contains("stone-strength"));
  assert.equal(stones[1].getAttribute("style"), "--i:0", "--i stays the caller's top-first position");
  assert.equal(stones[0].getAttribute("data-go"), '"><b>x</b>');
  assert.equal(stones[0].getAttribute("bad name"), null);
  assert.equal(host.querySelector("b"), null, "hostile attribute text stays text");
  assert.equal(host.querySelectorAll(".stone-drift").length, 2);
  assert.equal(host.querySelector("svg").getAttribute("aria-label"), "Your <cairn>");
  assert.equal(host.querySelectorAll("linearGradient").length, 1, "one sheen per svg");
  assert.equal(win.CairnStone.cairnSvg([], { idPrefix: "none" }), "");
  const still = win.CairnStone.cairnSvg([{ key: "body" }], { idPrefix: "s" });
  assert.doesNotMatch(still, /stone-drift/);
});
