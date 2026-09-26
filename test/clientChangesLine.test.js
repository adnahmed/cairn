// The Today changes line (changes-line-client.ts + changes-line-controller.ts, mounted by
// CairnTodayRailController.mountChangesLine): one quiet line built from the server's
// count, hidden at zero, painted from SWR, and a tap that opens the Changes feed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHost, flush, loadClientModule, renderHtml } from "./_dom.mjs";

function load(globals = {}) {
  return loadClientModule(["html-utils", "ui-actions-client", "changes-line-client", "changes-line-controller"], {
    globals,
  });
}

function change(id, isNew, day = "2026-09-25") {
  return { id, day, state: "applied", title: `Change ${id}`, new: isNew };
}

function read({ count = 2, line = "2 changes overnight", rows, through = "2026-09-25T07:00:00.000Z" } = {}) {
  const changes = rows ?? [change(11, true), change(12, true), change(9, false)];
  return {
    as_of: "2026-09-25",
    days: [{ day: "2026-09-25", label: "Today", changes }],
    since_seen: count,
    since_seen_line: count > 0 ? line : null,
    seen_at: null,
    seen_through: through,
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function recorder({ warm = null, respond = () => Promise.resolve(read()), reduced = false } = {}) {
  const loads = [];
  const peeks = [];
  let opens = 0;
  return {
    loads,
    peeks,
    get opens() {
      return opens;
    },
    deps: {
      peek: (key) => {
        peeks.push(key);
        return warm ? { data: warm, fresh: false } : null;
      },
      load: (path, options) => {
        loads.push({ path, key: options?.key });
        return respond(path);
      },
      open: () => opens++,
      reducedMotion: () => reduced,
    },
  };
}

// ---------- renderer ----------

test("the model is the server's count and sentence, and nothing at zero", () => {
  const win = load();
  const model = win.CairnChangesLine.model(read());
  assert.equal(model.count, 2);
  assert.equal(model.line, "2 changes overnight");
  assert.deepEqual([...model.ids], [11, 12], "only the rows the server marked new");
  assert.equal(win.CairnChangesLine.model(read({ count: 0 })), null, "zero hides the line");
  assert.equal(win.CairnChangesLine.model({ since_seen: 3, since_seen_line: "  " }), null, "no sentence, no line");
  assert.equal(win.CairnChangesLine.model(null), null);
  assert.equal(win.CairnChangesLine.model({ since_seen: "x", since_seen_line: "1 change" }), null);
});

test("the line is one button that prints the server sentence verbatim, escaped", () => {
  const win = load();
  const model = win.CairnChangesLine.model(read({ line: "2 changes <b>overnight</b>" }));
  const host = renderHtml(win.CairnChangesLine.html(model), { document: win.document });
  const button = host.querySelector("button.changes-line");
  assert.equal(button.getAttribute("type"), "button");
  assert.equal(button.hasAttribute("data-changes-line-open"), true);
  assert.equal(host.querySelector(".changes-line-text").textContent, "2 changes <b>overnight</b>");
  assert.equal(host.querySelector("b"), null, "hostile text stays text");
  assert.equal(button.getAttribute("aria-label"), "2 changes <b>overnight</b>. Open Changes");
  assert.equal(host.querySelector(".changes-line-mark").getAttribute("aria-hidden"), "true");
  assert.equal(button.classList.contains("settle-in"), false, "no entrance unless asked");
  assert.equal(win.CairnChangesLine.html(null), "");
  const entering = renderHtml(win.CairnChangesLine.html(model, { enter: true }), { document: win.document });
  assert.equal(entering.querySelector("button").classList.contains("settle-in"), true);
});

// ---------- controller ----------

test("a warm cache paints at once, and an unchanged revalidation never repaints", async () => {
  const win = load();
  const host = createHost(win.document);
  const rec = recorder({ warm: read() });
  win.CairnChangesLineController.mount(host, rec.deps);
  const painted = host.querySelector("button.changes-line");
  assert.ok(painted, "painted synchronously from the cache");
  assert.equal(painted.classList.contains("settle-in"), false, "a warm paint never animates in");
  assert.deepEqual(rec.peeks, ["brain:changes"]);
  assert.deepEqual(rec.loads, [{ path: "/brain/changes", key: "brain:changes" }], "the feed's own read and key");
  await flush();
  assert.equal(host.querySelector("button.changes-line"), painted, "the same node: nothing re-rendered");
});

test("a cold mount waits for the read, then settles the line in once", async () => {
  const win = load();
  const host = createHost(win.document);
  const gate = deferred();
  const rec = recorder({ respond: () => gate.promise });
  win.CairnChangesLineController.mount(host, rec.deps);
  assert.equal(host.innerHTML, "", "nothing before the server answers");
  gate.resolve(read({ count: 1, line: "1 change since you last looked", rows: [change(4, true)] }));
  await flush();
  const button = host.querySelector("button.changes-line");
  assert.equal(button.textContent.includes("1 change since you last looked"), true);
  assert.equal(button.classList.contains("settle-in"), true);
});

test("reduced motion paints the line with no entrance", async () => {
  const win = load();
  const host = createHost(win.document);
  win.CairnChangesLineController.mount(host, recorder({ reduced: true }).deps);
  await flush();
  assert.equal(host.querySelector("button.changes-line").classList.contains("settle-in"), false);
});

test("zero hides the line, including when the revalidation drops a cached count", async () => {
  const win = load();
  const host = createHost(win.document);
  win.CairnChangesLineController.mount(host, recorder({ respond: () => Promise.resolve(read({ count: 0 })) }).deps);
  await flush();
  assert.equal(host.innerHTML, "");

  const warmHost = createHost(win.document);
  win.CairnChangesLineController.mount(
    warmHost,
    recorder({ warm: read(), respond: () => Promise.resolve(read({ count: 0, rows: [change(9, false)] })) }).deps
  );
  assert.ok(warmHost.querySelector("button.changes-line"));
  await flush();
  assert.equal(warmHost.innerHTML, "", "the server's zero wins over the cached two");
});

test("a failed read with nothing cached leaves the slot empty, never an error", async () => {
  const win = load();
  const host = createHost(win.document);
  win.CairnChangesLineController.mount(host, recorder({ respond: () => Promise.reject(new Error("offline")) }).deps);
  await flush();
  assert.equal(host.innerHTML, "");
});

test("one tap opens the feed once, even after a second mount on the same host", async () => {
  const win = load();
  const host = createHost(win.document);
  const rec = recorder({ warm: read() });
  win.CairnChangesLineController.mount(host, rec.deps);
  win.CairnChangesLineController.mount(host, rec.deps);
  await flush();
  await host.querySelector("[data-changes-line-open]").click();
  assert.equal(rec.opens, 1);
  assert.equal(host.innerHTML, "", "the line leaves with the tap");
});

test("news the athlete already opened stays quiet on a stale cache; new news shows", async () => {
  const win = load();
  const first = createHost(win.document);
  win.CairnChangesLineController.mount(first, recorder({ warm: read() }).deps);
  await flush();
  await first.querySelector("[data-changes-line-open]").click();

  // Back on Today before the cache has caught up with the feed's seen marker.
  const stale = createHost(win.document);
  win.CairnChangesLineController.mount(stale, recorder({ warm: read(), respond: () => Promise.resolve(read()) }).deps);
  await flush();
  assert.equal(stale.innerHTML, "", "the same two changes are not announced twice");

  const fresh = createHost(win.document);
  const next = read({ count: 1, line: "1 change since you last looked", rows: [change(13, true), change(11, false)] });
  win.CairnChangesLineController.mount(fresh, recorder({ warm: read(), respond: () => Promise.resolve(next) }).deps);
  await flush();
  assert.equal(fresh.querySelector(".changes-line-text").textContent, "1 change since you last looked");
});

test("a read that lands after the person left writes nothing", async () => {
  const win = load();
  const host = createHost(win.document);
  const gate = deferred();
  win.CairnChangesLineController.mount(host, recorder({ respond: () => gate.promise }).deps);
  host.remove();
  gate.resolve(read());
  await flush();
  assert.equal(host.innerHTML, "");

  const torn = createHost(win.document);
  const later = deferred();
  const teardown = win.CairnChangesLineController.mount(torn, recorder({ respond: () => later.promise }).deps);
  teardown();
  later.resolve(read());
  await flush();
  assert.equal(torn.innerHTML, "", "a torn-down mount never paints");
});

// ---------- the Today composition ----------

function loadRail({ warm = null, respond = () => Promise.resolve(read()) } = {}) {
  const calls = { loads: [] };
  const win = loadClientModule(
    ["html-utils", "ui-actions-client", "changes-line-client", "changes-line-controller", "today-rail-controller"],
    {
      globals: {
        peekCached: () => (warm ? { data: warm, fresh: false } : null),
        cachedApi: (path, options) => {
          calls.loads.push({ path, key: options?.key });
          return respond(path);
        },
        reducedMotion: () => false,
      },
    }
  );
  return { win, calls };
}

test("Today mounts the line directly under the Brief, and a tap opens Plan › Changes", async () => {
  const { win, calls } = loadRail({ warm: read() });
  const view = createHost(win.document, {
    html: `<div class="today-main"><section class="brief"></section><div class="cfocus-slot" id="cfocusSlot"></div><div id="attentionLead"></div></div>`,
  });
  const tabs = [];
  const deps = { state: { logDate: "2026-09-25", planJump: null }, activateTab: (tab) => tabs.push(tab) };
  win.CairnTodayRailController.mountChangesLine(view, deps);
  const main = view.querySelector(".today-main");
  const slot = view.querySelector("#changesLineSlot");
  assert.ok(slot, "the slot is made on first mount");
  assert.equal(main.children[1], slot, "after the Brief, before the conductor");
  assert.equal(main.children[2].id, "cfocusSlot");
  assert.deepEqual(calls.loads, [{ path: "/brain/changes", key: "brain:changes" }]);

  // A second mount (a soft repaint that kept the column) reuses the slot.
  win.CairnTodayRailController.mountChangesLine(view, deps);
  assert.equal(view.querySelectorAll("#changesLineSlot").length, 1);
  await flush();

  await slot.querySelector("[data-changes-line-open]").click();
  assert.equal(deps.state.planJump, "coach");
  assert.deepEqual(tabs, ["plan"]);
});

test("Today without a Brief column mounts nothing", () => {
  const { win, calls } = loadRail();
  const view = createHost(win.document, { html: `<div class="today-main"></div>` });
  const teardown = win.CairnTodayRailController.mountChangesLine(view, {
    state: { logDate: "2026-09-25" },
    activateTab() {},
  });
  assert.equal(typeof teardown, "function");
  assert.equal(view.querySelector("#changesLineSlot"), null);
  assert.equal(calls.loads.length, 0);
});
