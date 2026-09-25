import { test } from "node:test";
import assert from "node:assert/strict";
import { createHost, loadClientModule } from "./_dom.mjs";

function loadController(overrides = {}) {
  const renderCalls = [];
  const win = loadClientModule("health-risk-controller", {
    globals: {
      CairnHealthRisk: {
        renderCardiovascularRiskHtml: (data) => {
          renderCalls.push(data);
          // installs a fake sharpen affordance so the controller's click wiring is exercised
          return `<section class="hrisk">rendered:${data ? "ok" : "null"}<button data-risk-sharpen>sharpen</button></section>`;
        },
      },
      ...overrides,
    },
  });
  return { controller: win.CairnHealthRiskController, renderCalls, document: win.document };
}

// The Stand screen's root with its #hRisk slot, attached to the document.
function mountRoot(document) {
  const rootEl = createHost(document, { id: "root", html: `<div id="hRisk"></div>` });
  return { rootEl, riskSlot: rootEl.querySelector("#hRisk") };
}

function depsFor(root, options = {}) {
  const apiCalls = [];
  const activated = [];
  const state = options.state || {};
  const deps = {
    root,
    state,
    api:
      options.api ||
      ((path) => {
        apiCalls.push(path);
        return Promise.resolve(options.response ?? { ok: true });
      }),
    activateTab: (tab) => activated.push(tab),
    pollToken: () => options.pollToken ?? 1,
    select: (selector) => root.querySelector(selector),
    ...(options.onSharpen ? { onSharpen: options.onSharpen } : {}),
  };
  return { deps, apiCalls, activated, state };
}

test("health risk controller fetches /health/risk and paints the card into #hRisk", async () => {
  const { controller, renderCalls, document } = loadController();
  const { rootEl, riskSlot } = mountRoot(document);
  const { deps, apiCalls } = depsFor(rootEl, { response: { model_status: { prevent: "computed" } } });

  controller.load(deps, 1);
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(apiCalls, ["/health/risk"]);
  assert.equal(renderCalls.length, 1);
  assert.match(riskSlot.innerHTML, /rendered:ok/);
});

test("health risk controller drops a stale response when pollToken has advanced", async () => {
  const { controller, renderCalls, document } = loadController();
  const { rootEl, riskSlot } = mountRoot(document);
  const { deps } = depsFor(rootEl, { pollToken: 2 }); // load() is called with the stale token 1

  controller.load(deps, 1);
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(renderCalls.length, 0);
  assert.equal(riskSlot.innerHTML, "");
});

test("health risk controller degrades to the calm empty state on fetch failure", async () => {
  const { controller, renderCalls, document } = loadController();
  const { rootEl, riskSlot } = mountRoot(document);
  const { deps } = depsFor(rootEl, { api: () => Promise.reject(new Error("network down")) });

  controller.load(deps, 1);
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(renderCalls.length, 1);
  assert.equal(renderCalls[0], null);
  assert.match(riskSlot.innerHTML, /rendered:null/);
});

test("health risk controller wires the provisional-read Profile nudge", () => {
  const { controller, document } = loadController();
  const { rootEl, riskSlot } = mountRoot(document);
  const { deps, activated, state } = depsFor(rootEl);

  controller.render({ model_status: { prevent: "computed_provisional" } }, deps);
  riskSlot.querySelector("[data-risk-sharpen]").click();

  assert.equal(state.meSeg, "profile");
  assert.deepEqual(activated, ["me"]);
});

test("health risk controller prefers an in-place onSharpen handler over the Profile jump", () => {
  const { controller, document } = loadController();
  const { rootEl, riskSlot } = mountRoot(document);
  let sharpened = 0;
  const { deps, activated, state } = depsFor(rootEl, { onSharpen: () => { sharpened += 1; } });

  controller.render({ model_status: { prevent: "computed_provisional" } }, deps);
  riskSlot.querySelector("[data-risk-sharpen]").click();

  assert.equal(sharpened, 1);
  assert.equal(state.meSeg, undefined); // did NOT fall back to the tab jump
  assert.deepEqual(activated, []);
});
