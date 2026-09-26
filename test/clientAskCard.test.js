// The ask card component (ask-card-client.ts + ask-card-controller.ts): what the team
// still has to ask — clinical, irreversible, or evidence it lacks — printed calmly from
// GET /api/brain/decisions/waiting, with one optional door into chat.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHost, flush, loadClientModule, renderHtml } from "./_dom.mjs";

function load() {
  return loadClientModule(["html-utils", "ui-actions-client", "ask-card-client", "ask-card-controller"]);
}

const WAITING = [
  {
    id: 4,
    kind: "training_structure",
    domain: "training",
    summary: "Move to four lifting days",
    explanation: "Your week has room for a fourth day, but it changes the shape of every week — your call.",
    status: "review",
    autonomy_tier: "ask",
    reversible: true,
    for_clinician: false,
  },
  {
    id: 5,
    kind: "case_conference",
    domain: "health",
    summary: "",
    explanation: "Your ApoB has stayed above the optimal band across two draws; worth raising at your next visit.",
    status: "observed",
    autonomy_tier: "clinician",
    reversible: false,
    for_clinician: true,
  },
  { id: 6, kind: "day_read", domain: "training", summary: "machine only", explanation: "", status: "review" },
];

test("asks and clinician notes render as calm, collapsed groups of cards", () => {
  const win = load();
  const host = renderHtml(win.CairnAskCard.asksHtml(WAITING), { document: win.document });
  const groups = host.querySelectorAll(".askcard-group");
  assert.deepEqual(
    groups.map((group) => group.querySelector("summary").textContent.trim()),
    ["Waiting on you (1)", "For you and your doctor (1)"]
  );
  assert.ok(
    groups.every((group) => !group.hasAttribute("open")),
    "collapsed by default: never a nag"
  );
  const ask = host.querySelector('[data-askcard-id="4"]');
  assert.equal(ask.querySelector(".askcard-line").textContent, "Move to four lifting days");
  assert.match(ask.querySelector(".askcard-why").textContent, /your call/);
  assert.equal(ask.querySelector("button").getAttribute("type"), "button");
  const note = host.querySelector('[data-askcard-id="5"]');
  assert.ok(note.classList.contains("askcard-clinician"));
  assert.equal(note.querySelector(".askcard-line"), null, "no empty summary line");
  assert.equal(
    host.querySelector('[data-askcard-id="6"]'),
    null,
    "a row with no sentence for the athlete is never shown"
  );
});

test("nothing waiting renders nothing, and hostile text stays text", () => {
  const win = load();
  assert.equal(win.CairnAskCard.asksHtml([]), "");
  assert.equal(win.CairnAskCard.asksHtml(null), "");
  const host = renderHtml(
    win.CairnAskCard.asksHtml([{ id: 1, summary: "<b>x</b>", explanation: "<img src=x>", for_clinician: false }]),
    { document: win.document }
  );
  assert.equal(host.querySelector("b"), null);
  assert.equal(host.querySelector("img"), null);
  assert.equal(host.querySelector(".askcard-line").textContent, "<b>x</b>");
});

function deps({ peek = null, read = WAITING } = {}) {
  const chats = [];
  const reads = [];
  return {
    chats,
    reads,
    deps: {
      peekCached: () => (peek ? { data: peek, fresh: true } : null),
      cachedApi: async (path, options) => {
        reads.push(path);
        await Promise.resolve();
        if (read instanceof Error) throw read;
        options?.onUpgrade?.(read, { changed: JSON.stringify(read) !== JSON.stringify(peek) });
        return read;
      },
      gotoChatWith: (text) => chats.push(text),
    },
  };
}

test("the controller paints warm, revalidates, and opens chat pre-filled", async () => {
  const win = load();
  const host = createHost(win.document);
  const h = deps({ peek: WAITING });
  win.CairnAskCardController.mount(host, h.deps);
  win.CairnAskCardController.mount(host, h.deps);
  assert.ok(host.querySelector('[data-askcard-id="4"]'), "the cached asks paint at once");
  await flush();
  assert.deepEqual(h.reads, ["/brain/decisions/waiting?limit=8", "/brain/decisions/waiting?limit=8"]);
  await host.querySelector('[data-askcard-talk="4"]').click();
  assert.deepEqual(h.chats, ["Can we talk this through? Move to four lifting days"], "one tap, one door");
});

test("a failed read leaves the slot empty and a removed host is never painted", async () => {
  const win = load();
  const host = createHost(win.document);
  win.CairnAskCardController.mount(host, deps({ read: new Error("offline") }).deps);
  await flush();
  assert.equal(host.innerHTML, "");

  const gone = createHost(win.document);
  win.CairnAskCardController.mount(gone, deps().deps);
  gone.remove();
  await flush();
  assert.equal(gone.querySelector(".askcard"), null);
});
