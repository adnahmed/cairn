// Ask's speaker line (chat-speaker-client.ts): a team reply names the stone it acted
// on — a meal is Fuel, a set or plan change is Strength — else the Team as one voice.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadClientModule, renderHtml } from "./_dom.mjs";

const load = () => loadClientModule(["html-utils", "chat-speaker-client"]);

test("the speaker follows what the turn applied, and defaults to the team", () => {
  const win = load();
  const s = win.CairnChatSpeaker;
  assert.deepEqual({ ...s.speaker([{ type: "log_food" }], []) }, { stone: "fuel", name: "Fuel" });
  assert.deepEqual({ ...s.speaker([{ type: "log_set" }], []) }, { stone: "strength", name: "Strength" });
  assert.deepEqual({ ...s.speaker([], [{ id: 1 }]) }, { stone: "strength", name: "Strength" });
  assert.deepEqual({ ...s.speaker([{ type: "add_memory" }], []) }, { stone: "", name: "Team" });
});

test("the line is a stone dot and a name, and never a number", () => {
  const win = load();
  const host = renderHtml(win.CairnChatSpeaker.forTurn([{ type: "log_weight" }], []), { document: win.document });
  assert.equal(host.querySelector(".bubble-who").textContent, "Body");
  assert.ok(host.querySelector(".dot").classList.contains("stone-body"));
  const team = renderHtml(win.CairnChatSpeaker.forTurn([], []), { document: win.document });
  assert.ok(team.querySelector(".dot").classList.contains("is-team"));
});
