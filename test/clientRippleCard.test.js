// The Ask what-if ripple card (ripple-card-model/-client/-controller): a hypothetical
// asked in words becomes a durable what-if job (POST /api/what-if); its answer paints
// the change in words and the ripple across the six stones in the server's own words
// and tones — never a number — and "Do it" posts only the job id (POST
// /api/what-if/do), then prints how the team took it: the Changes feed's own row and
// Undo for that decision, or a framing line. The card never changes anything on render.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHost, fire, flush, loadClientModule, renderHtml } from "./_dom.mjs";

const MODULES = [
  "html-utils",
  "ui-actions-client",
  "decision-undo-client",
  "decision-undo-controller",
  "changes-feed-client",
  "ripple-card-model",
  "ripple-card-client",
  "ripple-card-controller",
];

function load(globals = {}) {
  return loadClientModule(MODULES, { globals });
}

const STONES = [
  ["strength", "Strength", "planned", "ok"],
  ["endurance", "Endurance", "building", "ok"],
  ["fuel", "Fuel", "in progress", "quiet"],
  ["recovery", "Recovery", "rested", "ok"],
  ["body", "Body", "on course", "ok"],
  ["heart", "Heart", "worth noting", "watch"],
];

const STEADY_WHY = "Nothing here should move much from this.";

function effect(key, label, word, tone, move = null) {
  const before = { word, tone };
  if (!move) {
    return { stone: key, label, direction: "steady", why: STEADY_WHY, confidence: "unsure", before, after: before };
  }
  return { stone: key, label, before, ...move };
}

function answer(overrides = {}) {
  const moves = {
    endurance: {
      direction: "helps",
      confidence: "likely",
      why: "A fourth run builds more aerobic base.",
      after: { word: "better", tone: "ok" },
    },
    recovery: {
      direction: "costs",
      confidence: "possible",
      why: "One more run asks more of your legs.",
      after: { word: "asks more", tone: "watch" },
    },
  };
  return {
    ok: true,
    date: "2026-09-26",
    question: "What if I ran four days a week?",
    change: {
      kind: "training",
      summary: "Swap Thursday's accessory lift for an easy run.",
      changes: [{ day_number: 3, exercise: "Cable Row", sets: 2 }],
      doable: true,
      clinical: false,
    },
    ripple: STONES.map(([key, label, word, tone]) => effect(key, label, word, tone, moves[key] ?? null)),
    plan_basis: "fp-1",
    source: "agent",
    agent: "stub",
    tried: [],
    ...overrides,
  };
}

function changesRead(id = 41) {
  return {
    as_of: "2026-09-26",
    days: [
      {
        day: "2026-09-26",
        label: "Today",
        changes: [
          {
            id,
            day: "2026-09-26",
            state: "applied",
            domain: "training",
            title: "Thursday's accessory lift became an easy run",
            why: "You asked what a fourth run would do, and handed it over.",
            status_line: "Landed today",
            lands_on: null,
            outcome: { key: "too_early", phrase: "we can't tell yet" },
            confidence: "tentative",
            undo: { available: true, label: "Put Thursday back" },
            new: true,
          },
        ],
      },
    ],
    since_seen: 1,
    since_seen_line: "1 change today",
    seen_at: null,
    seen_through: "2026-09-26T12:00:00.000Z",
  };
}

function recorder({ respond = {}, reduced = false, live = true, storage = null } = {}) {
  const calls = [];
  const streams = [];
  const toasts = [];
  const talks = [];
  const invalidated = [];
  let changes = 0;
  const deps = {
    api: async (path, init) => {
      calls.push({ path, method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body) : null });
      const handler = respond[path.split("?")[0]];
      if (typeof handler === "function") return handler(init);
      if (handler !== undefined) return handler;
      throw new Error(`unexpected ${path}`);
    },
    toast: (message) => toasts.push(message),
    openJobStream: (jobId, handlers) => streams.push({ jobId, handlers }),
    reducedMotion: () => reduced,
    openChanges: () => {
      changes += 1;
    },
    talkItThrough: (question) => talks.push(question),
    isLive: () => live,
    invalidate: (key) => invalidated.push(key),
    storage,
    restoreEmpty: (log) => {
      log.innerHTML = `<div class="empty">restored</div>`;
    },
  };
  return {
    deps,
    calls,
    streams,
    toasts,
    talks,
    invalidated,
    get changes() {
      return changes;
    },
  };
}

function writes(calls) {
  return calls.filter((c) => c.method !== "GET");
}

async function askAndAnswer(win, log, rec, result = answer()) {
  const card = win.CairnRippleCardController.open(log, rec.deps);
  card.querySelector("[data-ripple-input]").value = "I ran four days a week?";
  fire(card.querySelector("form"), "submit");
  await flush();
  assert.equal(rec.streams.length, 1, "the what-if follows its durable job");
  rec.streams[0].handlers.onDone(result);
  return card;
}

// ---------- model ----------

test("the model carries every server word verbatim, clamps tones, and never invents an after", () => {
  const win = load();
  const odd = answer();
  odd.ripple[0].before.tone = "red";
  odd.ripple[1].after = null;
  const model = win.CairnRippleCardModel.answer(odd);
  assert.equal(model.summary, "Swap Thursday's accessory lift for an easy run.");
  assert.equal(model.doable, true);
  assert.equal(model.stones.length, 6);
  assert.deepEqual(
    [...model.stones.map((s) => s.label)],
    ["Strength", "Endurance", "Fuel", "Recovery", "Body", "Heart"],
    "the server's stone order"
  );
  assert.equal(model.stones[0].before.tone, "quiet", "an unknown tone reads quiet");
  assert.equal(model.stones[1].after.word, "building", "a missing after keeps where it stands");
  assert.equal(model.stones[3].after.word, "asks more");
  assert.deepEqual(
    [...model.stones.filter((s) => s.moved).map((s) => s.key)],
    ["endurance", "recovery"],
    "only a stone that moves is marked moved"
  );
  assert.equal(win.CairnRippleCardModel.answer({ ok: false, error: "x" }), null);
  assert.equal(win.CairnRippleCardModel.answer(null), null);
  assert.equal(win.CairnRippleCardModel.answer({ ok: true, change: { summary: "" }, ripple: [] }), null);
});

test("the question always reaches the team as one 'What if' sentence", () => {
  const win = load();
  const q = win.CairnRippleCardModel.question;
  assert.equal(q("I ran four days a week?"), "What if I ran four days a week?");
  assert.equal(q("what if  I ran\nfour days?"), "What if I ran four days?");
  assert.equal(q("…I lifted twice"), "What if I lifted twice");
  assert.equal(q("What if"), "", "only the lead-in is not a question");
  assert.equal(q("   "), "");
  assert.equal(win.CairnRippleCardModel.questionBody("What if I ran more?"), "I ran more?");
});

test("handed() frames the server's routed result and never decides a tier itself", () => {
  const win = load();
  const h = win.CairnRippleCardModel.handed;
  // The server's immediate-apply shape: applyProposal's `applied` is the array of items that landed.
  const landed = h({
    ok: true,
    applied: [{ target_id: 3, field: "target_reps", value: 8 }],
    tier: "quiet_apply",
    decision: { id: 41 },
    proposal_id: 9,
  });
  assert.equal(landed.state, "landed");
  assert.equal(h({ ok: true, applied: [], tier: "quiet_apply", decision: { id: 2 } }).state, "landed");
  assert.equal(landed.decisionId, 41);
  assert.equal(landed.proposalId, 9);
  assert.equal(h({ ok: true, announced: true, tier: "announce", decision: { id: 3 } }).state, "lands");
  assert.equal(
    h({ ok: true, applied: false, review_required: true, tier: "ask", decision: { id: 5 } }).state,
    "waiting"
  );
  assert.match(h({ ok: true, review_required: true, tier: "ask", plan_moved: true }).line, /plan has moved/);
  assert.equal(h({ ok: true, review_required: true, tier: "clinician" }).state, "clinician");
  assert.equal(h({ ok: true, already: true, proposal_id: 9 }).state, "already");
  const refused = h({ ok: false, error: "a goal is yours to name", kind: "goal", tried: [] });
  assert.equal(refused.state, "refused");
  assert.equal(refused.line, "A goal is yours to name", "what-if's own reason, as a sentence");
  const raw = h({ ok: false, error: "the autonomous apply decision was not stored", tier: "quiet_apply" });
  assert.equal(raw.line, "The team couldn't take this change just now.", "a raw failure never reaches the athlete");
  assert.equal(h(null).state, "refused");
});

test("findChange picks the Changes feed row for exactly this decision", () => {
  const win = load();
  assert.equal(
    win.CairnRippleCardModel.findChange(changesRead(41), 41).title,
    "Thursday's accessory lift became an easy run"
  );
  assert.equal(win.CairnRippleCardModel.findChange(changesRead(41), 42), null);
  assert.equal(win.CairnRippleCardModel.findChange(changesRead(41), null), null);
  assert.equal(win.CairnRippleCardModel.findChange(null, 41), null);
});

// ---------- view ----------

test("the answer shows the change in words, all six stones, and a why per stone that moves", () => {
  const win = load();
  const model = win.CairnRippleCardModel.answer(answer());
  const host = renderHtml(win.CairnRippleCard.answerHtml(model), { document: win.document });
  assert.equal(host.querySelector(".ripple-change").textContent, "Swap Thursday's accessory lift for an easy run.");
  assert.equal(
    host.querySelector(".ripple-question").textContent,
    "I ran four days a week?",
    "under the card's own What if"
  );
  const stones = host.querySelectorAll(".ripple-stone");
  assert.equal(stones.length, 6);
  assert.deepEqual(
    stones.map((s) => s.querySelector(".ripple-stone-now").textContent),
    ["planned", "better", "in progress", "asks more", "on course", "worth noting"]
  );
  assert.equal(
    stones[3].getAttribute("aria-label"),
    "Recovery: rested now, asks more after. One more run asks more of your legs. (possible)",
    "the spoken row carries the why and its confidence, since the visible head is aria-hidden"
  );
  assert.equal(stones[0].getAttribute("aria-label"), "Strength: planned", "a steady stone speaks only where it stands");
  assert.equal(stones[3].classList.contains("ripple-watch"), true, "the tone travels as a class");
  assert.equal(stones[0].classList.contains("is-moved"), false);
  const whys = host.querySelectorAll(".ripple-why");
  assert.equal(whys.length, 2, "a steady stone gets no line of why");
  assert.match(whys[0].textContent, /Endurance A fourth run builds more aerobic base\. likely/);
  assert.ok(host.querySelector("[data-ripple-do]"), "a doable change offers Do it");
  assert.ok(host.querySelector("[data-ripple-later]"), "and always Not now");
});

test("no number, no score, no gate anywhere on the card", () => {
  const win = load();
  const model = win.CairnRippleCardModel.answer(answer());
  const html = win.CairnRippleCard.answerHtml(model, { enter: true });
  const host = renderHtml(html, { document: win.document });
  assert.doesNotMatch(host.textContent, /\d/, "no digit reaches the athlete");
  assert.doesNotMatch(html, /\bscore\b|\/100|%|grade|you must|required/i);
});

test("an unread ripple says nothing rather than claiming nothing moves", () => {
  const win = load();
  const html = win.CairnRippleCard.answerHtml(win.CairnRippleCardModel.answer(answer({ ripple: [] })));
  assert.doesNotMatch(html, /ripple-still|doesn't expect much/);
});

test("a change that cannot be drafted offers the conversation, not a dead Do it", () => {
  const win = load();
  const goal = answer({ change: { kind: "goal", summary: "Aim for a faster half.", doable: false, clinical: false } });
  const host = renderHtml(win.CairnRippleCard.answerHtml(win.CairnRippleCardModel.answer(goal)), {
    document: win.document,
  });
  assert.equal(host.querySelector("[data-ripple-do]"), null);
  assert.ok(host.querySelector("[data-ripple-talk]"));
  assert.match(host.querySelector(".ripple-note").textContent, /A goal is yours to name/);

  const clinical = answer();
  clinical.change.clinical = true;
  const c = renderHtml(win.CairnRippleCard.answerHtml(win.CairnRippleCardModel.answer(clinical)), {
    document: win.document,
  });
  assert.match(c.querySelector(".ripple-note").textContent, /clinical.*waits on your yes/);
});

test("hostile server text stays text", () => {
  const win = load();
  const hostile = answer();
  hostile.change.summary = "<img src=x onerror=1>";
  hostile.ripple[1].why = "<script>1</script>";
  hostile.ripple[1].label = "<b>End</b>";
  const host = renderHtml(win.CairnRippleCard.answerHtml(win.CairnRippleCardModel.answer(hostile)), {
    document: win.document,
  });
  assert.equal(host.querySelector("img"), null);
  assert.equal(host.querySelector("script"), null);
  assert.equal(host.querySelector("b"), null);
  assert.equal(host.querySelector(".ripple-change").textContent, "<img src=x onerror=1>");
});

// ---------- controller ----------

test("asking queues a what-if job with the athlete's words, and the answer paints with one entrance", async () => {
  const win = load();
  const log = createHost(win.document, { html: `<div class="empty">Say hi</div><div class="chat-chips"></div>` });
  const storage = win.sessionStorage;
  const rec = recorder({ respond: { "/what-if": { ok: true, job: { id: 77, kind: "what_if" } } }, storage });
  const card = await askAndAnswer(win, log, rec);
  assert.equal(log.querySelector(".empty"), null, "the empty state steps aside for the card");
  assert.equal(log.querySelector(".chat-chips"), null);
  assert.deepEqual(writes(rec.calls), [
    { path: "/what-if", method: "POST", body: { text: "What if I ran four days a week?" } },
  ]);
  assert.equal(rec.streams[0].jobId, 77);
  assert.equal(storage.getItem(win.CairnRippleCardController.STORAGE_KEY), "77", "remembered for a re-render");
  assert.equal(card.querySelector("[data-ripple-state]").getAttribute("data-ripple-state"), "answer");
  assert.equal(card.querySelector(".ripple-wave").classList.contains("is-entering"), true);
  assert.equal(writes(rec.calls).length, 1, "painting the answer writes nothing");
});

test("reduced motion paints the ripple still", async () => {
  const win = load();
  const log = createHost(win.document);
  const rec = recorder({ respond: { "/what-if": { ok: true, job: { id: 5 } } }, reduced: true });
  const card = await askAndAnswer(win, log, rec);
  assert.equal(card.querySelector(".ripple-wave").classList.contains("is-entering"), false);
});

test("the job's phase is the thinking caption; a failed read is one calm line with Ask again", async () => {
  const win = load();
  const log = createHost(win.document);
  const rec = recorder({ respond: { "/what-if": { ok: true, job: { id: 5 } } } });
  const card = win.CairnRippleCardController.open(log, rec.deps);
  card.querySelector("[data-ripple-input]").value = "I lifted three days";
  fire(card.querySelector("form"), "submit");
  await flush();
  assert.equal(card.querySelector("[data-ripple-state]").getAttribute("data-ripple-state"), "thinking");
  for (const phase of ["queued", "running", "Queued"]) {
    rec.streams[0].handlers.onPhase({ id: 5, phase });
    assert.equal(
      card.querySelector(".ripple-caption").textContent,
      "Talking it through with the team…",
      `the worker's "${phase}" never reaches the athlete`
    );
  }
  rec.streams[0].handlers.onPhase({ id: 5, phase: "talking it through with the team" });
  assert.equal(card.querySelector(".ripple-caption").textContent, "Talking it through with the team…");
  rec.streams[0].handlers.onDone({ ok: false, error: "the team couldn't read this what-if right now", tried: [] });
  assert.equal(card.querySelector("[data-ripple-state]").getAttribute("data-ripple-state"), "failed");
  assert.equal(
    card.querySelector(".ripple-caption").textContent,
    "The team couldn't read this what-if right now. Nothing changed."
  );
  fire(card.querySelector("[data-ripple-retry]"), "click", { bubbles: true });
  await flush();
  assert.equal(rec.streams.length, 2, "Ask again asks the same question again");
  assert.deepEqual(
    writes(rec.calls).map((c) => c.body.text),
    ["What if I lifted three days", "What if I lifted three days"]
  );
});

test("an empty question never reaches the server", async () => {
  const win = load();
  const log = createHost(win.document);
  const rec = recorder();
  const card = win.CairnRippleCardController.open(log, rec.deps);
  card.querySelector("[data-ripple-input]").value = "What if";
  fire(card.querySelector("form"), "submit");
  await flush();
  assert.equal(rec.calls.length, 0);
});

test("Do it posts only the job id, then prints the Changes feed's own row with its Undo", async () => {
  const win = load();
  const log = createHost(win.document);
  const rec = recorder({
    storage: win.sessionStorage,
    respond: {
      "/what-if": { ok: true, job: { id: 77 } },
      "/what-if/do": {
        ok: true,
        applied: [{ target_id: 3, field: "target_reps", value: 8 }],
        tier: "quiet_apply",
        decision: { id: 41 },
        proposal_id: 9,
      },
      "/brain/changes": changesRead(41),
      "/brain/decisions/41/revert": { ok: true },
    },
  });
  const card = await askAndAnswer(win, log, rec);
  fire(card.querySelector("[data-ripple-do]"), "click", { bubbles: true });
  await flush();
  await flush();
  const doCall = writes(rec.calls).find((c) => c.path === "/what-if/do");
  assert.deepEqual(doCall.body, { job_id: 77 }, "the server reads the change from its own stored answer");
  assert.equal(card.querySelector("[data-ripple-do]"), null, "Do it is spent");
  assert.equal(win.sessionStorage.getItem(win.CairnRippleCardController.STORAGE_KEY), null, "handed, so forgotten");
  const handed = card.querySelector("[data-ripple-handed]");
  assert.equal(handed.hidden, false);
  assert.equal(handed.querySelector(".chfeed-title").textContent, "Thursday's accessory lift became an easy run");
  assert.match(handed.textContent, /Landed today/);
  assert.ok(rec.invalidated.includes("brain:changes"), "the feed and the line read the landed change fresh");
  const undo = handed.querySelector("[data-chfeed-undo]");
  assert.ok(undo, "the same server-labelled Undo the feed shows");
  assert.match(undo.textContent, /Put Thursday back/);
  fire(undo, "click", { bubbles: true });
  await flush();
  await flush();
  const revert = writes(rec.calls).find((c) => c.path === "/brain/decisions/41/revert");
  assert.ok(revert, "Undo goes to the server's revert path for this decision");
  assert.equal(rec.toasts.includes("Put back"), true);
  fire(handed.querySelector("[data-ripple-changes]"), "click", { bubbles: true });
  assert.equal(rec.changes, 1, "See Changes opens the record");
});

test("a held hand-over without a feed row says where it waits", async () => {
  const win = load();
  const log = createHost(win.document);
  const rec = recorder({
    respond: {
      "/what-if": { ok: true, job: { id: 8 } },
      "/what-if/do": { ok: true, applied: false, review_required: true, tier: "ask", decision: { id: 50 } },
      "/brain/changes": changesRead(41),
    },
  });
  const card = await askAndAnswer(win, log, rec);
  fire(card.querySelector("[data-ripple-do]"), "click", { bubbles: true });
  await flush();
  await flush();
  const line = card.querySelector(".ripple-handed-line");
  assert.equal(line.getAttribute("data-ripple-handed-state"), "waiting");
  assert.match(line.textContent, /waiting on your yes in Changes/);
});

test("a refused hand-over prints the server's reason and offers the conversation", async () => {
  const win = load();
  const log = createHost(win.document);
  const rec = recorder({
    respond: {
      "/what-if": { ok: true, job: { id: 8 } },
      "/what-if/do": {
        ok: false,
        error: "this one is talked through rather than drafted — ask the team in chat",
        kind: "other",
        tried: [],
      },
    },
  });
  const card = await askAndAnswer(win, log, rec);
  fire(card.querySelector("[data-ripple-do]"), "click", { bubbles: true });
  await flush();
  await flush();
  assert.match(card.querySelector(".ripple-handed-line").textContent, /talked through rather than drafted/);
  assert.equal(card.querySelector("[data-ripple-do]"), null);
  fire(card.querySelector("[data-ripple-talk]"), "click", { bubbles: true });
  assert.deepEqual(rec.talks, ["What if I ran four days a week?"], "the question goes to the composer, unsent");
  assert.equal(
    rec.calls.some((c) => c.path === "/brain/changes"),
    false,
    "no decision, no feed read"
  );
});

test("Not now puts the card away, forgets it, and gives an empty thread its chips back", async () => {
  const win = load();
  const log = createHost(win.document);
  const storage = win.sessionStorage;
  const rec = recorder({ respond: { "/what-if": { ok: true, job: { id: 12 } } }, storage });
  const card = await askAndAnswer(win, log, rec);
  fire(card.querySelector("[data-ripple-later]"), "click", { bubbles: true });
  assert.equal(log.querySelector(".ripple-card"), null);
  assert.equal(storage.getItem(win.CairnRippleCardController.STORAGE_KEY), null);
  assert.equal(log.querySelector(".empty").textContent, "restored");
  assert.equal(rec.streams[0].handlers.guard(), true, "its stream closes with it");
  assert.equal(writes(rec.calls).length, 1, "nothing but the question was ever sent");
});

test("a rebuilt thread gets the live card back; a reload finds a done answer and paints it still", async () => {
  const win = load();
  const log = createHost(win.document);
  const rec = recorder({ respond: { "/what-if": { ok: true, job: { id: 30 } } }, storage: win.sessionStorage });
  const card = await askAndAnswer(win, log, rec);
  log.innerHTML = "";
  assert.equal(win.CairnRippleCardController.reattach(log), true);
  assert.equal(log.lastElementChild, card, "the same card, at the foot of the thread");

  const fresh = load();
  const storage = fresh.sessionStorage;
  storage.setItem(fresh.CairnRippleCardController.STORAGE_KEY, "30");
  const log2 = createHost(fresh.document);
  const rec2 = recorder({
    storage,
    respond: {
      "/agent-jobs/30": {
        ok: true,
        job: {
          id: 30,
          kind: "what_if",
          status: "done",
          input: { text: "What if I ran four days a week?" },
          result: answer(),
        },
      },
    },
  });
  const back = await fresh.CairnRippleCardController.resume(log2, rec2.deps);
  assert.ok(back);
  assert.equal(back.querySelector(".ripple-change").textContent, "Swap Thursday's accessory lift for an easy run.");
  assert.equal(
    back.querySelector(".ripple-wave").classList.contains("is-entering"),
    false,
    "a returning answer arrives still"
  );
  assert.equal(writes(rec2.calls).length, 0, "resuming writes nothing");
});

test("a remembered job that is gone or not a what-if is forgotten quietly", async () => {
  const win = load();
  const storage = win.sessionStorage;
  storage.setItem(win.CairnRippleCardController.STORAGE_KEY, "31");
  const log = createHost(win.document);
  const rec = recorder({
    storage,
    respond: { "/agent-jobs/31": { ok: true, job: { id: 31, kind: "chat_turn", status: "done" } } },
  });
  assert.equal(await win.CairnRippleCardController.resume(log, rec.deps), null);
  assert.equal(storage.getItem(win.CairnRippleCardController.STORAGE_KEY), null);
  assert.equal(log.innerHTML, "");
});

test("a what-if already handed to the team is not re-offered after a reload", async () => {
  const win = load();
  const storage = win.sessionStorage;
  storage.setItem(win.CairnRippleCardController.STORAGE_KEY, "32");
  const log = createHost(win.document);
  const rec = recorder({
    storage,
    respond: {
      "/agent-jobs/32": {
        ok: true,
        job: { id: 32, kind: "what_if", status: "done", result: answer(), ref_table: "plan_proposals", ref_id: 9 },
      },
    },
  });
  assert.equal(await win.CairnRippleCardController.resume(log, rec.deps), null);
  assert.equal(storage.getItem(win.CairnRippleCardController.STORAGE_KEY), null, "it lives in Changes now");
  assert.equal(log.querySelector("[data-ripple-do]"), null);
});
