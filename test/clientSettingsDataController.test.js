import { test } from "node:test";
import assert from "node:assert/strict";
import { createHost, loadClientModule } from "./_dom.mjs";

function loadSettingsDataController() {
  const calls = [];
  const win = loadClientModule("settings-data-controller", {
    globals: {
      CairnSettingsData: {
        phoneAccessCardHtml: ({ inStandaloneApp } = {}) => (inStandaloneApp ? "" : "<details id=\"phone\"></details>"),
        wirePhoneAccessCard: (options = {}) => calls.push(["wirePhoneAccessCard", typeof options.api, typeof options.toast]),
        wireExerciseGuideCard: (options = {}) =>
          calls.push(["wireExerciseGuideCard", typeof options.api, typeof options.toast]),
      },
    },
  });
  return { controller: win.CairnSettingsDataController, calls, document: win.document };
}

test("settings data controller owns update, export, and setup wiring", async () => {
  const { controller, calls, document } = loadSettingsDataController();
  const wm = { update_check_enabled: true };
  const rootEl = createHost(document, { id: "root" });
  const apiCalls = [];
  const downloads = [];
  let dirty = 0;
  let reloaded = false;
  const statuses = {
    "/update-status": { latest: "0.8.0" },
    "/update-check": { latest: "0.9.0" },
  };

  controller.render({
    root: rootEl,
    workingModel: wm,
    inStandaloneApp: false,
    api: async (path, opts) => {
      apiCalls.push([path, opts?.method || "GET", opts?.body || ""]);
      return statuses[path] || { ok: true };
    },
    toast: () => {},
    markDirty: () => { dirty += 1; },
    updateCardHtml: (status) => `card:${status?.latest || "none"}:${wm.update_check_enabled}`,
    withToken: (path) => `${path}?token=t`,
    downloadFile: (path) => downloads.push(path),
    reload: () => { reloaded = true; },
  });

  assert.match(rootEl.innerHTML, /Data &amp; backup/);
  assert.deepEqual(calls, [
    ["wirePhoneAccessCard", "function", "function"],
    ["wireExerciseGuideCard", "function", "function"],
  ]);
  assert.equal(rootEl.querySelector("#updateCard").innerHTML, "card:none:true");

  await Promise.resolve();
  assert.equal(rootEl.querySelector("#updateCard").innerHTML, "card:0.8.0:true");
  assert.deepEqual(apiCalls[0], ["/update-status", "GET", ""]);

  await rootEl.querySelector("#updateCheckEnabled").click(); // checked -> unchecked, fires change
  assert.equal(wm.update_check_enabled, false);
  assert.equal(dirty, 1);
  assert.equal(rootEl.querySelector("#updateCheckNow").style.display, "none");
  assert.equal(rootEl.querySelector("#updateCard").innerHTML, "card:0.8.0:false");

  await rootEl.querySelector("#updateCheckNow").click();
  assert.equal(rootEl.querySelector("#updateCard").innerHTML, "card:0.9.0:false");
  assert.equal(rootEl.querySelector("#updateCheckNow").textContent, "Check now");

  await rootEl.querySelector("#dlJson").click();
  await rootEl.querySelector("#dlDb").click();
  assert.deepEqual(downloads, ["/api/export?token=t", "/api/export/db?token=t"]);

  await rootEl.querySelector("#rerunSetup").click();
  assert.deepEqual(apiCalls.at(-1), ["/settings", "PUT", JSON.stringify({ onboarded: false })]);
  assert.equal(reloaded, true);
});
