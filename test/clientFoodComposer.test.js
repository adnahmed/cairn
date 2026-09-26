// The one food composer (food-composer-model/-client/-controller.ts) that Chat and
// Fuel both mount: multi-line text, a photo, dictation and the "usual around now"
// prefill chips, sending down the existing chat capture lane (POST /api/chat).
// Renderer, model and controller all run on the shared DOM harness.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FakeEvent,
  createFakeTimers,
  createHost,
  fire,
  flush,
  listenerCount,
  loadClientModule,
  renderHtml,
} from "./_dom.mjs";

const IMAGE = { dataUrl: "data:image/jpeg;base64,YQ==", base64: "YQ==", mime: "image/jpeg", bytes: 1 };

function load({ hover = false, globals = {} } = {}) {
  const timers = createFakeTimers();
  const win = loadClientModule(
    [
      "html-utils",
      "ui-actions-client",
      "chat-composer-focus-client",
      "food-composer-model",
      "food-composer-client",
      "food-composer-chips-controller",
      "food-composer-turn-controller",
      "food-composer-controller",
    ],
    {
      globals: {
        ...timers,
        matchMedia: () => ({ matches: hover }),
        crypto: {
          randomUUID: (() => {
            let n = 0;
            return () => `request-${++n}`;
          })(),
        },
        CairnChatAttachment: {
          compressImage: async () => IMAGE,
          previewImage: (el) => el ?? null,
          resetFocusAfterNativePicker() {},
          settleAfterNativePicker() {},
        },
        ...globals,
      },
    }
  );
  return { win, timers };
}

// An api fake: records every call, answers POST /chat with `turn` and anything
// else through `routes` (path -> value or function).
function fakeApi({ turn = { id: 7, status: "queued" }, routes = {} } = {}) {
  const calls = [];
  const api = async (path, opts = {}) => {
    calls.push({ path, method: opts.method || "GET", body: opts.body ? JSON.parse(opts.body) : null });
    if (path === "/chat" && opts.method === "POST") return typeof turn === "function" ? turn() : { ok: true, turn };
    const hit = routes[path];
    return typeof hit === "function" ? hit() : hit;
  };
  api.calls = calls;
  api.posts = () => calls.filter((c) => c.method === "POST");
  return api;
}

function mountFood(win, deps = {}) {
  const host = createHost(win.document);
  const toasts = [];
  const api = deps.api || fakeApi();
  const handle = win.CairnFoodComposer.mount(host, {
    mode: "food",
    idPrefix: "fuelLog",
    api,
    toast: (m) => toasts.push(m),
    ...deps,
  });
  return {
    host,
    api,
    toasts,
    handle,
    input: host.querySelector("#fuelLogInput"),
    send: host.querySelector("#fuelLogSend"),
  };
}

test("the composer markup carries the ids Chat's shell uses, and food mode adds its label and status line", () => {
  const { win } = load();
  const chat = renderHtml(win.CairnFoodComposerClient.html({ idPrefix: "chat" }), { document: win.document });
  for (const id of [
    "chatPreview",
    "chatPreviewX",
    "chatFreqSlot",
    "chatAttach",
    "chatFile",
    "chatInput",
    "chatMic",
    "chatSend",
  ]) {
    assert.ok(chat.querySelector(`#${id}`), `#${id} present`);
  }
  assert.equal(chat.querySelector("#chatInput").getAttribute("aria-label"), "Message Cairn");
  assert.equal(chat.querySelector("#chatStatus"), null, "chat mode has no status line");
  assert.equal(chat.querySelector("#chatFile").getAttribute("accept"), "image/*");

  const food = renderHtml(
    win.CairnFoodComposerClient.html({ idPrefix: "fuelLog", mode: "food", placeholder: 'Eggs "and" <toast>' }),
    { document: win.document }
  );
  assert.equal(food.querySelector("#fuelLogInput").getAttribute("aria-label"), "Log food");
  assert.equal(food.querySelector("#fuelLogInput").getAttribute("placeholder"), 'Eggs "and" <toast>');
  assert.equal(food.querySelector("#fuelLogStatus").hidden, true);
  assert.equal(win.CairnFoodComposerClient.idPrefix('x"><img'), "fcomp", "an unsafe prefix falls back");
});

test("food mode frames a log without touching the athlete's lines; chat sends the words as typed", () => {
  const { win } = load();
  const m = win.CairnFoodComposerModel;
  const pasted = "  2 eggs\ntoast 1 slice\nbutter 10 g\nblack coffee\nbanana\nskyr 150 g  ";
  assert.equal(m.message(pasted, { mode: "chat" }), pasted.trim());
  assert.equal(m.message(pasted, { mode: "food" }), `Log food: ${pasted.trim()}`);
  assert.equal(m.message(pasted, { mode: "food" }).split("\n").length, 6, "six lines stay six lines");
  assert.equal(m.message("Had oatmeal and berries", { mode: "food" }), "Log food: Had oatmeal and berries");
  assert.equal(m.message("log 2 eggs", { mode: "food" }), "Log food: 2 eggs", "a typed log verb is not doubled");
  assert.equal(m.message("Log food: skyr 150 g", { mode: "food" }), "Log food: skyr 150 g");
  assert.equal(m.message("log", { mode: "food", hasImage: true }), "Log this meal");
  assert.equal(m.message("", { mode: "food", hasImage: true }), "Log this meal");
  assert.equal(m.message("", { mode: "chat", hasImage: true }), "");
  assert.equal(m.chipText("Greek yogurt bowl", "chat"), "Log Greek yogurt bowl");
  assert.equal(m.chipText("Greek yogurt bowl", "food"), "Greek yogurt bowl");

  const logged = m.outcome({
    id: 9,
    status: "done",
    reply: "Logged your lunch.",
    meta: {
      applied: [
        { type: "log_food", result: { id: 41, meal: "lunch", enrichment_status: "pending" } },
        { type: "log_activity", result: { id: 3 } },
      ],
    },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(logged)), {
    kind: "logged",
    logged: {
      turnId: 9,
      notes: [{ id: 41, type: "log_food", meal: "lunch", enrichment_status: "pending" }],
      reply: "Logged your lunch.",
    },
  });
  assert.equal(m.outcome({ id: 9, status: "running" }), null);
  assert.equal(
    m.outcome({ id: 9, status: "done", reply: "What did you have?", meta: { applied: [] } }).kind,
    "replied"
  );
  assert.equal(m.outcome({ id: 9, status: "error" }).kind, "failed");
});

test("mounting twice on one host leaves one set of listeners: one tap, one POST; teardown removes them", async () => {
  const { win } = load();
  const host = createHost(win.document);
  const api = fakeApi();
  const deps = { mode: "food", idPrefix: "fuelLog", api, toast() {}, frequents: false };
  const baselinePaste = listenerCount(win.document, "paste");
  win.CairnFoodComposer.mount(host, deps);
  const handle = win.CairnFoodComposer.mount(host, deps);
  assert.equal(listenerCount(win.document, "paste"), baselinePaste + 1, "one document paste listener");
  const input = host.querySelector("#fuelLogInput");
  input.value = "chicken 200 g";
  await host.querySelector("#fuelLogSend").click();
  await flush();
  assert.equal(api.posts().length, 1);

  const perInput = listenerCount(input);
  assert.ok(perInput > 0);
  handle();
  assert.equal(listenerCount(input), 0, "teardown leaves no listener on the input");
  assert.equal(listenerCount(host.querySelector("#fuelLogSend")), 0);
  assert.equal(listenerCount(win.document, "paste"), baselinePaste);
  handle(); // a second teardown changes nothing
});

test("adopting existing markup twice (Chat's shell) still sends once per tap", async () => {
  const { win } = load();
  const host = renderHtml(win.CairnFoodComposerClient.html({ idPrefix: "chat" }), { document: win.document });
  const api = fakeApi();
  const parts = {
    input: host.querySelector("#chatInput"),
    sendBtn: host.querySelector("#chatSend"),
    fileInput: host.querySelector("#chatFile"),
    attachBtn: host.querySelector("#chatAttach"),
    preview: host.querySelector("#chatPreview"),
  };
  const deps = { mode: "chat", parts, api, toast() {} };
  win.CairnFoodComposer.mount(host, deps);
  const once = listenerCount(parts.input);
  win.CairnFoodComposer.mount(host, deps);
  assert.equal(listenerCount(parts.input), once, "no listener doubled on adopted markup");
  parts.input.value = "how did I sleep?";
  await parts.sendBtn.click();
  await flush();
  assert.deepEqual(
    api.posts().map((c) => c.body.message),
    ["how did I sleep?"]
  );
});

test("a pasted multi-line meal is left to the browser and sent with every line", async () => {
  const { win } = load();
  const { input, send, api } = mountFood(win, { frequents: false });
  const textPaste = new FakeEvent("paste", { bubbles: true, cancelable: true });
  textPaste.clipboardData = { items: [{ kind: "string", type: "text/plain" }] };
  await fire(input, textPaste);
  assert.equal(textPaste.defaultPrevented, false, "text paste is never intercepted");

  input.value = "oats 60 g\nmilk 250 ml\nblueberries\nhoney 1 tsp\nwalnuts 15 g\nprotein powder 1 scoop";
  await send.click();
  await flush();
  const body = api.posts()[0].body;
  assert.equal(
    body.message,
    "Log food: oats 60 g\nmilk 250 ml\nblueberries\nhoney 1 tsp\nwalnuts 15 g\nprotein powder 1 scoop"
  );
  assert.match(body.request_id, /^request-\d+$/);
  assert.equal(input.value, "", "the composer clears once the send starts");
});

test("a photo attaches from the picker or a paste, travels with the send, and clears after it lands", async () => {
  const { win } = load();
  const { host, input, send, api } = mountFood(win, { frequents: false });
  const fileInput = host.querySelector("#fuelLogFile");
  const preview = host.querySelector("#fuelLogPreview");
  fileInput.files = [{ name: "plate.jpg" }];
  await fire(fileInput, "change");
  await flush();
  assert.equal(preview.hidden, false);
  assert.equal(preview.querySelector("img").getAttribute("src") ?? preview.querySelector("img").src, IMAGE.dataUrl);
  assert.ok(host.querySelector("#fuelLogAttach").classList.contains("has-img"));

  await host.querySelector("#fuelLogPreviewX").click();
  assert.equal(preview.hidden, true, "the remove button clears it");

  const imagePaste = new FakeEvent("paste", { bubbles: true, cancelable: true });
  imagePaste.clipboardData = { items: [{ kind: "file", type: "image/png", getAsFile: () => ({ name: "shot.png" }) }] };
  await fire(input, imagePaste);
  await flush();
  assert.equal(imagePaste.defaultPrevented, true);
  assert.equal(preview.hidden, false);

  await send.click();
  await flush();
  const body = api.posts()[0].body;
  assert.equal(body.message, "Log this meal");
  assert.equal(body.image_base64, "YQ==");
  assert.equal(body.image_mime, "image/jpeg");
  assert.equal(preview.hidden, true, "cleared once the turn is enqueued");
});

test("a lost response keeps the text and the photo, and the retry reuses the same request_id", async () => {
  const { win } = load();
  let n = 0;
  const api = fakeApi({
    turn: () => {
      n += 1;
      if (n === 1) throw new Error("lost");
      return { ok: true, turn: { id: 3, status: "queued" } };
    },
  });
  const rolledBack = [];
  const { host, input, send, toasts } = mountFood(win, {
    api,
    frequents: false,
    onSubmit: ({ message }) => ({ rollback: () => rolledBack.push(message) }),
  });
  const fileInput = host.querySelector("#fuelLogFile");
  fileInput.files = [{ name: "plate.jpg" }];
  await fire(fileInput, "change");
  await flush();
  input.value = "salmon and rice";
  await send.click();
  await flush();
  assert.equal(input.value, "salmon and rice");
  assert.deepEqual(rolledBack, ["Log food: salmon and rice"]);
  assert.match(toasts.at(-1), /Couldn't send/);
  assert.equal(host.querySelector("#fuelLogPreview").hidden, false, "the photo stays attached");
  await send.click();
  await flush();
  const [first, second] = api.posts().map((c) => c.body);
  assert.equal(first.request_id, second.request_id);
  assert.equal(second.image_base64, "YQ==");
});

test("prefill chips appear on an empty focused composer, draft the food, and never send", async () => {
  const { win } = load();
  const api = fakeApi({
    routes: {
      "/frequent-foods?hour=12": [
        { summary: "Greek yogurt bowl", kcal: 320.4 },
        { summary: "Oats <b>", kcal: null },
      ],
    },
  });
  for (const [mode, drafted] of [
    ["food", "Greek yogurt bowl"],
    ["chat", "Log Greek yogurt bowl"],
  ]) {
    const { host, input } = mountFood(win, { api, mode, hour: () => 12 });
    const slot = host.querySelector("#fuelLogFreqSlot");
    assert.equal(slot.hidden, true);
    input.focus();
    await flush();
    assert.equal(slot.hidden, false);
    const chips = slot.querySelectorAll("[data-freq]");
    assert.equal(chips.length, 2);
    assert.equal(chips[1].querySelector(".freq-chip-name").textContent, "Oats <b>");
    assert.equal(slot.querySelector(".freq-chip-kcal").textContent, "320");
    await chips[0].click();
    assert.equal(input.value, drafted);
    assert.equal(slot.hidden, true);
    input.value = "";
    await fire(input, "input");
    assert.equal(slot.hidden, false, "an emptied composer offers them again");
    input.value = "x";
    await fire(input, "input");
    assert.equal(slot.hidden, true, "typing hides them");
  }
  assert.equal(api.calls.filter((c) => c.path.startsWith("/frequent-foods")).length, 2, "fetched once per mount");
  assert.equal(api.posts().length, 0, "a chip never sends");
});

test("onLogged hears back from an instant capture inside the POST, without leaving the surface", async () => {
  const { win } = load();
  const logged = [];
  const api = fakeApi({
    turn: {
      id: 11,
      status: "done",
      reply: "Logged your dinner.",
      meta: { applied: [{ type: "log_food", result: { id: 88, meal: "dinner", enrichment_status: "pending" } }] },
    },
  });
  const { input, send, toasts } = mountFood(win, { api, frequents: false, onLogged: (x) => logged.push(x) });
  input.value = "Log salmon and rice";
  await send.click();
  await flush();
  assert.equal(logged.length, 1);
  assert.equal(logged[0].turnId, 11);
  assert.deepEqual(
    [...logged[0].notes].map((n) => n.id),
    [88]
  );
  assert.equal(toasts.at(-1), "Logged your dinner");
  assert.equal(api.calls.filter((c) => c.path.startsWith("/chat/turns/")).length, 0, "no polling for a finished turn");
});

test("onLogged follows a queued turn to the end; a turn that logs nothing says so and never reports a log", async () => {
  const { win } = load();
  const waits = [];
  const answers = [
    { id: 5, status: "running" },
    { id: 5, status: "done", meta: { applied: [{ type: "log_food", result: { id: 90, meal: "lunch" } }] } },
  ];
  const api = fakeApi({ turn: { id: 5, status: "queued" }, routes: { "/chat/turns/5": () => answers.shift() } });
  const logged = [];
  const { host, input, send } = mountFood(win, {
    api,
    frequents: false,
    wait: async (ms) => {
      waits.push(ms);
    },
    onLogged: (x) => logged.push(x),
  });
  const status = host.querySelector("#fuelLogStatus");
  input.value = "a turkey sandwich";
  await send.click();
  for (let i = 0; i < 6; i++) await flush();
  assert.equal(logged.length, 1);
  assert.deepEqual(
    [...logged[0].notes].map((n) => n.id),
    [90]
  );
  assert.equal(waits.length, 2);
  assert.equal(status.hidden, true, "the status line settles");

  const quiet = [];
  const replyApi = fakeApi({ turn: { id: 6, status: "done", reply: "Which bread?", meta: { applied: [] } } });
  const other = mountFood(win, { api: replyApi, frequents: false, onLogged: (x) => quiet.push(x) });
  other.input.value = "sandwich";
  await other.send.click();
  await flush();
  assert.equal(quiet.length, 0);
  assert.match(other.toasts.at(-1), /Nothing was logged/);
});

test("fill() drafts a starting point for editing and never logs it", async () => {
  const { win } = load();
  const { handle, input, api } = mountFood(win, { frequents: false });
  handle.fill("Greek yogurt 200 g\nberries");
  assert.equal(input.value, "Greek yogurt 200 g\nberries");
  assert.equal(win.document.activeElement, input);
  await flush();
  assert.equal(api.posts().length, 0);
});

test("a prefill wins over the saved draft; the draft saves on every keystroke", async () => {
  const { win } = load();
  const saved = [];
  const draft = { load: () => "old draft", save: (v) => saved.push(v) };
  const a = mountFood(win, { frequents: false, draft, prefill: "Log the usual" });
  assert.equal(a.input.value, "Log the usual");
  const b = mountFood(win, { frequents: false, draft });
  assert.equal(b.input.value, "old draft");
  b.input.value = "new";
  await fire(b.input, "input");
  assert.equal(saved.at(-1), "new");
});

test("desktop Enter sends and Shift+Enter keeps the newline", async () => {
  const { win } = load({ hover: true });
  const { input, api } = mountFood(win, { frequents: false });
  input.value = "eggs";
  const shift = await fire(input, "keydown", { key: "Enter", shiftKey: true });
  assert.equal(shift.defaultPrevented, false);
  await flush();
  assert.equal(api.posts().length, 0);
  const enter = await fire(input, "keydown", { key: "Enter", shiftKey: false });
  assert.equal(enter.defaultPrevented, true);
  await flush();
  assert.equal(api.posts().length, 1);
});
