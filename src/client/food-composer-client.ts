// @ts-check
// Food composer — the view. One composer for Chat and Fuel: multi-line text, a
// photo, dictation, and the "usual around now" prefill chips. Deterministic
// markup only; food-composer-controller.ts loads, wires and sends.
//
// Every element id is `<idPrefix><Part>`, so `foodComposerHtml({ idPrefix: "chat" })`
// emits the same ids the Chat shell (chat-client.ts shellHtml) carries today and a
// surface can host its own composer without colliding with Chat's.

const FOOD_COMPOSER_ID_PREFIX = /^[A-Za-z][A-Za-z0-9]{0,31}$/;

const FOOD_COMPOSER_COPY: Record<FoodComposerMode, { placeholder: string; label: string; send: string }> = {
  chat: { placeholder: "Ask, log, or snap a plate…", label: "Message Cairn", send: "Send" },
  food: { placeholder: "What did you eat? A line per food, or snap the plate…", label: "Log food", send: "Log it" },
};

// A usable id prefix, or the component's own default. The controller builds
// `#<prefix>Input`-style selectors from it, so nothing else ever reaches one.
function foodComposerIdPrefix(value: unknown): string {
  const prefix = String(value ?? "");
  return FOOD_COMPOSER_ID_PREFIX.test(prefix) ? prefix : "fcomp";
}

// Read lazily at render time: capture-voice-client.ts publishes the glyph, and a
// top-level read would depend on bundle order.
function foodComposerMicGlyph(): string {
  return (globalThis as unknown as { CairnCaptureVoice?: { micGlyph?: string } }).CairnCaptureVoice?.micGlyph ?? "";
}

function foodComposerHtml(options: { idPrefix?: string; mode?: FoodComposerMode; placeholder?: string } = {}): string {
  const p = foodComposerIdPrefix(options.idPrefix);
  const mode: FoodComposerMode = options.mode === "food" ? "food" : "chat";
  const copy = FOOD_COMPOSER_COPY[mode];
  const placeholder = options.placeholder == null ? copy.placeholder : String(options.placeholder);
  const status =
    mode === "food"
      ? `<p id="${p}Status" class="chatnote fcomp-status" role="status" aria-live="polite" hidden></p>`
      : "";
  return `<div id="${p}Preview" class="chat-preview" hidden>
          <img alt="Attached photo">
          <span class="chat-preview-hint">Photo attached — I'll estimate &amp; log it</span>
          <button id="${p}PreviewX" class="xbtn chip-x" aria-label="Remove photo">✕</button>
        </div>
        <div id="${p}FreqSlot" class="chat-freq-slot" hidden></div>
        <div class="chatbar" data-fcomp-mode="${mode}">
          <button id="${p}Attach" class="attachbtn" aria-label="Attach a photo — camera, library, or files">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 5.5v13M5.5 12h13"/>
            </svg>
          </button>
          <input id="${p}File" type="file" accept="image/*" hidden>
          <div class="chat-field">
            <textarea id="${p}Input" rows="1" autocomplete="off" aria-label="${escAttr(copy.label)}" placeholder="${escAttr(placeholder)}"></textarea>
            <button id="${p}Mic" class="qlmic" type="button" hidden aria-label="Dictate" title="Say it out loud">${foodComposerMicGlyph()}</button>
          </div>
          <button id="${p}Send" class="logbtn" aria-label="${escAttr(copy.send)}">↑</button>
        </div>${status}`;
}

// "Usual around now" — the foods most often logged near this hour, offered as
// PREFILL drafts above the composer (never a one-tap re-log: meals vary, so the
// frequent is a starting sentence the athlete edits, and the estimate is
// re-derived from what they actually send). Empty string when nothing qualifies.
function foodComposerFrequentChipsHtml(foods: unknown): string {
  const rows = Array.isArray(foods) ? foods : [];
  const chips = rows
    .slice(0, 3)
    .map((f) => {
      const row = f && typeof f === "object" ? (f as Record<string, unknown>) : {};
      const summary = String(row.summary || "").trim();
      if (!summary) return "";
      const kcal =
        row.kcal != null && Number.isFinite(Number(row.kcal))
          ? `<span class="freq-chip-kcal">${Math.round(Number(row.kcal))}</span>`
          : "";
      return `<button class="freq-chip" type="button" data-freq="${escAttr(summary)}">
        <span class="freq-chip-name">${escHtml(summary)}</span>${kcal}
      </button>`;
    })
    .join("");
  if (!chips) return "";
  return `<div class="chat-freq rail"><span class="freq-head lbl">usual around now</span><div class="freq-chips">${chips}</div></div>`;
}

const CAIRN_FOOD_COMPOSER_CLIENT = {
  html: foodComposerHtml,
  frequentChipsHtml: foodComposerFrequentChipsHtml,
  idPrefix: foodComposerIdPrefix,
};

Object.assign(globalThis, { CairnFoodComposerClient: CAIRN_FOOD_COMPOSER_CLIENT });
