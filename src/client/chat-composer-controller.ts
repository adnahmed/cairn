// @ts-check
// Chat's composer: the chat-mode mount of the shared food composer, plus the
// Chat-only pieces (the durable retry store, the optimistic bubble, the monitor).

let chatComposerTeardown: (() => void) | null = null;

function chatComposerRetryStore(): Pick<ChatTurnRecordsApi, "clearRetry" | "loadRetry" | "saveRetry"> | null {
  const records = (globalThis as typeof globalThis & { CairnChatTurnRecords?: Partial<ChatTurnRecordsApi> })
    .CairnChatTurnRecords;
  return records &&
    typeof records.clearRetry === "function" &&
    typeof records.loadRetry === "function" &&
    typeof records.saveRetry === "function"
    ? (records as Pick<ChatTurnRecordsApi, "clearRetry" | "loadRetry" | "saveRetry">)
    : null;
}

// Single source of truth for the retry envelope's lifetime, defined alongside
// the storage it expires (chat-turn-records-client.ts). Falls back to the same
// 15-minute window when that module hasn't loaded yet (e.g. an isolated test).
function chatComposerRetryTtlMs(): number {
  const records = (globalThis as typeof globalThis & { CairnChatTurnRecords?: Partial<ChatTurnRecordsApi> })
    .CairnChatTurnRecords;
  return typeof records?.retryTtlMs === "number" && Number.isFinite(records.retryTtlMs)
    ? records.retryTtlMs
    : 15 * 60 * 1000;
}

// Drops the previous Chat composer mount. Each render paints a fresh shell, so the
// old mount's element listeners die with its DOM; the document-level paste
// listener is the one that would outlive it, and this is what retires it.
function clearChatComposerPasteHandler(): void {
  const teardown = chatComposerTeardown;
  chatComposerTeardown = null;
  teardown?.();
}

// Chat mounts the one food composer (food-composer-controller.ts) on the markup its
// shell already painted, in chat mode: the athlete's words go out exactly, the
// optimistic bubble lands instantly, and Chat's own turn monitor follows the turn.
// The photo, paste, dictation, frequents, keyboard and retry machinery all live in
// the composer, shared with Fuel.
function wireChatComposer(deps: ChatComposerControllerDeps): ChatComposerControllerHandle {
  clearChatComposerPasteHandler();
  // Deep links (e.g. the compass nudge) arrive with the question pre-written --
  // leave it editable rather than auto-sending; the composer restores the saved
  // draft otherwise.
  const prefill = deps.state.chatPrefill;
  if (prefill) deps.state.chatPrefill = null;
  const composer = CairnFoodComposer.mount(deps.host || deps.input, {
    mode: "chat",
    parts: {
      input: deps.input,
      sendBtn: deps.sendBtn,
      fileInput: deps.fileInput,
      attachBtn: deps.attachBtn,
      preview: deps.preview,
      mic: deps.mic ?? null,
      freqSlot: deps.freqSlot ?? null,
    },
    api: deps.api,
    toast: deps.toast,
    isActive: () => deps.state.tab === "chat",
    measure: deps.measure,
    autosizeInput: deps.autosizeInput,
    prefill,
    draft: { load: deps.loadDraft, save: deps.saveDraft },
    retryStore: chatComposerRetryStore(),
    retryTtlMs: chatComposerRetryTtlMs(),
    autofocus: true,
    // Optimistic user bubble lands instantly (the server persists it too; a full
    // re-render later draws from server truth, so no duplicate). A send that
    // could not even enqueue rolls it back.
    onSubmit: ({ message, image }) => {
      const userMsg: ChatScreenMessage = {
        role: "user",
        content: message || "(photo)",
        meta: image ? { image: image.dataUrl } : null,
      };
      const userBubble = deps.appendMsg(userMsg);
      deps.rememberFuelContext(userMsg);
      void deps.loadFuel(deps.token);
      return { rollback: () => userBubble?.remove() };
    },
    onEnqueued: (turn) => {
      deps.spawnPendingBubble(turn);
      deps.ensureMonitor();
    },
  });
  chatComposerTeardown = composer;
  return { send: composer.send, clearAttachment: composer.clearAttachment };
}

const CAIRN_CHAT_COMPOSER_CONTROLLER = {
  wire: wireChatComposer,
  clearPasteHandler: clearChatComposerPasteHandler,
};

Object.assign(globalThis, { CairnChatComposerController: CAIRN_CHAT_COMPOSER_CONTROLLER });

if (typeof window !== "undefined") {
  window.CairnChatComposerController = CAIRN_CHAT_COMPOSER_CONTROLLER;
}
