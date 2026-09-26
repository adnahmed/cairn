// Fuel — "Log food" (fuel-log-client/-controller.ts, docs/V2-PLAN.md wave 2). One
// button opens the ONE food composer (stream C's component) under it in food mode; a
// meal logged there comes back through onLogged without leaving the screen, and the
// panel closes. "Start from this" fills the composer for editing and never sends.
// The last test runs the real composer end to end on the shared DOM harness.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createFakeTimers, createHost, flush, loadClientModule } from "./_dom.mjs";

function load(extra = [], globals = {}) {
  return loadClientModule(["html-utils", "ui-actions-client", ...extra, "fuel-log-client", "fuel-log-controller"], {
    globals,
  });
}

function fakeComposer() {
  const mounts = [];
  const mountComposer = (host, deps) => {
    host.innerHTML = `<textarea id="${deps.idPrefix}Input"></textarea>`;
    const record = { host, deps, fills: [], torn: 0 };
    mounts.push(record);
    const handle = () => {
      record.torn++;
    };
    handle.fill = (text) => {
      record.fills.push(text);
      host.querySelector("textarea").value = text;
    };
    handle.send = async () => {};
    handle.clearAttachment = () => {};
    return handle;
  };
  return { mounts, mountComposer };
}

function mount(win, overrides = {}) {
  const composer = fakeComposer();
  const logged = [];
  const host = createHost(win.document);
  const handle = win.CairnFuelLogController.mount(host, {
    mountComposer: composer.mountComposer,
    api: async () => null,
    toast: () => {},
    reducedMotion: () => true,
    onLogged: (x) => logged.push(x),
    ...overrides,
  });
  return { host, handle, composer, logged };
}

test("the Log button is a real 44px-class button that opens the composer in food mode", async () => {
  const win = load();
  const { host, composer } = mount(win);
  const btn = host.querySelector("[data-fuel-log-toggle]");
  assert.equal(btn.getAttribute("type"), "button");
  assert.equal(btn.getAttribute("aria-label"), "Log food");
  assert.equal(btn.getAttribute("aria-expanded"), "false");
  assert.equal(composer.mounts.length, 0, "the composer mounts on first open, not before");
  await btn.click();
  assert.equal(btn.getAttribute("aria-expanded"), "true");
  assert.ok(host.querySelector(".fuel-log").classList.contains("is-open"));
  assert.equal(composer.mounts.length, 1);
  assert.equal(composer.mounts[0].deps.mode, "food");
  assert.equal(composer.mounts[0].deps.idPrefix, "fuelLog");
  assert.equal(win.document.activeElement, host.querySelector("textarea"), "the athlete can type at once");
  await btn.click();
  assert.equal(btn.getAttribute("aria-expanded"), "false");
  await btn.click();
  assert.equal(composer.mounts.length, 1, "closing hides the composer; it is not remounted");
});

test("Start from this fills the composer for editing and never sends", () => {
  const win = load();
  const { host, handle, composer } = mount(win);
  handle.open("Greek yogurt (a half portion)");
  assert.equal(host.querySelector("[data-fuel-log-toggle]").getAttribute("aria-expanded"), "true");
  assert.deepEqual(composer.mounts[0].fills, ["Greek yogurt (a half portion)"]);
  assert.equal(host.querySelector("textarea").value, "Greek yogurt (a half portion)");
});

test("a logged meal is handed back and the panel closes; the composer lives until teardown", () => {
  const win = load();
  const { host, handle, composer, logged } = mount(win);
  handle.open();
  composer.mounts[0].deps.onLogged({ turnId: 1, notes: [{ id: 9 }], reply: null });
  assert.equal(logged.length, 1);
  assert.equal(host.querySelector("[data-fuel-log-toggle]").getAttribute("aria-expanded"), "false");
  assert.equal(composer.mounts[0].torn, 0, "a send still being followed is never cut off by closing");
  handle();
  assert.equal(composer.mounts[0].torn, 1);
  host.remove();
  composer.mounts[0].deps.onLogged({ turnId: 2, notes: [], reply: null });
  assert.equal(logged.length, 1, "nothing reaches a surface the athlete has left");
});

test("mounting twice on one host leaves one listener", async () => {
  const win = load();
  const composer = fakeComposer();
  const host = createHost(win.document);
  const deps = {
    mountComposer: composer.mountComposer,
    api: async () => null,
    toast: () => {},
    reducedMotion: () => true,
    onLogged: () => {},
  };
  win.CairnFuelLogController.mount(host, deps);
  win.CairnFuelLogController.mount(host, deps);
  const btn = host.querySelector("[data-fuel-log-toggle]");
  await btn.click();
  assert.equal(btn.getAttribute("aria-expanded"), "true", "one tap opens (a second listener would close it again)");
});

test("end to end: a multi-line meal sent from Fuel logs without leaving the screen", async () => {
  const win = load(
    [
      "chat-composer-focus-client",
      "food-composer-model",
      "food-composer-client",
      "food-composer-chips-controller",
      "food-composer-turn-controller",
      "food-composer-controller",
    ],
    {
      matchMedia: () => ({ matches: false }),
      ...createFakeTimers(),
      requestAnimationFrame: () => 0,
      cancelAnimationFrame: () => {},
      crypto: { randomUUID: () => "request-1" },
      CairnChatAttachment: {
        compressImage: async () => null,
        previewImage: (el) => el ?? null,
        resetFocusAfterNativePicker() {},
        settleAfterNativePicker() {},
      },
    }
  );
  const posts = [];
  const api = async (path, opts = {}) => {
    if (path === "/chat" && opts.method === "POST") {
      posts.push(JSON.parse(opts.body));
      return {
        ok: true,
        turn: {
          id: 11,
          status: "done",
          meta: { applied: [{ type: "log_food", result: { id: 88, meal: "lunch", enrichment_status: "done" } }] },
        },
      };
    }
    return null;
  };
  const logged = [];
  const toasts = [];
  const host = createHost(win.document);
  const handle = win.CairnFuelLogController.mount(host, {
    mountComposer: (h, deps) => win.CairnFoodComposer.mount(h, deps),
    api,
    toast: (m) => toasts.push(m),
    reducedMotion: () => true,
    onLogged: (x) => logged.push(x),
  });
  handle.open("chicken 200 g\nrice 150 g");
  const input = host.querySelector("#fuelLogInput");
  assert.equal(input.value, "chicken 200 g\nrice 150 g", "filled, not sent");
  assert.equal(posts.length, 0);
  await host.querySelector("#fuelLogSend").click();
  await flush();
  assert.equal(posts.length, 1);
  assert.equal(posts[0].capture, "food", "the send is marked as a food capture");
  assert.equal(posts[0].message, "chicken 200 g\nrice 150 g", "the athlete's words as typed");
  assert.equal(logged.length, 1);
  assert.deepEqual(
    [...logged[0].notes].map((n) => n.id),
    [88]
  );
  assert.equal(host.querySelector("[data-fuel-log-toggle]").getAttribute("aria-expanded"), "false");
  assert.equal(toasts.at(-1), "Logged your lunch");
});

test("Start from this keeps what the athlete already typed: the idea goes on a line below", () => {
  const win = load();
  const toasts = [];
  const { host, handle, composer } = mount(win, { toast: (m) => toasts.push(m) });
  handle.open();
  const input = host.querySelector("textarea");
  input.value = "eggs 3\ntoast 2 slices\n";
  handle.open("Greek yogurt (a half portion)");
  assert.equal(input.value, "eggs 3\ntoast 2 slices\nGreek yogurt (a half portion)");
  assert.deepEqual(toasts, ["Added below what you'd typed"]);
  handle.open("Greek yogurt (a half portion)");
  assert.equal(input.value, "eggs 3\ntoast 2 slices\nGreek yogurt (a half portion)", "never twice");
  assert.equal(composer.mounts.length, 1);
});

test("the Fuel composer carries a retry store, so a send lost to a reload replays once", () => {
  const win = load();
  const store = { loadRetry: () => null, saveRetry() {}, clearRetry() {} };
  const { handle, composer } = mount(win, { retryStore: store });
  handle.open();
  assert.equal(composer.mounts[0].deps.retryStore, store);
});

test("Fuel's retry store keeps a live envelope per viewer and drops an expired or broken one", () => {
  const win = loadClientModule(["fuel-deps"]);
  const store = win.CairnFuelDeps.retryStore();
  const later = Date.now() + 60_000;
  store.saveRetry({ requestId: "req-1", text: "chicken 200 g", hasImage: false, expiresAt: later });
  assert.equal(
    JSON.stringify(store.loadRetry()),
    JSON.stringify({ requestId: "req-1", text: "chicken 200 g", hasImage: false, expiresAt: later })
  );
  assert.equal(win.CairnFuelDeps.retryStore().loadRetry()?.requestId, "req-1", "survives a remount");
  store.clearRetry();
  assert.equal(store.loadRetry(), null);
  store.saveRetry({ requestId: "req-2", text: "rice", hasImage: false, expiresAt: Date.now() - 1 });
  assert.equal(store.loadRetry(), null, "an expired envelope never replays");
  win.localStorage.setItem("cairn.fuelLogRetry.v1", "{not json");
  assert.equal(store.loadRetry(), null);
  assert.equal(win.localStorage.getItem("cairn.fuelLogRetry.v1"), null, "a broken envelope is cleared");
  win.localStorage.getItem = () => {
    throw new Error("blocked");
  };
  assert.equal(store.loadRetry(), null, "blocked storage reads as no envelope");
});
