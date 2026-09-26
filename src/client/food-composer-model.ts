// @ts-check
// Food composer — pure shaping, no DOM and no fetch. How the composer's text
// becomes the chat message it sends, and what a finished chat turn says was
// logged. The submission path is the existing chat capture lane (POST /api/chat,
// whose food rows follow the one src/foodCapture.ts contract); nothing here is a
// second capture contract.

// Food mode says "food" out loud without putting words in the athlete's mouth: the
// chat router (src/chatRouting.ts) needs a capture verb AND a food noun to read a
// message as a food log, and a pasted "oats 60 g / milk 250 ml" names neither. So a
// food-mode send carries the athlete's words unchanged plus `capture: "food"`; the
// server frames the TURN as an explicit food log for routing and keeps the athlete's
// own words in the chat history and on the food row (src/chat-intent.ts,
// frameFoodCaptureMessage / foodCaptureWords). A bare photo from a surface opened to
// log food is consent to log it for the same reason.
const FOOD_COMPOSER_CAPTURE = "food";
const FOOD_COMPOSER_TERMINAL = new Set(["done", "error", "canceled"]);
const FOOD_COMPOSER_FOOD_ACTIONS = new Set(["log_food", "update_food_note"]);

function foodComposerRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function foodComposerModeOf(value: unknown): FoodComposerMode {
  return value === "food" ? "food" : "chat";
}

// The message a send carries: the athlete's words exactly, in either mode (trimmed
// at the ends only, so a pasted multi-line meal keeps every line). Nothing here
// invents a time or a meal label (the one direction of time inference stays the
// server's).
function foodComposerMessage(text: unknown): string {
  return String(text ?? "").trim();
}

// The POST /api/chat body for one send. Food mode adds the capture flag; the text is
// never rewritten on the client.
function foodComposerRequestBody(
  message: string,
  options: { mode?: unknown; requestId: string; image?: FoodComposerImage | null }
): FoodComposerRequestBody {
  const body: FoodComposerRequestBody = { message, request_id: options.requestId };
  if (foodComposerModeOf(options.mode) === "food") body.capture = FOOD_COMPOSER_CAPTURE;
  if (options.image) {
    body.image_base64 = options.image.base64;
    body.image_mime = options.image.mime;
  }
  return body;
}

// What a "usual around now" chip drafts into the composer. Chat needs the capture
// verb in the draft itself (the router reads the words the athlete sends); food
// mode adds it at send, so the draft stays just the food for editing.
function foodComposerChipText(summary: unknown, mode: unknown): string {
  const food = String(summary ?? "").trim();
  return foodComposerModeOf(mode) === "food" ? food : `Log ${food}`;
}

function foodComposerTurnId(turn: unknown): number | null {
  const id = Number(foodComposerRecord(turn).id);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function foodComposerTurnTerminal(turn: unknown): boolean {
  return FOOD_COMPOSER_TERMINAL.has(String(foodComposerRecord(turn).status || ""));
}

// The food rows a finished turn wrote, read off its applied actions (the instant
// capture receipt and the agent lane both record them there).
function foodComposerLoggedNotes(turn: unknown): FoodComposerLoggedNote[] {
  const meta = foodComposerRecord(foodComposerRecord(turn).meta);
  const applied = Array.isArray(meta.applied) ? meta.applied : [];
  const notes: FoodComposerLoggedNote[] = [];
  for (const entry of applied) {
    const action = foodComposerRecord(entry);
    const type = String(action.type || "");
    if (!FOOD_COMPOSER_FOOD_ACTIONS.has(type) || action.error) continue;
    const result = foodComposerRecord(action.result);
    const id = Number(result.id);
    if (!Number.isSafeInteger(id) || id <= 0) continue;
    notes.push({
      id,
      type: type as FoodComposerLoggedNote["type"],
      meal: result.meal == null ? null : String(result.meal),
      enrichment_status: result.enrichment_status == null ? null : String(result.enrichment_status),
    });
  }
  return notes;
}

// The settled outcome of one food-mode send, or null while the turn is still going.
function foodComposerOutcome(turn: unknown): FoodComposerOutcome | null {
  if (!foodComposerTurnTerminal(turn)) return null;
  const row = foodComposerRecord(turn);
  const turnId = foodComposerTurnId(turn);
  const reply = typeof row.reply === "string" && row.reply.trim() ? row.reply.trim() : null;
  const notes = row.status === "done" ? foodComposerLoggedNotes(turn) : [];
  if (notes.length && turnId != null) return { kind: "logged", logged: { turnId, notes, reply } };
  return { kind: row.status === "done" ? "replied" : "failed", reply };
}

const CAIRN_FOOD_COMPOSER_MODEL = {
  message: foodComposerMessage,
  requestBody: foodComposerRequestBody,
  chipText: foodComposerChipText,
  mode: foodComposerModeOf,
  turnId: foodComposerTurnId,
  turnTerminal: foodComposerTurnTerminal,
  loggedNotes: foodComposerLoggedNotes,
  outcome: foodComposerOutcome,
};

Object.assign(globalThis, { CairnFoodComposerModel: CAIRN_FOOD_COMPOSER_MODEL });
