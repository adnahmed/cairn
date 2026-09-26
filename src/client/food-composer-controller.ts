// @ts-check
// Food composer — the controller. One composer that Chat and Fuel both mount:
// multi-line text, a photo (picked, or pasted), dictation, the "usual around now"
// prefill chips, and a send that goes down the existing chat capture lane
// (POST /api/chat, idempotent by request_id). Chat follows its turns with its own
// monitor; a surface that passes `onLogged` (Fuel) has the composer follow the
// turn itself and hears back the moment the food row exists, without leaving
// the screen.
//
//   const composer = CairnFoodComposer.mount(host, { mode: "food", idPrefix: "fuelLog", api, toast, onLogged });
//   composer.fill("Greek yogurt 200 g\nberries");   // "Start from this": fills, never sends
//   composer();                                      // teardown
//
// `mount` paints `foodComposerHtml` into `host`, or adopts markup the host already
// holds when `deps.parts` names it (the Chat shell). Mounting twice on one host
// runs the previous teardown first (CairnUiActions.mount), and every listener the
// composer adds — including the document-level paste — goes with its signal.

// Mirrors the retry window chat-turn-records-client.ts owns for Chat's store.
const FOOD_COMPOSER_RETRY_TTL_MS = 15 * 60 * 1000;

type FoodComposerRetry = {
  requestId: string;
  text: string;
  image: FoodComposerImage | null;
  needsImage: boolean;
  expiresAt: number;
};

function foodComposerRow(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function foodComposerHoverPointer(): boolean {
  return matchMedia("(hover:hover)").matches;
}

function foodComposerIsSoftKeyboard(): boolean {
  return !foodComposerHoverPointer();
}

function foodComposerKeyboardGeometryOpen(): boolean {
  return document.body.classList.contains("kb-geometry-open");
}

function foodComposerRequestId(): string {
  try {
    const id = globalThis.crypto?.randomUUID?.();
    if (id) return id;
  } catch {
    /* old WebView: use the bounded URL-safe fallback below */
  }
  return `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

function foodComposerDefaultAutosize(input: HTMLTextAreaElement | HTMLInputElement): void {
  const layout = (globalThis as unknown as { CairnChatLayout?: Partial<ChatLayoutApi> }).CairnChatLayout;
  layout?.autosizeInput?.(input);
}

function foodComposerParts(host: Element, prefix: string): FoodComposerParts | null {
  const q = <T extends Element>(part: string) => host.querySelector<T>(`#${prefix}${part}`);
  const input = q<HTMLTextAreaElement>("Input");
  const sendBtn = q<HTMLButtonElement>("Send");
  const fileInput = q<HTMLInputElement>("File");
  const attachBtn = q<HTMLButtonElement>("Attach");
  const preview = q<HTMLElement>("Preview");
  if (!input || !sendBtn || !fileInput || !attachBtn || !preview) return null;
  return {
    input,
    sendBtn,
    fileInput,
    attachBtn,
    preview,
    mic: q<HTMLElement>("Mic"),
    freqSlot: q<HTMLElement>("FreqSlot"),
    status: q<HTMLElement>("Status"),
  };
}

function wireFoodComposer(parts: FoodComposerParts, deps: FoodComposerDeps, signal: AbortSignal): FoodComposerControls {
  const { input, sendBtn, fileInput, attachBtn, preview } = parts;
  const mode = CairnFoodComposerModel.mode(deps.mode);
  const on = { signal };
  const isActive = () => (deps.isActive ? deps.isActive() : input.isConnected);
  const measure = () => deps.measure?.();
  const autosize = (el: HTMLTextAreaElement | HTMLInputElement) =>
    (deps.autosizeInput || foodComposerDefaultAutosize)(el);
  const setStatus = (text: string) => {
    if (!parts.status) return;
    parts.status.textContent = text;
    parts.status.hidden = !text;
  };

  // The idempotency envelope: a send writes its request_id (and, with a store,
  // the retryable text) before the draft clears, so a lost response or a reload
  // resends the SAME request and the server replays it instead of logging twice.
  let attached: FoodComposerImage | null = null;
  let sendInFlight = false;
  const retryStore = deps.retryStore || null;
  const storedRetry = retryStore?.loadRetry() || null;
  let retry: FoodComposerRetry | null = storedRetry
    ? {
        requestId: storedRetry.requestId,
        text: storedRetry.text,
        image: null,
        needsImage: storedRetry.hasImage,
        expiresAt: storedRetry.expiresAt,
      }
    : null;
  const persistRetry = (attempt: FoodComposerRetry | null) => {
    if (!attempt) retryStore?.clearRetry();
    else
      retryStore?.saveRetry({
        requestId: attempt.requestId,
        text: attempt.text,
        hasImage: !!attempt.image || attempt.needsImage,
        expiresAt: attempt.expiresAt,
      });
  };

  const resetFocusAfterNativePicker = () =>
    CairnChatAttachment.resetFocusAfterNativePicker({ input, fileInput, isSoftKeyboard: foodComposerIsSoftKeyboard });
  const settleAfterNativePicker = () =>
    CairnChatAttachment.settleAfterNativePicker({ isActive, measure, graceMs: 1200 });
  const clearAttachment = () => {
    attached = null;
    fileInput.value = "";
    preview.hidden = true;
    attachBtn.classList.remove("has-img");
    settleAfterNativePicker();
  };
  const attachFile = async (f: File | null | undefined) => {
    if (!f) return;
    try {
      attached = await CairnChatAttachment.compressImage(f);
      if (retry && retry.needsImage && retry.text === input.value.trim()) {
        retry.image = attached;
        retry.needsImage = false;
        persistRetry(retry);
      }
      const img = CairnChatAttachment.previewImage(preview.querySelector("img"));
      if (img) img.src = attached.dataUrl;
      preview.hidden = false;
      attachBtn.classList.add("has-img");
    } catch (e) {
      const tooLarge = e instanceof Error && e.message === "image-too-large";
      deps.toast(tooLarge ? "That photo is too large — try a closer crop." : "Couldn't read that image — try another.");
      clearAttachment();
    } finally {
      settleAfterNativePicker();
    }
  };

  // One "+" control. On iOS a file input with no `capture` opens the native
  // sheet (Take Photo / Photo Library / Choose File); desktop opens the file
  // dialog. Attaching is occasional, so this keeps the bar to input + send.
  attachBtn.addEventListener(
    "click",
    () => {
      resetFocusAfterNativePicker();
      settleAfterNativePicker();
      fileInput.click();
    },
    on
  );
  preview.querySelector(".chip-x")?.addEventListener("click", clearAttachment, on);
  fileInput.addEventListener(
    "change",
    () => {
      resetFocusAfterNativePicker();
      const f = fileInput.files && fileInput.files[0];
      if (f) void attachFile(f);
      else settleAfterNativePicker();
    },
    on
  );

  // Paste-an-image (desktop screenshots, iOS "Copy Photo"). Text paste is never
  // touched, so a pasted multi-line meal lands exactly as copied. The listener is
  // the mount's, so a re-mount or teardown drops it; it bails while the surface
  // isn't active so it never touches a stale DOM.
  document.addEventListener(
    "paste",
    (e: ClipboardEvent) => {
      if (!isActive() || !input.isConnected) return;
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it && it.kind === "file" && it.type.startsWith("image/")) {
          const f = it.getAsFile();
          if (f) {
            e.preventDefault();
            void attachFile(f);
          }
          return;
        }
      }
    },
    on
  );

  // Send = enqueue a durable turn and return at once; the input never blocks, so
  // a follow-up typed while the coach is thinking simply queues as its own turn.
  const send = async () => {
    if (sendInFlight) return;
    const text = input.value.trim();
    const img = attached;
    const message = CairnFoodComposerModel.message(text);
    if (!message && !img) return;
    if (retry && retry.text === text && retry.needsImage && !img) {
      deps.toast("Reattach the photo to retry this message");
      return;
    }
    const attempt =
      retry && retry.text === text && retry.image === img && !retry.needsImage
        ? retry
        : {
            requestId: foodComposerRequestId(),
            text,
            image: img,
            needsImage: false,
            expiresAt: Date.now() + (deps.retryTtlMs ?? FOOD_COMPOSER_RETRY_TTL_MS),
          };
    // Write the idempotency key and retryable text before clearing the draft or
    // starting the request. A navigation/reload can now resume this exact request.
    retry = attempt;
    persistRetry(attempt);
    sendInFlight = true;
    input.value = "";
    autosize(input); // collapse the composer back to one line
    deps.draft?.save("");
    const receipt = deps.onSubmit?.({ message, image: img }) || null;
    if (deps.onLogged) setStatus("Logging it…");
    try {
      const body = CairnFoodComposerModel.requestBody(message, { mode, requestId: attempt.requestId, image: img });
      const r = foodComposerRow(
        await deps.api("/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
      );
      if (!r.turn) throw new Error(r.error == null ? "enqueue failed" : String(r.error));
      retry = null;
      persistRetry(null);
      if (attached === img) clearAttachment();
      deps.onEnqueued?.(r.turn);
      if (deps.onLogged) void CairnFoodComposerTurn.follow(r.turn, deps, { signal, setStatus });
    } catch {
      // Couldn't even enqueue (offline): roll the host's optimistic echo back and
      // put the text back in the composer so nothing is lost.
      receipt?.rollback?.();
      setStatus("");
      retry = attempt;
      persistRetry(attempt);
      if (!input.value) {
        input.value = text;
        deps.draft?.save(text);
        autosize(input);
      }
      deps.toast("Couldn't send — check your connection");
    } finally {
      sendInFlight = false;
      if (foodComposerHoverPointer()) input.focus();
    }
  };

  // Tapping send must NOT blur the textarea (that just dismisses the keyboard,
  // and as the layout reflows the button slides out from under your finger so
  // the first tap never sends). preventDefault on pointerdown keeps the input
  // focused -- but on iOS WebKit that ALSO suppresses the synthesized click, so
  // we send on pointerup instead (fires on both touch and mouse). The click
  // handler stays for keyboard activation (Enter/Space on the focused button);
  // send()'s empty-input guard makes any second call a no-op, so pointer
  // devices never double-send. (The "+" is left alone -- it opens a file picker.)
  sendBtn.addEventListener("pointerdown", (e) => e.preventDefault(), on);
  sendBtn.addEventListener("pointerup", () => void send(), on);
  sendBtn.addEventListener("click", () => void send(), on);
  // Desktop: Enter sends, Shift+Enter drops a newline. Touch keyboards keep
  // Enter as a newline (so multi-line capture -- pasting findings, describing a
  // meal -- just works) and send via the arrow button.
  input.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Enter" && !e.shiftKey && foodComposerHoverPointer()) {
        e.preventDefault();
        void send();
      }
    },
    on
  );
  // Re-pin the column across the whole keyboard slide, and recover stale iOS
  // textarea focus from the next real tap after a native image picker closes.
  CairnChatComposerFocus.wireFocus({
    input,
    isActive,
    isSoftKeyboard: foodComposerIsSoftKeyboard,
    isKeyboardGeometryOpen: foodComposerKeyboardGeometryOpen,
    measure,
    signal,
  });
  // Persist the unsent draft on every keystroke and re-grow to fit.
  input.addEventListener(
    "input",
    () => {
      deps.draft?.save(input.value);
      autosize(input);
    },
    on
  );

  // Press-to-talk dictation; the mic stays hidden where Web Speech is absent.
  const voice = (globalThis as unknown as { CairnCaptureVoice?: Window["CairnCaptureVoice"] }).CairnCaptureVoice;
  if (parts.mic && voice) voice.setup({ mic: parts.mic, input, signal });

  // A pre-written prefill (a deep link, "Start from this") stays editable and is
  // never auto-sent; otherwise restore the retry text or the saved draft.
  if (deps.prefill) {
    input.value = deps.prefill;
    deps.draft?.save(input.value);
  } else {
    const draft = deps.draft?.load() || "";
    if (retry?.text) input.value = retry.text;
    else if (draft) input.value = draft;
  }
  if (retry?.needsImage) deps.toast("Reattach the photo to retry this message");
  autosize(input); // fit a restored multi-line draft
  // desktop only -- on mobile, auto-focus pops the keyboard over half the view
  if (deps.autofocus && foodComposerHoverPointer()) input.focus();

  // The chips wire AFTER that programmatic autofocus, so opening the composer does
  // not by itself fetch or show them: they appear when the athlete focuses the empty
  // composer (Chat's behavior before the extraction, pinned by a desktop test).
  const freq =
    parts.freqSlot && deps.frequents !== false
      ? CairnFoodComposerChips.wire(parts.freqSlot, input, deps, signal)
      : null;

  const fill = (value: string) => {
    input.value = String(value ?? "");
    deps.draft?.save(input.value);
    autosize(input);
    freq?.hide();
    input.focus();
  };

  return { send, clearAttachment, fill };
}

function mountFoodComposer(host: Element, deps: FoodComposerDeps): FoodComposerHandle {
  let controls: FoodComposerControls | null = null;
  const teardown = CairnUiActions.mount(host, "fcomp", ({ signal }) => {
    const prefix = CairnFoodComposerClient.idPrefix(deps.idPrefix);
    if (!deps.parts) {
      host.innerHTML = CairnFoodComposerClient.html({
        idPrefix: prefix,
        mode: CairnFoodComposerModel.mode(deps.mode),
        placeholder: deps.placeholder,
      });
    }
    const parts = deps.parts || foodComposerParts(host, prefix);
    if (parts) controls = wireFoodComposer(parts, deps, signal);
    return () => {
      controls = null;
    };
  });
  return Object.assign(teardown, {
    send: () => (controls ? controls.send() : Promise.resolve()),
    clearAttachment: () => controls?.clearAttachment(),
    fill: (text: string) => controls?.fill(text),
  });
}

const CAIRN_FOOD_COMPOSER = {
  mount: mountFoodComposer,
};

Object.assign(globalThis, { CairnFoodComposer: CAIRN_FOOD_COMPOSER });
