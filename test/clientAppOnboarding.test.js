// First-run onboarding (src/client/app/onboarding.ts). The welcome sheet runs on
// the shared overlay primitive (CairnUiSheet), so these drive the built modules
// against the DOM harness.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadClientModule } from "./_dom.mjs";

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadOnboarding(apiHandler = async () => ({ settings: { onboarded: true, art_enabled: true } })) {
  const calls = [];
  const state = {
    day: 7,
    dayPicked: true,
    plan: [{ day_number: 1 }],
    tab: "plan",
  };
  const win = loadClientModule(["html-utils", "ui-components", "ui-sheet", "app-onboarding"], {
    globals: {
      api: async (path, opts) => {
        calls.push(["api", path, opts?.method || "GET", opts?.body || ""]);
        return apiHandler(path, opts);
      },
      artEnabled: true,
      hideSaveBar: () => calls.push(["hideSaveBar"]),
      reducedMotion: () => false,
      renderToday: () => calls.push(["renderToday"]),
      setDiscipline: (discipline) => calls.push(["setDiscipline", discipline]),
      setTimeout: (fn, ms) => {
        calls.push(["setTimeout", ms]);
        fn();
        return 0;
      },
      clearTimeout: () => {},
      state,
      swrInvalidate: (key) => calls.push(["swrInvalidate", key]),
      thinkingCaption: (el, op) => calls.push(["thinkingCaption", el.className, op]),
      toast: (message) => calls.push(["toast", message]),
    },
  });
  const doc = win.document;
  doc.body.innerHTML = `<nav><button class="tab" data-tab="today">Today</button><button class="tab active" data-tab="plan">Plan</button></nav>`;
  const q = (selector) => doc.querySelector(selector);
  return { calls, context: win, doc, q, state };
}

test("onboarding opens first-run modal and refreshes art setting", async () => {
  const env = loadOnboarding(async () => ({ settings: { onboarded: false, art_enabled: false } }));

  assert.equal(typeof env.context.maybeOnboard, "function");
  assert.equal(typeof env.context.window.maybeOnboard, "function");
  await env.context.maybeOnboard();

  assert.equal(env.context.artEnabled, false);
  const card = env.q(".modal .modal-card");
  assert.ok(card, "the welcome sheet is open");
  assert.equal(card.getAttribute("role"), "dialog");
  assert.equal(card.getAttribute("aria-modal"), "true");
  assert.equal(card.getAttribute("aria-labelledby"), "obTitle");
  assert.equal(env.doc.activeElement.id, "obAge");
});

test("onboarding is not dismissed by Escape or a backdrop tap", async () => {
  const env = loadOnboarding();
  env.context.openOnboarding();
  await env.doc.activeElement.dispatchEvent(new env.context.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await env.q(".modal").click();
  assert.ok(env.q(".modal .modal-card"), "Skip is the way out");
});

test("onboarding skip persists the structured discipline and enters Today cleanly", async () => {
  const env = loadOnboarding();
  env.context.openOnboarding();
  await env.q('#obDisc [data-disc="endurance"]').click();
  await env.q("#obSkip").click();

  assert.deepEqual(plain(env.calls.filter(([kind]) => kind === "api")), [
    ["api", "/profile", "PUT", JSON.stringify({ primary_discipline: "endurance" })],
    ["api", "/settings", "PUT", JSON.stringify({ onboarded: true })],
  ]);
  assert.equal(env.state.tab, "today");
  assert.deepEqual(plain(env.state.plan), []);
  assert.equal(env.state.day, null);
  assert.equal(env.state.dayPicked, false);
  assert.ok(env.calls.some(([kind]) => kind === "hideSaveBar"));
  assert.ok(env.calls.some(([kind]) => kind === "renderToday"));
  assert.equal(env.q(".modal"), null, "the welcome sheet is gone");
  assert.equal(env.q(".tab.active")?.dataset.tab, "today");
});

test("onboarding start composes the intro and shows calm progress", async () => {
  const env = loadOnboarding();
  env.context.openOnboarding();
  env.q("#obSex").value = "female";
  env.q("#obAge").value = "42";
  env.q("#obGoal").value = "build muscle";
  env.q("#obIntro").value = "Vegetarian, sore left ankle.";
  await env.q('#obDays [data-dpw="6"]').click();
  await env.q('#obDisc [data-disc="hybrid"]').click();
  const start = env.q("#obStart");
  await start.click();

  const onboard = env.calls.find((call) => call[0] === "api" && call[1] === "/onboard");
  assert.ok(onboard, "onboard call is made");
  assert.deepEqual(JSON.parse(onboard[3]), {
    text: "My sex is female. I'm 42. I train about 6 days a week. I train both strength and endurance (hybrid). My main goal is to build muscle. Vegetarian, sore left ankle.",
  });
  const profile = env.calls.find((call) => call[0] === "api" && call[1] === "/profile");
  assert.deepEqual(JSON.parse(profile[3]), { primary_discipline: "hybrid", sex: "female" });
  assert.equal(start.disabled, true);
  assert.equal(start.textContent, "GETTING TO KNOW YOU…");
  assert.ok(env.calls.some(([kind]) => kind === "thinkingCaption"));
  assert.ok(env.calls.some((call) => call[0] === "toast" && call[1] === "You're all set"));
});

test("onboarding requires sex before analysis-oriented setup", async () => {
  const env = loadOnboarding();
  env.context.openOnboarding();
  await env.q("#obStart").click();

  assert.equal(env.q("#obStatus").textContent, "Choose sex so Cairn can use the right health ranges.");
  assert.equal(env.doc.activeElement.id, "obSex");
  assert.equal(
    env.calls.some((call) => call[0] === "api" && call[1] === "/onboard"),
    false
  );
});
