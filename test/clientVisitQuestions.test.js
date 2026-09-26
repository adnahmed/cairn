// visit-questions (visit-questions-{client,controller}.ts), docs/V2-PLAN.md wave 3. The
// server proposes the questions (GET /api/health/visit-questions); the athlete removes
// any or adds their own, and every edit reports the list the packet sends (null = the
// server's proposals). The list is never stored. Synthetic fixtures only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHost, fire, flush, loadClientModule, renderHtml } from "./_dom.mjs";

const PROPOSALS = [
  {
    id: "loop:synth-a",
    text: "Recheck Synthetic Marker A at the next draw?",
    source: "doctor_loop",
    basis: "Last read high.",
  },
  { id: "ask:7", text: "Is the synthetic plan still right?", source: "clinical_ask", basis: null },
];

function load() {
  return loadClientModule([
    "html-utils",
    "ui-components",
    "ui-actions-client",
    "visit-questions-client",
    "visit-questions-controller",
  ]);
}

function deps({ fail = false, peek = null } = {}) {
  const changes = [];
  const asked = [];
  return {
    changes,
    asked,
    cachedApi: (path, opts) => {
      asked.push([path, opts?.key]);
      return fail
        ? Promise.reject(new Error("offline"))
        : Promise.resolve({ as_of: "2031-02-01", questions: PROPOSALS, frame: "" });
    },
    peekCached: (key) => (peek && key === "health:visit-questions" ? { data: peek, fresh: false } : null),
    // Plain arrays: the module runs in its own vm realm.
    onChange: (list) => changes.push(list === null ? null : [...list]),
  };
}

const texts = (host) => host.querySelectorAll(".vq-text").map((el) => el.textContent);

test("the list names each proposal's source and basis, escapes text, and labels every remove", () => {
  const win = load();
  const V = win.CairnVisitQuestions;
  const items = [...PROPOSALS, { id: "custom:1", text: "<img src=x>", source: "athlete", basis: null }];
  const host = renderHtml(V.listHtml({ status: "ready", items, edited: true, full: false }), {
    document: win.document,
  });
  assert.deepEqual(
    host.querySelectorAll(".vq-src").map((el) => el.textContent),
    ["Follow-up", "Held for your doctor", "Yours"]
  );
  assert.equal(host.querySelector(".vq-basis").textContent, "Last read high.");
  assert.equal(host.querySelector("img"), null, "caller text stays text");
  const remove = host.querySelector('[data-vq-remove="custom:1"]');
  assert.equal(remove.getAttribute("type"), "button");
  assert.equal(remove.getAttribute("aria-label"), "Remove question: <img src=x>");
  assert.ok(host.querySelector("[data-vq-reset]"), "an edited list offers the suggestions back");
  const empty = renderHtml(V.listHtml({ status: "ready", items: [], edited: false, full: false }), {
    document: win.document,
  });
  assert.match(empty.textContent, /No questions yet/);
  assert.equal(empty.querySelector("[data-vq-reset]"), null);
});

test("loading shows a calm status; the proposals arrive through SWR and report nothing until edited", async () => {
  const win = load();
  const d = deps();
  const host = createHost(win.document);
  win.CairnVisitQuestionsController.mount(host, d);
  assert.equal(host.querySelector('[role="status"]').textContent.trim(), "Gathering questions for the visit…");
  await flush();
  assert.deepEqual(d.asked, [["/health/visit-questions", "health:visit-questions"]]);
  assert.deepEqual(
    texts(host),
    PROPOSALS.map((q) => q.text)
  );
  assert.deepEqual(d.changes, [], "the proposals are the server's default; nothing to send");
});

test("remove and add report the athlete's list; Enter adds; duplicates and blanks are ignored", async () => {
  const win = load();
  const d = deps({ peek: { questions: PROPOSALS } });
  const host = createHost(win.document);
  win.CairnVisitQuestionsController.mount(host, d);
  assert.deepEqual(
    texts(host),
    PROPOSALS.map((q) => q.text),
    "a warm peek paints at once"
  );
  await flush();

  await host.querySelector('[data-vq-remove="loop:synth-a"]').click();
  assert.deepEqual(d.changes.at(-1), ["Is the synthetic plan still right?"]);
  assert.equal(
    win.document.activeElement,
    host.querySelector('[data-vq-remove="ask:7"]'),
    "focus lands on the next question"
  );

  const input = host.querySelector("[data-vq-input]");
  input.value = "  A synthetic   question of my own?  ";
  await fire(input, "keydown", { key: "Enter" });
  assert.deepEqual(d.changes.at(-1), ["Is the synthetic plan still right?", "A synthetic question of my own?"]);
  assert.equal(input.value, "", "the field clears for the next one");
  assert.equal(win.document.activeElement, input);
  assert.ok(host.querySelector(".vq-item.settle-in"), "the new question settles in once");

  const count = d.changes.length;
  input.value = "a synthetic question of my own?";
  await host.querySelector("[data-vq-add]").click();
  input.value = "   ";
  await host.querySelector("[data-vq-add]").click();
  assert.equal(d.changes.length, count, "a duplicate or a blank changes nothing");

  await host.querySelector("[data-vq-reset]").click();
  assert.equal(d.changes.at(-1), null, "back to the server's proposals");
  assert.deepEqual(
    texts(host),
    PROPOSALS.map((q) => q.text)
  );
});

test("removing every question sends an empty list, not the proposals", async () => {
  const win = load();
  const d = deps();
  const host = createHost(win.document);
  win.CairnVisitQuestionsController.mount(host, d);
  await flush();
  for (const q of PROPOSALS) await host.querySelector(`[data-vq-remove="${q.id}"]`).click();
  assert.deepEqual(d.changes.at(-1), []);
  assert.match(host.textContent, /No questions yet/);
});

test("a failed read is one calm line; the athlete can still add, and Try again asks once more", async () => {
  const win = load();
  const d = deps({ fail: true });
  const host = createHost(win.document);
  win.CairnVisitQuestionsController.mount(host, d);
  await flush();
  assert.match(host.textContent, /Couldn't gather the suggested questions just now/);
  assert.match(
    host.textContent,
    /Any you add here stand in for the suggested list in this packet/,
    "the copy says an addition replaces the suggestions, not appends to them"
  );
  const input = host.querySelector("[data-vq-input]");
  input.value = "My synthetic question?";
  await host.querySelector("[data-vq-add]").click();
  assert.deepEqual(d.changes.at(-1), ["My synthetic question?"]);
  await host.querySelector("[data-vq-retry]").click();
  assert.equal(d.asked.length, 2);
});

test("a full list closes the add field; a long question is trimmed to the server's ceiling", async () => {
  const win = load();
  const C = win.CairnVisitQuestionsController;
  assert.equal(C.cleanQuestion("x".repeat(400)).length, C.QUESTION_MAX_CHARS);
  const d = deps();
  const host = createHost(win.document);
  C.mount(host, d);
  await flush();
  const input = host.querySelector("[data-vq-input]");
  for (let i = 0; i < C.QUESTION_CAP; i++) {
    input.value = `Synthetic question ${i}?`;
    await host.querySelector("[data-vq-add]").click();
  }
  assert.equal(texts(host).length, C.QUESTION_CAP);
  assert.equal(input.disabled, true);
  assert.match(host.textContent, /full list for one visit/);
});

test("mounting twice leaves one listener; teardown drops a late answer", async () => {
  const win = load();
  const d = deps();
  const host = createHost(win.document);
  win.CairnVisitQuestionsController.mount(host, d);
  win.CairnVisitQuestionsController.mount(host, d);
  await flush();
  await host.querySelector('[data-vq-remove="ask:7"]').click();
  assert.equal(d.changes.length, 1, "one tap, one edit");

  let resolve;
  const late = {
    ...deps(),
    cachedApi: () => new Promise((r) => (resolve = r)),
  };
  const host2 = createHost(win.document);
  const teardown = win.CairnVisitQuestionsController.mount(host2, late);
  teardown();
  resolve({ questions: PROPOSALS });
  await flush();
  assert.equal(host2.querySelector(".vq-item"), null);
});
