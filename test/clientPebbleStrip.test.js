// The pebble strip (pebble-strip-model/-client/-controller, mounted once on Today by
// CairnPebbleStripController.mountToday): six pebbles off GET /api/today/stones, the
// server's word printed verbatim under each, a tone mapped to a class, each pebble a
// link into its stone's own surface, one settle entrance that reduced motion skips,
// and nothing that asks for a tap or reads as a score.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeEvent, createHost, fire, flush, loadClientModule, renderHtml } from "./_dom.mjs";

const MODULES = [
  "html-utils",
  "ui-actions-client",
  "pebble-strip-model",
  "pebble-strip-client",
  "pebble-strip-controller",
];

function load(globals = {}) {
  return loadClientModule(MODULES, { globals });
}

const DATE = "2026-09-26";

function stone(key, label, word, tone, target, line = null) {
  return { key, label, word, tone, line, target };
}

function read(overrides = {}) {
  const stones = [
    stone(
      "strength",
      "Strength",
      "planned",
      "ok",
      { tab: "progress", section: "overview" },
      "Upper day is on the plan."
    ),
    stone("endurance", "Endurance", "building", "ok", { tab: "plan", section: "endurance" }),
    stone("fuel", "Fuel", "in progress", "quiet", { tab: "plan", section: "food" }),
    stone("recovery", "Recovery", "quiet", "quiet", { tab: "stand", section: "recovery" }),
    stone("body", "Body", "on course", "ok", { tab: "stand", section: "body" }),
    stone("heart", "Heart", "worth noting", "watch", { tab: "stand", section: "markers" }),
  ];
  return { date: DATE, stones, ...overrides };
}

const hrefFor = (target) => `/app/${target.tab}${target.section ? `/${target.section}` : ""}`;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function recorder({ warm = null, respond = () => Promise.resolve(read()), reduced = false, date = DATE } = {}) {
  const loads = [];
  const peeks = [];
  const navigations = [];
  return {
    loads,
    peeks,
    navigations,
    deps: {
      date,
      peek: (key) => {
        peeks.push(key);
        return warm ? { data: warm, fresh: false } : null;
      },
      load: (path, options) => {
        loads.push({ path, key: options?.key });
        return respond(path);
      },
      navigate: (target) => navigations.push(target),
      hrefFor,
      reducedMotion: () => reduced,
    },
  };
}

function words(host) {
  return host.querySelectorAll(".pebble-strip-word").map((el) => el.textContent);
}

// ---------- model + renderer ----------

test("six pebbles, in the server's order, each word printed verbatim under its stone", () => {
  const win = load();
  const model = win.CairnPebbleStripModel.model(read(), { hrefFor });
  const host = renderHtml(win.CairnPebbleStrip.html(model), { document: win.document });
  const pebbles = host.querySelectorAll(".pebble-strip-pebble");
  assert.equal(pebbles.length, 6);
  assert.deepEqual(words(host), ["planned", "building", "in progress", "quiet", "on course", "worth noting"]);
  assert.deepEqual(
    host.querySelectorAll(".pebble-strip-label").map((el) => el.textContent),
    ["Strength", "Endurance", "Fuel", "Recovery", "Body", "Heart"]
  );
  const first = pebbles[0];
  const children = first.children.map((el) => el.className);
  assert.deepEqual(
    children,
    ["pebble-strip-stone", "pebble-strip-label", "pebble-strip-word"],
    "the word sits under the stone"
  );
  assert.equal(first.querySelector(".pebble-strip-stone").getAttribute("aria-hidden"), "true");
  assert.equal(host.querySelector("nav.pebble-strip").getAttribute("aria-label"), "Today's stones");
});

test("the renderer never works a word out: odd words pass through, and a stone without one is left off", () => {
  const win = load();
  const odd = read();
  odd.stones[0].word = "a server word the client has never seen";
  odd.stones[3].word = "";
  odd.stones[4].word = null;
  const model = win.CairnPebbleStripModel.model(odd, { hrefFor });
  assert.deepEqual(
    [...model.pebbles.map((p) => p.word)],
    ["a server word the client has never seen", "building", "in progress", "worth noting"]
  );
  const host = renderHtml(win.CairnPebbleStrip.html(model), { document: win.document });
  assert.equal(words(host).includes("quiet"), false, "no word is invented for a stone that sent none");
  assert.equal(win.CairnPebbleStripModel.model(null), null);
  assert.equal(win.CairnPebbleStripModel.model({ date: DATE }), null, "not a stones read");
  assert.equal(
    win.CairnPebbleStrip.html(win.CairnPebbleStripModel.model({ date: DATE, stones: [] })),
    "",
    "no pebbles, no strip"
  );
});

test("tones map to the reading layer's classes; an unknown tone reads quiet; no colour in the markup", () => {
  const win = load();
  const odd = read();
  odd.stones[1].tone = "red";
  const html = win.CairnPebbleStrip.html(win.CairnPebbleStripModel.model(odd, { hrefFor }));
  const host = renderHtml(html, { document: win.document });
  const tones = host
    .querySelectorAll(".pebble-strip-pebble")
    .map((el) => ["ok", "watch", "quiet"].find((tone) => el.classList.contains(`pebble-strip-${tone}`)));
  assert.deepEqual(tones, ["ok", "quiet", "quiet", "quiet", "ok", "watch"]);
  assert.doesNotMatch(html, /#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i, "tone travels as a class, never a colour");
});

test("each pebble is a link to its stone's own surface, carrying the server's line to assistive tech", () => {
  const win = load();
  const host = renderHtml(win.CairnPebbleStrip.html(win.CairnPebbleStripModel.model(read(), { hrefFor })), {
    document: win.document,
  });
  const links = host.querySelectorAll("a.pebble-strip-pebble");
  assert.deepEqual(
    links.map((a) => a.getAttribute("href")),
    [
      "/app/progress/overview",
      "/app/plan/endurance",
      "/app/plan/food",
      "/app/stand/recovery",
      "/app/stand/body",
      "/app/stand/markers",
    ]
  );
  assert.deepEqual(
    links.map((a) => a.getAttribute("data-pebble-strip-go")),
    ["strength", "endurance", "fuel", "recovery", "body", "heart"]
  );
  assert.equal(links[0].getAttribute("aria-label"), "Strength: planned. Upper day is on the plan.");
  assert.equal(links[3].getAttribute("aria-label"), "Recovery: quiet");
});

test("it never asks for a tap and never reads as a score", () => {
  const win = load();
  const html = win.CairnPebbleStrip.html(win.CairnPebbleStripModel.model(read(), { hrefFor }), { enter: true });
  const host = renderHtml(html, { document: win.document });
  const visible = host.textContent;
  assert.doesNotMatch(visible, /\d/, "no number anywhere in the strip");
  assert.doesNotMatch(html, /tap|click|open|see more|›|→|badge|count/i, "no invitation, chevron or badge");
  assert.doesNotMatch(html, /\bscore\b|\/100|%|grade/i);
  assert.equal(host.querySelector("button"), null, "nothing here is an action to take");
});

test("hostile server text stays text", () => {
  const win = load();
  const hostile = read();
  hostile.stones[0].word = "<b>bold</b>";
  hostile.stones[0].label = '<img src=x onerror="1">';
  hostile.stones[0].line = '"><script>1</script>';
  const host = renderHtml(win.CairnPebbleStrip.html(win.CairnPebbleStripModel.model(hostile, { hrefFor })), {
    document: win.document,
  });
  assert.equal(host.querySelector("b"), null);
  assert.equal(host.querySelector("img"), null);
  assert.equal(host.querySelector("script"), null);
  assert.equal(host.querySelector(".pebble-strip-word").textContent, "<b>bold</b>");
});

test("without a link for a stone, the pebble still prints its word but is not a link", () => {
  const win = load();
  const host = renderHtml(win.CairnPebbleStrip.html(win.CairnPebbleStripModel.model(read())), {
    document: win.document,
  });
  assert.equal(host.querySelectorAll("a").length, 0);
  assert.equal(host.querySelectorAll("span.pebble-strip-pebble").length, 6);
  assert.equal(words(host).length, 6);
});

test("the skeleton is six ghost stones and says nothing", () => {
  const win = load();
  const host = renderHtml(win.CairnPebbleStrip.skeletonHtml(), { document: win.document });
  assert.equal(host.querySelectorAll(".pebble-strip-item").length, 6);
  assert.equal(host.querySelector(".pebble-strip").getAttribute("aria-busy"), "true");
  assert.equal(host.textContent.trim(), "");
});

// ---------- controller ----------

test("a warm cache paints at once with its entrance; an unchanged revalidation never repaints", async () => {
  const win = load();
  const host = createHost(win.document);
  const rec = recorder({ warm: read() });
  win.CairnPebbleStripController.mount(host, rec.deps);
  const strip = host.querySelector("nav.pebble-strip");
  assert.ok(strip, "painted synchronously from the cache");
  assert.equal(strip.classList.contains("is-entering"), true, "the morning's first strip settles in");
  assert.deepEqual(rec.peeks, [`today:stones:${DATE}`]);
  assert.deepEqual(rec.loads, [{ path: `/today/stones?date=${DATE}`, key: `today:stones:${DATE}` }]);
  await flush();
  assert.equal(host.querySelector("nav.pebble-strip"), strip, "the same node: nothing re-rendered");
});

test("the settle plays once per day: a repaint that rebuilds the slot arrives still", async () => {
  const win = load();
  const first = createHost(win.document);
  win.CairnPebbleStripController.mount(first, recorder().deps);
  await flush();
  assert.equal(first.querySelector(".pebble-strip").classList.contains("is-entering"), true);
  const again = createHost(win.document);
  win.CairnPebbleStripController.mount(again, recorder({ warm: read() }).deps);
  assert.equal(again.querySelector(".pebble-strip").classList.contains("is-entering"), false);
});

test("reduced motion paints the strip with no entrance", async () => {
  const win = load();
  const host = createHost(win.document);
  win.CairnPebbleStripController.mount(host, recorder({ reduced: true }).deps);
  await flush();
  assert.ok(host.querySelector(".pebble-strip"));
  assert.equal(host.querySelector(".pebble-strip").classList.contains("is-entering"), false);
});

test("a cold mount shows the skeleton, then the server's strip", async () => {
  const win = load();
  const host = createHost(win.document);
  const gate = deferred();
  win.CairnPebbleStripController.mount(host, recorder({ respond: () => gate.promise }).deps);
  assert.ok(host.querySelector(".pebble-strip-skel"), "the strip's own shape while it reads");
  gate.resolve(read());
  await flush();
  assert.equal(host.querySelector(".pebble-strip-skel"), null);
  assert.equal(host.querySelectorAll(".pebble-strip-pebble").length, 6);
});

test("a changed revalidation repaints in place with the server's new word", async () => {
  const win = load();
  const host = createHost(win.document);
  const next = read();
  next.stones[3] = stone("recovery", "Recovery", "rested", "ok", { tab: "stand", section: "recovery" });
  win.CairnPebbleStripController.mount(host, recorder({ warm: read(), respond: () => Promise.resolve(next) }).deps);
  assert.equal(words(host)[3], "quiet");
  await flush();
  assert.equal(words(host)[3], "rested");
});

test("a failed read with nothing cached collapses the slot; a warm strip stands through a failure", async () => {
  const win = load();
  const cold = createHost(win.document);
  win.CairnPebbleStripController.mount(cold, recorder({ respond: () => Promise.reject(new Error("offline")) }).deps);
  await flush();
  assert.equal(cold.innerHTML, "", "never an error line, never a retry to tap");

  const warm = createHost(win.document);
  win.CairnPebbleStripController.mount(
    warm,
    recorder({ warm: read(), respond: () => Promise.reject(new Error("offline")) }).deps
  );
  await flush();
  assert.equal(warm.querySelectorAll(".pebble-strip-pebble").length, 6);
});

test("an empty read leaves nothing to show", async () => {
  const win = load();
  const host = createHost(win.document);
  win.CairnPebbleStripController.mount(
    host,
    recorder({ respond: () => Promise.resolve({ date: DATE, stones: [] }) }).deps
  );
  await flush();
  assert.equal(host.innerHTML, "");
});

test("a tap follows the server's target once, even after a second mount on the same host", async () => {
  const win = load();
  const host = createHost(win.document);
  const rec = recorder({ warm: read() });
  win.CairnPebbleStripController.mount(host, rec.deps);
  win.CairnPebbleStripController.mount(host, rec.deps);
  const heart = host.querySelector('[data-pebble-strip-go="heart"]');
  const event = new FakeEvent("click", { bubbles: true, cancelable: true, button: 0 });
  await fire(heart.querySelector(".pebble-strip-word"), event);
  assert.deepEqual(JSON.parse(JSON.stringify(rec.navigations)), [{ tab: "stand", section: "markers" }]);
  assert.equal(event.defaultPrevented, true, "the app navigates; the page does not reload");
});

test("a modified click keeps the link's own behaviour", async () => {
  const win = load();
  const host = createHost(win.document);
  const rec = recorder({ warm: read() });
  win.CairnPebbleStripController.mount(host, rec.deps);
  const event = new FakeEvent("click", { bubbles: true, cancelable: true, button: 0, metaKey: true });
  await fire(host.querySelector('[data-pebble-strip-go="fuel"]'), event);
  assert.deepEqual(rec.navigations, []);
  assert.equal(event.defaultPrevented, false);
});

test("a read that lands after the person left, or after teardown, writes nothing", async () => {
  const win = load();
  const host = createHost(win.document);
  const gate = deferred();
  win.CairnPebbleStripController.mount(host, recorder({ respond: () => gate.promise }).deps);
  host.remove();
  gate.resolve(read());
  await flush();
  assert.equal(host.querySelector(".pebble-strip-word"), null);

  const torn = createHost(win.document);
  const later = deferred();
  const teardown = win.CairnPebbleStripController.mount(torn, recorder({ respond: () => later.promise }).deps);
  teardown();
  later.resolve(read());
  await flush();
  assert.equal(torn.querySelector(".pebble-strip-word"), null);
});

// ---------- the Today mount ----------

function loadToday({ warm = read(), respond = () => Promise.resolve(read()) } = {}) {
  const calls = { loads: [], routes: [], tabs: [] };
  const win = loadClientModule([...MODULES, "route-state"], {
    globals: {
      peekCached: () => (warm ? { data: warm, fresh: false } : null),
      cachedApi: (path, options) => {
        calls.loads.push({ path, key: options?.key });
        return respond(path);
      },
      reducedMotion: () => false,
      applyRouteState: (route) => {
        calls.routes.push(route);
        return route.tab;
      },
    },
  });
  win.routeApi = () => win.CairnRoutes;
  const deps = { state: { logDate: DATE }, activateTab: (tab) => calls.tabs.push(tab) };
  return { win, calls, deps };
}

const TODAY_HTML = `<div class="today-main"><div id="ctxBanner"></div><section class="brief"></section><div class="cfocus-slot" id="cfocusSlot"></div><div id="attentionLead"></div></div>`;

test("Today mounts the strip directly under the Brief, with the app's own route links", async () => {
  const { win, calls, deps } = loadToday();
  const view = createHost(win.document, { html: TODAY_HTML });
  win.CairnPebbleStripController.mountToday(view, deps);
  const main = view.querySelector(".today-main");
  const slot = view.querySelector("#pebbleStripSlot");
  assert.ok(slot, "the slot is made on first mount");
  assert.equal(main.children[1].className.split(" ")[0], "brief", "the Brief still leads");
  assert.equal(main.children[2], slot, "the strip sits right under it");
  assert.deepEqual(calls.loads, [{ path: `/today/stones?date=${DATE}`, key: `today:stones:${DATE}` }]);
  assert.equal(slot.querySelector('[data-pebble-strip-go="recovery"]').getAttribute("href"), "/app/stand/recovery");

  // A soft repaint that kept the column reuses the one slot.
  win.CairnPebbleStripController.mountToday(view, deps);
  assert.equal(view.querySelectorAll("#pebbleStripSlot").length, 1);
  await flush();

  await slot.querySelector('[data-pebble-strip-go="endurance"]').click();
  assert.equal(calls.routes.length, 1);
  assert.equal(calls.routes[0].tab, "plan");
  assert.equal(calls.routes[0].section, "endurance");
  assert.deepEqual(calls.tabs, ["plan"]);
});

test("the changes line, mounted beside it, lands under the strip and the Brief still leads", () => {
  const { win, deps } = loadToday();
  const view = createHost(win.document, {
    html: `<div class="today-main"><section class="brief"></section><div id="changesLineSlot"></div><div id="cfocusSlot"></div></div>`,
  });
  win.CairnPebbleStripController.mountToday(view, deps);
  const ids = view.querySelector(".today-main").children.map((el) => el.id || el.className);
  assert.deepEqual(ids, ["brief", "pebbleStripSlot", "changesLineSlot", "cfocusSlot"]);
});

test("Today without a Brief mounts nothing", () => {
  const { win, calls, deps } = loadToday();
  const view = createHost(win.document, { html: `<div class="today-main"></div>` });
  const teardown = win.CairnPebbleStripController.mountToday(view, deps);
  assert.equal(typeof teardown, "function");
  assert.equal(view.querySelector("#pebbleStripSlot"), null);
  assert.deepEqual(calls.loads, []);
});
