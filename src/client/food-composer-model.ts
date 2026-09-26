// @ts-check
// Food composer — pure shaping, no DOM and no fetch. How the composer's text
// becomes the chat message it sends, and what a finished chat turn says was
// logged. The submission path is the existing chat capture lane (POST /api/chat,
// whose food rows follow the one src/foodCapture.ts contract); nothing here is a
// second capture contract.

// Food mode says "food" out loud: the chat router (src/chatRouting.ts) needs a
// capture verb AND a food noun to read a message as a food log, and a pasted
// "oats 60 g / milk 250 ml" names neither, so it would go to the coach as
// conversation. "Log food: <the athlete's words>" is the explicit form, which the
// instant capture lane takes when nothing else in the text (a time, a question)
// asks for the agent. A leading "log"/"log food" the athlete typed is not doubled.
const FOOD_COMPOSER_LOG_FOOD = /^log\s+food\b\s*:?\s*/i;
const FOOD_COMPOSER_LOG = /^log\b\s*:?\s*/i;
// A bare photo is not consent to log food (src/chat-intent.ts). From a surface
// opened to log food it is, so the photo travels with the explicit words.
const FOOD_COMPOSER_PHOTO_ONLY = "Log this meal";
const FOOD_COMPOSER_TERMINAL = new Set(["done", "error", "canceled"]);
const FOOD_COMPOSER_FOOD_ACTIONS = new Set(["log_food", "update_food_note"]);

function foodComposerRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function foodComposerModeOf(value: unknown): FoodComposerMode {
  return value === "food" ? "food" : "chat";
}

// The message a send carries. Chat sends the athlete's words exactly (trimmed at
// the ends only, so a pasted multi-line meal keeps every line). Food mode frames
// the same words as a food log, and never invents a time or a meal label (the one
// direction of time inference stays the server's).
function foodComposerMessage(text: unknown, options: { mode?: unknown; hasImage?: boolean } = {}): string {
  const trimmed = String(text ?? "").trim();
  if (foodComposerModeOf(options.mode) !== "food") return trimmed;
  if (!trimmed) return options.hasImage ? FOOD_COMPOSER_PHOTO_ONLY : "";
  const words = trimmed.replace(FOOD_COMPOSER_LOG_FOOD, "").replace(FOOD_COMPOSER_LOG, "").trim();
  return words ? `Log food: ${words}` : options.hasImage ? FOOD_COMPOSER_PHOTO_ONLY : "";
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
  chipText: foodComposerChipText,
  mode: foodComposerModeOf,
  turnId: foodComposerTurnId,
  turnTerminal: foodComposerTurnTerminal,
  loggedNotes: foodComposerLoggedNotes,
  outcome: foodComposerOutcome,
};

Object.assign(globalThis, { CairnFoodComposerModel: CAIRN_FOOD_COMPOSER_MODEL });
