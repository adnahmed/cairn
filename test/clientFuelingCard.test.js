import { test } from "node:test";
import assert from "node:assert/strict";
import { createHost, loadClientModule } from "./_dom.mjs";

// The fueling follow-up card is an AGENDA rail card: the loader hydrates #fuelingSlot with
// the actual 1-tap interaction inline (three options that POST to /nutrition/fueling-feedback
// and melt into a quiet acknowledgement — never a link to another screen). This drives the
// compiled loader against the shared DOM harness (test/_dom.mjs), so the acceptance behavior is
// a real regression guard, not a code read.

function loadRailLoaders() {
  const win = loadClientModule("today-rail-loaders-client");
  return { loaders: win.CairnTodayRailLoaders, document: win.document };
}

function makeDeps(document, { due }) {
  const root = createHost(document, { html: `<div id="fuelingSlot"></div>` });
  const slot = root.querySelector("#fuelingSlot");
  const calls = [];
  const toasts = [];
  const nav = { count: 0 };
  const deps = {
    root,
    state: { tab: "today", logDate: "2026-07-13" },
    api: async (path, opts) => {
      calls.push({ path, opts });
      if (path === "/nutrition/fueling-followup") return { due, recent: [] };
      if (path === "/nutrition/fueling-feedback") return { date: "2026-07-13", energy: JSON.parse(opts.body).energy };
      return null;
    },
    activateTab: () => {
      nav.count += 1;
    },
    gotoChatWith: () => {
      nav.count += 1;
    },
    toast: (message) => toasts.push(message),
    escapeHtml: (value) => String(value ?? ""),
    invalidate: () => {},
    refreshToday: async () => {},
    runCountUps: () => {},
  };
  return { deps, slot, calls, toasts, nav };
}

test("the fueling card renders three inline options when due", async () => {
  const { loaders, document } = loadRailLoaders();
  const { deps, slot } = makeDeps(document, { due: true });
  await loaders.loadFuelingFollowup(deps);
  assert.match(slot.innerHTML, /How's fueling feeling\?/);
  assert.equal(slot.querySelectorAll(".fueling-opt").length, 3);
  assert.ok(slot.querySelector("#fuelingSkip"), "carries a skip control");
});

test("tapping an option posts the read inline and melts into a quiet acknowledgement", async () => {
  const { loaders, document } = loadRailLoaders();
  const { deps, slot, calls, nav } = makeDeps(document, { due: true });
  await loaders.loadFuelingFollowup(deps);
  await slot.querySelectorAll(".fueling-opt")[0].click(); // "Running low" = energy 1

  const post = calls.find((c) => c.path === "/nutrition/fueling-feedback");
  assert.ok(post, "posts to the fueling-feedback endpoint");
  assert.equal(post.opts.method, "POST");
  assert.deepEqual(JSON.parse(post.opts.body), { energy: 1 });
  assert.match(slot.innerHTML, /fueling-done/, "melts into the acknowledgement in place");
  assert.match(slot.innerHTML, /Noted/);
  assert.equal(nav.count, 0, "the interaction is fully inline — never a link to another screen");
});

test("the card renders nothing when not due", async () => {
  const { loaders, document } = loadRailLoaders();
  const { deps, slot } = makeDeps(document, { due: false });
  await loaders.loadFuelingFollowup(deps);
  assert.equal(slot.innerHTML, "", "answered/not-due → the slot stays empty");
});

test("the skip control hides the card without logging anything", async () => {
  const { loaders, document } = loadRailLoaders();
  const { deps, slot, calls } = makeDeps(document, { due: true });
  await loaders.loadFuelingFollowup(deps);
  await slot.querySelector("#fuelingSkip").click();
  assert.equal(slot.innerHTML, "", "the ✕ hides the card for this render");
  assert.equal(calls.filter((c) => c.path === "/nutrition/fueling-feedback").length, 0, "skip never posts");
});
