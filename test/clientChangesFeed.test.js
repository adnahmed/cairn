// The Changes feed component (changes-feed-client.ts + changes-feed-controller.ts):
// the athlete-facing projection of the team's decisions (GET /api/brain/changes),
// grouped by day, with the server-labelled Undo through the shared decision-undo
// primitive. Renderer and controller both run on the shared DOM harness.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHost, flush, loadClientModule, renderHtml } from "./_dom.mjs";

function load(globals = {}) {
  return loadClientModule(
    [
      "html-utils",
      "ui-components",
      "ui-actions-client",
      "decision-undo-client",
      "decision-undo-controller",
      "changes-feed-client",
      "changes-feed-controller",
    ],
    { globals }
  );
}

const clone = (value) => JSON.parse(JSON.stringify(value));

function change(overrides) {
  return {
    id: 1,
    day: "2026-09-25",
    state: "applied",
    domain: "training",
    title: "A change",
    why: null,
    status_line: "Landed today",
    lands_on: null,
    outcome: { key: "too_early", phrase: "we can't tell yet" },
    confidence: "tentative",
    undo: { available: false, label: null },
    new: false,
    ...overrides,
  };
}

function feed() {
  return {
    as_of: "2026-09-25",
    days: [
      {
        day: "2026-09-25",
        label: "Today",
        changes: [
          change({
            id: 12,
            title: "Bench Press moves to 185 lb",
            why: "Your last three sessions hit every rep at 180.",
            confidence: "observed",
            undo: { available: true, label: "Restore previous Bench Press target" },
            new: true,
          }),
          change({
            id: 11,
            state: "announced",
            title: "Swap Leg Press for Hack Squat",
            status_line: "Lands Monday",
            lands_on: "2026-09-28",
            undo: { available: true, label: "Keep Leg Press" },
            new: true,
          }),
        ],
      },
      {
        day: "2026-09-22",
        label: "Monday",
        changes: [
          change({
            id: 7,
            day: "2026-09-22",
            state: "reverted",
            domain: "recovery",
            title: "A lighter recovery week",
            why: "Sleep ran short three nights running.",
            status_line: "Put back",
            outcome: { key: "as_expected", phrase: "this moved as expected" },
            confidence: "strong",
          }),
        ],
      },
    ],
    since_seen: 2,
    since_seen_line: "2 changes overnight",
    seen_at: null,
    seen_through: "2026-09-25T10:00:00.000Z",
  };
}

// ---------- renderer ----------

test("rows are grouped by day and print the server's words verbatim", () => {
  const win = load();
  const host = renderHtml(win.CairnChangesFeed.feedHtml(feed()), { document: win.document });
  const days = host.querySelectorAll(".chfeed-day");
  assert.deepEqual(
    days.map((day) => day.querySelector(".chfeed-day-label").textContent),
    ["Today", "Monday"]
  );
  assert.deepEqual(
    days.map((day) => day.querySelectorAll(".chfeed-row").length),
    [2, 1]
  );

  const bench = host.querySelector('[data-chfeed-id="12"]');
  assert.equal(bench.querySelector(".chfeed-title").textContent, "Bench Press moves to 185 lb");
  assert.equal(bench.querySelector(".chfeed-why").textContent, "Your last three sessions hit every rep at 180.");
  assert.equal(bench.querySelector(".chfeed-outcome").textContent, "we can't tell yet");
  assert.ok(bench.querySelector(".chfeed-outcome").classList.contains("chfeed-outcome-quiet"));
  assert.equal(bench.querySelector(".chfeed-status").textContent, "Landed today");
  assert.match(bench.querySelector(".chfeed-conf").textContent, /confidence observed/);
  assert.equal(bench.querySelector(".chfeed-new").textContent, "New");
  assert.ok(bench.classList.contains("is-new"));
  assert.ok(bench.classList.contains("is-applied"));

  const undo = bench.querySelector("button");
  assert.equal(undo.getAttribute("type"), "button");
  assert.equal(undo.textContent, "Restore previous Bench Press target", "the server owns the label");
  assert.equal(undo.getAttribute("data-chfeed-undo"), "12");

  const swap = host.querySelector('[data-chfeed-id="11"]');
  assert.equal(swap.querySelector("button").getAttribute("data-chfeed-hold"), "11", "an announced change is held");
  assert.equal(swap.querySelector("button").textContent, "Keep Leg Press");
  assert.equal(swap.querySelector(".chfeed-why"), null, "no why is printed when the server wrote none");

  const recovery = host.querySelector('[data-chfeed-id="7"]');
  assert.equal(recovery.querySelector("[data-chfeed-undo], [data-chfeed-hold]"), null, "no Undo when the server says it is unavailable");
  // Every row keeps the one optional door to the conversation.
  assert.equal(recovery.querySelector("[data-chfeed-talk]").textContent, "Talk it through");
  assert.ok(recovery.querySelector(".chfeed-outcome").classList.contains("chfeed-outcome-ok"));
  assert.equal(recovery.querySelector(".chfeed-new"), null);
});

test("hostile text comes back as text, never markup", () => {
  const win = load();
  const data = feed();
  data.days[0].label = "<i>Today</i>";
  data.days[0].changes[0].title = "<b>bench</b>";
  data.days[0].changes[0].why = "<img src=x onerror=alert(1)>";
  data.days[0].changes[0].undo.label = "<script>x</script>";
  const host = renderHtml(win.CairnChangesFeed.feedHtml(data), { document: win.document });
  assert.equal(host.querySelector("b"), null);
  assert.equal(host.querySelector("i"), null);
  assert.equal(host.querySelector("img"), null);
  assert.equal(host.querySelector("script"), null);
  assert.equal(host.querySelector(".chfeed-title").textContent, "<b>bench</b>");
  assert.equal(host.querySelector(".chfeed-undo").textContent, "<script>x</script>");
});

test("an empty feed says what would fill it, never a zero", () => {
  const win = load();
  for (const data of [{ ...feed(), days: [] }, null]) {
    const host = renderHtml(win.CairnChangesFeed.feedHtml(data), { document: win.document });
    const empty = host.querySelector(".chfeed-empty");
    assert.ok(empty);
    assert.equal(empty.getAttribute("role"), "status");
    assert.match(empty.textContent, /When the team adjusts your training or meals/);
    assert.doesNotMatch(empty.textContent, /\b0\b|no data/i);
  }
});

const SET_ASIDE = [
  {
    id: 90,
    day: "2026-09-24",
    label: "Yesterday",
    line: "An older draft for Back Squat was set aside: a newer review replaced it.",
  },
];

test("drafts set aside are quiet lines after the changes: no Undo, no outcome, never news", () => {
  const win = load();
  const host = renderHtml(win.CairnChangesFeed.feedHtml({ ...feed(), set_aside: SET_ASIDE }), {
    document: win.document,
  });
  const aside = host.querySelector(".chfeed-aside");
  assert.ok(aside, "the set-aside group");
  assert.equal(host.querySelector(".chfeed").lastElementChild, aside, "it closes the feed, under the changes");
  assert.equal(aside.querySelector(".chfeed-day-label").textContent, "Set aside");
  const rows = aside.querySelectorAll(".chfeed-aside-row");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].querySelector(".chfeed-why").textContent, SET_ASIDE[0].line);
  assert.equal(rows[0].querySelector(".chfeed-meta").textContent, "Yesterday");
  assert.equal(aside.querySelector("button, .chfeed-outcome, .chfeed-new, [data-chfeed-id]"), null);
  assert.equal(host.querySelectorAll(".chfeed-day").length, 2, "not a day of changes");
  // With no change to show, the calm empty state still stands over the line.
  const only = renderHtml(win.CairnChangesFeed.feedHtml({ ...feed(), days: [], set_aside: SET_ASIDE }), {
    document: win.document,
  });
  assert.ok(only.querySelector(".chfeed-empty"));
  assert.equal(only.querySelectorAll(".chfeed-aside-row").length, 1);
  assert.equal(win.CairnChangesFeed.setAsideHtml({ ...feed(), set_aside: [] }), "");
  assert.equal(win.CairnChangesFeed.setAsideHtml(feed()), "", "an older server sends none");
});

test("the first paint staggers rows in; an in-place paint does not", () => {
  const win = load();
  const first = renderHtml(win.CairnChangesFeed.feedHtml(feed(), { reveal: true }), { document: win.document });
  assert.deepEqual(
    first
      .querySelectorAll(".chfeed-row")
      .map((row) => [row.classList.contains("reveal"), row.style.getPropertyValue("--i")]),
    [
      [true, "0"],
      [true, "1"],
      [true, "2"],
    ]
  );
  const quiet = renderHtml(win.CairnChangesFeed.feedHtml(feed()), { document: win.document });
  assert.equal(quiet.querySelector(".reveal"), null);
  assert.equal(quiet.querySelector(".chfeed-row").getAttribute("style"), null);
});

// ---------- controller ----------

function harness({ peek = null, fresh = true, reads = [], reduced = false, revert = () => ({ ok: true }) } = {}) {
  const store = new Map();
  if (peek) store.set("brain:changes", { data: peek, fresh });
  const calls = [];
  const toasts = [];
  const collapsed = [];
  const reverted = [];
  const invalidated = [];
  const queue = [...reads];
  const deps = {
    api: async (path, init) => {
      calls.push({ path, method: init?.method, body: JSON.parse(init?.body || "null") });
      if (path === "/brain/changes/seen") return { ok: true, seen_at: "2026-09-25T10:00:00.000Z" };
      return revert(path);
    },
    toast: (message) => toasts.push(message),
    peekCached: (key) => store.get(key) || null,
    cachedApi: async (path, options = {}) => {
      calls.push({ path, method: "GET" });
      await Promise.resolve(); // a real read never resolves inside the call
      const next = queue.length > 1 ? queue.shift() : queue[0];
      if (next instanceof Error || next === undefined) throw next || new Error("offline");
      const data = clone(next);
      const prior = store.get(options.key);
      const changed = !prior || JSON.stringify(prior.data) !== JSON.stringify(data);
      store.set(options.key, { data, fresh: true });
      options.onUpgrade?.(data, { changed });
      return data;
    },
    swrInvalidate: (key) => {
      invalidated.push(key);
      store.delete(key);
    },
    reducedMotion: () => reduced,
    collapse: (el, done) => {
      collapsed.push(el.getAttribute("data-chfeed-id"));
      done();
    },
    skeleton: () => `<div class="skel-card" aria-hidden="true"></div>`,
    onReverted: (row) => reverted.push(row?.id ?? null),
  };
  return { deps, calls, toasts, collapsed, reverted, invalidated, store };
}

test("a warm open paints from the cache at once, then marks the feed seen", async () => {
  const win = load();
  const host = createHost(win.document);
  const h = harness({ peek: feed(), reads: [feed(), { ...feed(), since_seen: 0, since_seen_line: null }] });
  win.CairnChangesFeedController.mount(host, h.deps);
  // Synchronous: no skeleton, the real rows are already there.
  assert.equal(host.querySelectorAll(".chfeed-row").length, 3);
  assert.equal(host.querySelector(".skel-card"), null);
  const bench = host.querySelector('[data-chfeed-id="12"]');
  await flush();
  await flush();
  assert.equal(host.querySelector('[data-chfeed-id="12"]'), bench, "an unchanged revalidate never repaints");
  assert.deepEqual(
    h.calls.map((c) => [c.method, c.path, c.body?.through ?? null]),
    [
      ["GET", "/brain/changes", null],
      ["POST", "/brain/changes/seen", "2026-09-25T10:00:00.000Z"],
      ["GET", "/brain/changes", null],
    ],
    "the seen marker carries the read's own instant, and the cache is refreshed after it"
  );
  assert.deepEqual(h.invalidated, ["brain:changes"]);
  assert.equal(
    h.store.get("brain:changes").data.since_seen,
    0,
    "the next open (and the Today line) reads the seen state"
  );
  assert.ok(host.querySelector(".chfeed-new"), "this visit keeps its New marks");
});

test("a cold open shows the skeleton, paints the read, and posts nothing when nothing is new", async () => {
  const win = load();
  const host = createHost(win.document);
  const quiet = { ...feed(), since_seen: 0, since_seen_line: null };
  const h = harness({ reads: [quiet] });
  win.CairnChangesFeedController.mount(host, h.deps);
  assert.ok(host.querySelector(".skel-card"));
  await flush();
  assert.equal(host.querySelectorAll(".chfeed-row").length, 3);
  assert.ok(host.querySelector(".chfeed-row").classList.contains("reveal"));
  assert.equal(h.calls.filter((c) => c.method === "POST").length, 0);
});

test("a cold failure says so in one sentence and can try again", async () => {
  const win = load();
  const host = createHost(win.document);
  const h = harness({ reads: [new Error("offline"), { ...feed(), since_seen: 0 }] });
  win.CairnChangesFeedController.mount(host, h.deps);
  await flush();
  assert.match(host.querySelector(".chfeed-error-line").textContent, /Couldn't reach/);
  await host.querySelector("[data-chfeed-retry]").click();
  await flush();
  assert.equal(host.querySelectorAll(".chfeed-row").length, 3);
});

test("Undo reverts once through decision-undo and repaints only the affected row", async () => {
  const win = load();
  const host = createHost(win.document);
  const after = feed();
  after.since_seen = 0;
  for (const day of after.days) for (const row of day.changes) row.new = false;
  after.days[0].changes[0] = {
    ...after.days[0].changes[0],
    state: "reverted",
    status_line: "Put back",
    outcome: { key: "stopped", phrase: "this was stopped before we could tell" },
    undo: { available: false, label: null },
  };
  const h = harness({
    peek: { ...feed(), since_seen: 0 },
    reads: [{ ...feed(), since_seen: 0 }, { ...feed(), since_seen: 0 }, after],
  });
  win.CairnChangesFeedController.mount(host, h.deps);
  // Mounting again on the same host replaces the listener: one tap, one revert.
  win.CairnChangesFeedController.mount(host, h.deps);
  await flush();
  const swap = host.querySelector('[data-chfeed-id="11"]');
  const recovery = host.querySelector('[data-chfeed-id="7"]');

  await host.querySelector("[data-chfeed-undo]").click();
  await flush();

  const reverts = h.calls.filter((c) => c.path.endsWith("/revert"));
  assert.deepEqual(reverts, [
    { path: "/brain/decisions/12/revert", method: "POST", body: { reason: "undo from the Changes feed" } },
  ]);
  assert.deepEqual(h.toasts, ["Put back"]);
  assert.ok(h.invalidated.includes("brain:changes"));
  assert.deepEqual(h.reverted, [12]);

  const bench = host.querySelector('[data-chfeed-id="12"]');
  assert.ok(bench.classList.contains("is-reverted"));
  assert.ok(bench.classList.contains("is-settled"), "the changed row washes once");
  assert.equal(bench.querySelector("[data-chfeed-undo], [data-chfeed-hold]"), null, "a put-back change has no Undo left");
  assert.equal(bench.querySelector(".chfeed-outcome").textContent, "this was stopped before we could tell");
  assert.equal(host.querySelector('[data-chfeed-id="11"]'), swap, "an untouched row keeps its node");
  assert.equal(
    host.querySelector('[data-chfeed-id="7"]'),
    recovery,
    "a row that only stopped being new is not repainted"
  );
});

test("Hold posts the hold reason, and reduced motion skips the wash", async () => {
  const win = load();
  const host = createHost(win.document);
  const after = clone(feed());
  after.days[0].changes[1] = {
    ...after.days[0].changes[1],
    state: "held",
    status_line: "Held before it landed",
    undo: { available: false, label: null },
  };
  const h = harness({
    peek: { ...feed(), since_seen: 0 },
    reads: [{ ...feed(), since_seen: 0 }, after],
    reduced: true,
  });
  win.CairnChangesFeedController.mount(host, h.deps);
  await flush();
  await host.querySelector("[data-chfeed-hold]").click();
  await flush();
  assert.deepEqual(
    h.calls.filter((c) => c.path.endsWith("/revert")).map((c) => c.body.reason),
    ["hold from the Changes feed"]
  );
  assert.deepEqual(h.toasts, ["Held — it won't land"]);
  const swap = host.querySelector('[data-chfeed-id="11"]');
  assert.ok(swap.classList.contains("is-held"));
  assert.equal(swap.classList.contains("is-settled"), false);
});

test("a row the server no longer lists leaves, and its empty day goes with it", async () => {
  const win = load();
  const host = createHost(win.document);
  const after = clone(feed());
  after.days = after.days.slice(0, 1);
  const h = harness({ peek: { ...feed(), since_seen: 0 }, reads: [{ ...feed(), since_seen: 0 }, after] });
  win.CairnChangesFeedController.mount(host, h.deps);
  await flush();
  const bench = host.querySelector('[data-chfeed-id="12"]');
  await host.querySelector("[data-chfeed-undo]").click();
  await flush();
  assert.deepEqual(h.collapsed, ["7"]);
  assert.equal(host.querySelector('[data-chfeed-id="7"]'), null);
  assert.equal(host.querySelectorAll(".chfeed-day").length, 1);
  assert.equal(host.querySelector('[data-chfeed-id="12"]'), bench, "an unchanged row is left alone");
});

test("a row arriving after Undo settles in, and the rows already there keep their nodes", async () => {
  const win = load();
  const host = createHost(win.document);
  const after = clone(feed());
  after.days[0].changes.unshift(change({ id: 13, title: "Restored Bench Press target" }));
  after.days[0].changes[1].state = "reverted";
  after.days[0].changes[1].undo = { available: false, label: null };
  const h = harness({ peek: { ...feed(), since_seen: 0 }, reads: [{ ...feed(), since_seen: 0 }, after] });
  win.CairnChangesFeedController.mount(host, h.deps);
  await flush();
  const swap = host.querySelector('[data-chfeed-id="11"]');
  await host.querySelector("[data-chfeed-undo]").click();
  await flush();
  assert.deepEqual(
    host.querySelectorAll(".chfeed-row").map((row) => row.getAttribute("data-chfeed-id")),
    ["13", "12", "11", "7"]
  );
  const arrived = host.querySelector('[data-chfeed-id="13"]');
  assert.equal(arrived.classList.contains("reveal"), false, "no first-paint stagger on an in-place change");
  assert.ok(arrived.classList.contains("settle-in"), "the arrival eases in");
  assert.equal(host.querySelector('[data-chfeed-id="11"]'), swap, "an untouched row keeps its node");
  assert.equal(host.querySelector('[data-chfeed-id="11"]').classList.contains("settle-in"), false);
  assert.ok(host.querySelector('[data-chfeed-id="12"]').classList.contains("is-settled"));
});

test("Undo in the server's real order moves the put-back row within its day and keeps this visit's marks", async () => {
  const win = load();
  const host = createHost(win.document);
  const before = feed();
  before.days[0].changes[1].state = "applied";
  before.days[0].changes[1].status_line = "Landed today";
  before.days[0].changes[1].undo = { available: true, label: "Restore Leg Press" };
  // After the seen marker the server reads new:false everywhere, and a reverted row
  // (event_at null) sorts to the end of its day: [12, 11] becomes [11, 12].
  const after = clone(before);
  after.since_seen = 0;
  for (const day of after.days) for (const row of day.changes) row.new = false;
  const bench = {
    ...after.days[0].changes[0],
    state: "reverted",
    status_line: "Put back",
    undo: { available: false, label: null },
  };
  after.days[0].changes = [after.days[0].changes[1], bench];
  const h = harness({ peek: { ...before, since_seen: 0 }, reads: [{ ...before, since_seen: 0 }, after] });
  win.CairnChangesFeedController.mount(host, h.deps);
  await flush();
  assert.equal(host.querySelectorAll(".chfeed-new").length, 2);
  const swap = host.querySelector('[data-chfeed-id="11"]');
  const recovery = host.querySelector('[data-chfeed-id="7"]');

  await host.querySelector('[data-chfeed-undo="12"]').click();
  await flush();

  assert.deepEqual(
    host.querySelectorAll(".chfeed-row").map((row) => row.getAttribute("data-chfeed-id")),
    ["11", "12", "7"],
    "the server's order"
  );
  assert.equal(host.querySelectorAll(".chfeed-new").length, 2, "this visit's New marks survive the Undo");
  assert.equal(host.querySelector('[data-chfeed-id="11"]'), swap, "the untouched row keeps its node");
  assert.equal(swap.classList.contains("reveal"), false, "a row that only changes place never replays its entrance");
  assert.equal(host.querySelector('[data-chfeed-id="7"]'), recovery);
  const put = host.querySelector('[data-chfeed-id="12"]');
  assert.ok(put.classList.contains("is-reverted"));
  assert.ok(put.classList.contains("is-settled"));
  assert.equal(put.querySelector("[data-chfeed-undo], [data-chfeed-hold]"), null);
  assert.equal(host.querySelectorAll(".chfeed-day").length, 2);
});

test("a revert that lands but whose follow-up read fails shows the row put back, never a stuck Undo", async () => {
  const win = load();
  const host = createHost(win.document);
  const h = harness({ peek: { ...feed(), since_seen: 0 }, reads: [{ ...feed(), since_seen: 0 }] });
  win.CairnChangesFeedController.mount(host, h.deps);
  await flush();
  const swap = host.querySelector('[data-chfeed-id="11"]');
  h.deps.cachedApi = async () => {
    throw new Error("swr-offline");
  };
  await host.querySelector('[data-chfeed-undo="12"]').click();
  await flush();
  assert.deepEqual(h.toasts, ["Put back"]);
  const bench = host.querySelector('[data-chfeed-id="12"]');
  assert.ok(bench.classList.contains("is-reverted"));
  assert.equal(bench.querySelector(".chfeed-status").textContent, "Put back");
  assert.equal(bench.querySelector("[data-chfeed-undo], [data-chfeed-hold]"), null, "no Undo left, busy or otherwise");
  assert.equal(host.querySelector("[aria-busy]"), null);
  assert.ok(bench.querySelector(".chfeed-new"), "this visit's New mark stays");
  assert.equal(host.querySelector('[data-chfeed-id="11"]'), swap);
  assert.ok(h.invalidated.includes("brain:changes"), "the next open reads the server's truth");
});

test("a changed revalidate over a warm paint patches rows in place instead of repainting", async () => {
  const win = load();
  const host = createHost(win.document);
  const warm = { ...feed(), since_seen: 0 };
  const fresh = clone(warm);
  fresh.days[1].changes.push(change({ id: 5, day: "2026-09-22", title: "Easier Tuesday run" }));
  fresh.days[0].changes[1].status_line = "Lands Tuesday";
  const h = harness({ peek: warm, fresh: false, reads: [fresh] });
  win.CairnChangesFeedController.mount(host, h.deps);
  const bench = host.querySelector('[data-chfeed-id="12"]');
  const recovery = host.querySelector('[data-chfeed-id="7"]');
  await flush();
  assert.equal(host.querySelector('[data-chfeed-id="12"]'), bench, "an unchanged row keeps its node");
  assert.equal(host.querySelector('[data-chfeed-id="7"]'), recovery);
  assert.equal(host.querySelector('[data-chfeed-id="11"] .chfeed-status').textContent, "Lands Tuesday");
  const arrived = host.querySelector('[data-chfeed-id="5"]');
  assert.ok(arrived.classList.contains("settle-in"));
  assert.equal(arrived.closest(".chfeed-day").getAttribute("data-chfeed-day"), "2026-09-22");
});

test("a feed the person has left is never painted into", async () => {
  const win = load();
  const host = createHost(win.document);
  let release;
  const h = harness();
  h.deps.cachedApi = (_path, options) =>
    new Promise((resolve) => {
      release = () => {
        options.onUpgrade?.(feed(), { changed: true });
        resolve(feed());
      };
    });
  win.CairnChangesFeedController.mount(host, h.deps);
  host.remove();
  release();
  await flush();
  assert.equal(host.querySelector(".chfeed-row"), null);
  assert.equal(h.calls.filter((c) => c.method === "POST").length, 0, "a feed that never showed is not marked seen");
});

test("the teardown removes the listener and stops pending paints", async () => {
  const win = load();
  const host = createHost(win.document);
  const h = harness({ peek: { ...feed(), since_seen: 0 }, reads: [{ ...feed(), since_seen: 0 }] });
  const teardown = win.CairnChangesFeedController.mount(host, h.deps);
  teardown();
  await host.querySelector("[data-chfeed-undo]").click();
  await flush();
  assert.equal(h.calls.filter((c) => c.path.endsWith("/revert")).length, 0);
});

test("a long why folds to three lines behind Read all; the row leads with the digest's arrow", () => {
  const win = load();
  const long = "The last three sessions ".repeat(10).trim();
  const host = renderHtml(
    win.CairnChangesFeed.rowHtml(change({ id: 5, title: "Raised your Bench Press target", why: long })),
    { document: win.document }
  );
  const why = host.querySelector(".chfeed-why");
  assert.equal(why.textContent, long, "the full text stays in the node");
  assert.ok(why.classList.contains("is-folded"));
  assert.equal(host.querySelector("[data-chfeed-more]").textContent, "Read all");
  assert.equal(host.querySelector(".chfeed-arrow").textContent, "↑");
  const short = renderHtml(win.CairnChangesFeed.rowHtml(change({ id: 6, title: "Lowered your Row target", why: "Short." })), {
    document: win.document,
  });
  assert.ok(!short.querySelector(".chfeed-why").classList.contains("is-folded"));
  assert.equal(short.querySelector("[data-chfeed-more]"), null);
  assert.equal(short.querySelector(".chfeed-arrow").textContent, "↓");
});

test("a revalidate repaints the set-aside lines only when the server's list moved", async () => {
  const win = load();
  const host = createHost(win.document);
  const warm = { ...feed(), since_seen: 0, set_aside: SET_ASIDE };
  const fresh = clone(warm);
  fresh.days[0].changes[1].status_line = "Lands Tuesday";
  fresh.set_aside = [
    ...SET_ASIDE,
    { id: 91, day: "2026-09-23", label: "Wednesday", line: "An older draft for your plan was set aside: it waited too long to still fit." },
  ];
  const h = harness({ peek: warm, fresh: false, reads: [fresh] });
  win.CairnChangesFeedController.mount(host, h.deps);
  const bench = host.querySelector('[data-chfeed-id="12"]');
  assert.equal(host.querySelectorAll(".chfeed-aside-row").length, 1);
  await flush();
  assert.equal(host.querySelector('[data-chfeed-id="12"]'), bench, "the changes are patched in place");
  const rows = host.querySelectorAll(".chfeed-aside-row");
  assert.equal(rows.length, 2);
  assert.equal(host.querySelectorAll(".chfeed-aside").length, 1, "one group, replaced, never stacked");
  assert.equal(host.querySelector(".chfeed").lastElementChild, host.querySelector(".chfeed-aside"));
});

test("a swap leads with its own glyph; a title with no readable verb carries no empty arrow circle", () => {
  const win = load();
  const swap = renderHtml(win.CairnChangesFeed.rowHtml(change({ id: 7, title: "Swapped Cable Lateral Raise for Upright Row" })), {
    document: win.document,
  });
  assert.equal(swap.querySelector(".chfeed-arrow").textContent, "⇄");
  const plain = renderHtml(win.CairnChangesFeed.rowHtml(change({ id: 8, title: "Your plan now has a test week" })), {
    document: win.document,
  });
  assert.equal(plain.querySelector(".chfeed-arrow"), null);
});
