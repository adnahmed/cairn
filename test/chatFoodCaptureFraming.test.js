// A send from a surface opened to log food (Fuel's composer) carries the athlete's
// words unchanged plus `capture: "food"`. The server frames the TURN as an explicit
// food log so the router takes it, but the chat history and the food row keep what
// the athlete actually wrote: never "Log food:" and never "Log this meal".
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { chatRouter } from "../dist/routes/chat.js";
import { foodCaptureWords, frameFoodCaptureMessage } from "../dist/chat-intent.js";
import { db, repo, resetTables } from "./_seed.js";

const createdUploads = new Set();

beforeEach(() => {
  resetTables("chat_turns", "chat_messages", "food_notes");
  repo.setSettings({ enrich_enabled: false, chat_routing_mode: "adaptive" });
});

afterEach(() => {
  for (const filePath of createdUploads) {
    try {
      fs.unlinkSync(filePath);
    } catch {
      /* already absent */
    }
  }
  createdUploads.clear();
});

function post(body) {
  const layer = chatRouter.stack.find((entry) => entry.route?.path === "/" && entry.route.methods.post);
  const handler = layer.route.stack[0].handle;
  const result = { status: 200, body: null };
  const res = {
    status(code) {
      result.status = code;
      return this;
    },
    json(value) {
      result.body = value;
      return this;
    },
  };
  handler({ body }, res);
  return result;
}

test("framing is the server's: a typed log verb is not doubled, and the words come back exactly", () => {
  assert.equal(frameFoodCaptureMessage("oats 60 g\nmilk 250 ml", false), "Log food: oats 60 g\nmilk 250 ml");
  assert.equal(frameFoodCaptureMessage("log 2 eggs", false), "Log food: 2 eggs");
  assert.equal(frameFoodCaptureMessage("Log food: skyr 150 g", false), "Log food: skyr 150 g");
  assert.equal(frameFoodCaptureMessage("", true), "Log this meal");
  assert.equal(frameFoodCaptureMessage("log", true), "Log this meal");
  assert.equal(foodCaptureWords("Log food: oats 60 g\nmilk 250 ml"), "oats 60 g\nmilk 250 ml");
  assert.equal(foodCaptureWords("Log this meal", true), "");
  assert.equal(foodCaptureWords("Log this meal", false), "Log this meal", "the photo frame needs a photo");
  assert.equal(foodCaptureWords("log turkey and rice for lunch"), "log turkey and rice for lunch");
});

test("a food-mode text send stores the athlete's words as the chat message and the food row, never the framing", () => {
  const words = "oats 60 g\nmilk 250 ml";
  const r = post({ message: words, capture: "food", request_id: "food-frame-12345678" });
  assert.equal(r.status, 200);
  assert.equal(r.body.turn.status, "done", "the framed turn takes the instant capture lane");
  assert.equal(r.body.turn.message, `Log food: ${words}`, "the turn carries the routing form");
  assert.equal(r.body.user_message.content, words, "the chat history keeps what the athlete wrote");

  const note = db.prepare("SELECT raw_output AS raw, parsed_json FROM food_notes").get();
  assert.equal(note.raw, words);
  assert.equal(JSON.parse(note.parsed_json).summary, words);

  const replay = post({ message: words, capture: "food", request_id: "food-frame-12345678" });
  assert.equal(replay.body.replayed, true);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM food_notes").get().n, 1);
  assert.equal(db.prepare("SELECT raw_output AS raw FROM food_notes").get().raw, words);
});

test("a food-mode bare photo keeps no invented words", () => {
  const r = post({
    message: "",
    capture: "food",
    request_id: "food-photo-12345678",
    image_mime: "image/jpeg",
    image_base64: Buffer.from("bounded-test-image").toString("base64"),
  });
  createdUploads.add(r.body.turn.image_path);
  assert.equal(r.status, 200);
  assert.equal(r.body.turn.message, "Log this meal");
  assert.equal(r.body.user_message.content, "(photo)");
  assert.equal(r.body.turn.status, "done", "the framed photo takes the instant capture lane");
  const note = db.prepare("SELECT raw_output AS raw, parsed_json FROM food_notes").get();
  assert.ok(note, "the photo was logged");
  assert.equal(note.raw, "");
  assert.equal(JSON.parse(note.parsed_json).summary, "Photo meal awaiting estimate");
});

test("without the flag a chat send is untouched: words as typed, no framing", () => {
  const r = post({ message: "oats 60 g", request_id: "chat-plain-12345678" });
  assert.equal(r.status, 200);
  assert.equal(r.body.turn.message, "oats 60 g");
  assert.equal(r.body.user_message.content, "oats 60 g");
  assert.equal(
    post({ message: "oats", capture: "drink", request_id: "chat-other-12345678" }).body.turn.message,
    "oats"
  );
});
