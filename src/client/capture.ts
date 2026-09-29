// @ts-check
// ==== capture.ts ====
function captureFailureIsTransient(error: unknown): boolean {
  const classify = (globalThis as unknown as {
    CairnApiCache?: { isTransientApiFailure?: (value: unknown) => boolean };
  }).CairnApiCache?.isTransientApiFailure;
  return typeof classify === "function" ? classify(error) : true;
}

function setupWeightChip(): void {
  const chip = view.querySelector<HTMLElement>("#wtChip");          // compass tile (in the week fold)
  const mini = view.querySelector<HTMLElement>("#wtChipMini");      // always-on capture-row chip
  const inline = view.querySelector<HTMLElement>("#wtInline");
  const input = view.querySelector<HTMLInputElement>("#wtInlineInput");
  const go = view.querySelector<HTMLElement>("#wtInlineGo");
  if (!inline || !input) return;
  const toggle = () => {
    inline.hidden = !inline.hidden;
    if (!inline.hidden) { input.focus(); input.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "nearest" }); }
  };
  if (chip) chip.addEventListener("click", toggle);
  if (mini) mini.addEventListener("click", toggle);
  const save = async (): Promise<void> => {
    const w = +input.value;
    if (!w) { input.focus(); return; }
    const weighIn = { weight_lb: w, date: localISO() }; // dated: an offline replay keeps its day
    try {
      await api("/bodyweight", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(weighIn) });
    } catch (error) {
      if (!captureFailureIsTransient(error)) {
        toast("Couldn't log that — try again.");
        return;
      }
      // Offline — queue the weigh-in and reflect it optimistically; it syncs on reconnect.
      const saved = await outboxEnqueue("weight", "/bodyweight", weighIn);
      if (!saved) {
        toast("Couldn’t save that on this device — free storage and try again.");
        return;
      }
      const pendingVal = chip && chip.querySelector("[data-wtval]");
      if (pendingVal) pendingVal.innerHTML = `${w}<span class="stat-plus">+</span>`;
      if (mini) mini.innerHTML = `${w}<span class="wt-mini-unit">lb</span><span class="stat-plus">+</span>`;
      input.value = ""; inline.hidden = true;
      toast("Saved — will sync when you're back online");
      return;
    }
    // a weigh-in syncs profile.weight_lb and moves the weight trend / pace — drop the
    // caches that read it so Today's compass + the Weight/Energy views stay honest.
    swrInvalidate("progress:weight");
    swrInvalidate("stats");
    swrInvalidate("profile");
    swrInvalidate("progress:energy");
    const valEl = chip && chip.querySelector("[data-wtval]");
    if (valEl) valEl.innerHTML = `${w}<span class="stat-plus">+</span>`;
    if (mini) mini.innerHTML = `${w}<span class="wt-mini-unit">lb</span><span class="stat-plus">+</span>`;
    input.value = ""; inline.hidden = true;
    toast("Weight logged");
  };
  if (go) go.addEventListener("click", save);
  input.addEventListener("keydown", (e: KeyboardEvent) => { if (e.key === "Enter") save(); });
}

// ---------- effortless capture: voice (Web Speech), frequents, check-in ----------
function captureVoice(): Window["CairnCaptureVoice"] {
  return (globalThis as unknown as { CairnCaptureVoice: Window["CairnCaptureVoice"] }).CairnCaptureVoice;
}

const MIC_GLYPH = (globalThis as unknown as { CairnCaptureVoice?: Window["CairnCaptureVoice"] }).CairnCaptureVoice?.micGlyph ?? "";

// Voice capture is scoped to Chat (product law: photo/voice logging ONLY in
// Chat). It mounts against whichever mic/input pair the chat composer emits
// in the shared `view` root — when Chat is the active surface both exist, so
// this does not early-return there; on any other tab neither exists yet and
// it quietly no-ops.
function setupVoiceCapture(): void {
  const mic = view.querySelector<HTMLElement>("#chatMic");
  const inp = view.querySelector<HTMLTextAreaElement>("#chatInput");
  if (!mic || !inp) return;
  captureVoice().setup({ mic, input: inp });
}

// Food frequents ("Usual around now") moved into the Chat composer as prefill
// chips (chat-frequents wiring in chat-screen.ts) — capture stays scoped to Chat,
// and a frequent is a starting draft to edit, never a verbatim one-tap re-log.

// ---------- optional how-you-feel (offered, never required) ----------
// The morning check-in lives in capture-checkin-client.ts (CairnCaptureCheckin);
// this name stays the Brief's entry point.
function loadCheckin(): Promise<void> {
  const checkin = (globalThis as unknown as { CairnCaptureCheckin?: Window["CairnCaptureCheckin"] }).CairnCaptureCheckin;
  return checkin ? checkin.loadCheckin() : Promise.resolve();
}

// ---------- context tags: cheap one-tap life context (WHOOP-journal pattern) ----------
// A quiet row of chips — travel / drinks / rough sleep setup / work crunch / feeling
// off. Tap tags today, tap again untags. No streaks, no history guilt: this is
// evidence the insight generator quietly tests against outcomes, never advice, and
// never gates anything. Renders nothing until the vocab + today's state are both in.
async function loadTagChips(): Promise<void> {
  const slot = view.querySelector<HTMLElement>("#tagsSlot");
  if (!slot) return;
  let vocab: CaptureContextTagDef[] = [];
  let tagged: CaptureContextTag[] = [];
  try {
    // Today's render starts both reads before its first paint (the one-shot
    // CairnTodayPrefetch); take those requests when they are there.
    const prefetch = (globalThis as { CairnTodayPrefetch?: TodayPrefetchApi }).CairnTodayPrefetch;
    const get = (path: string) => prefetch?.take(path) ?? api(path);
    [vocab, tagged] = await Promise.all([
      get("/context-tags/vocab") as Promise<CaptureContextTagDef[]>,
      get("/context-tags?date=" + localISO()) as Promise<CaptureContextTag[]>,
    ]);
  } catch { return; }
  if (state.tab !== "today" || !slot.isConnected) return;
  if (!Array.isArray(vocab) || !vocab.length) { slot.innerHTML = ""; return; }
  const onKeys = new Set((Array.isArray(tagged) ? tagged : []).map((t) => t.key));
  renderTagChips(slot, vocab, onKeys);
}

function renderTagChips(slot: HTMLElement, vocab: CaptureContextTagDef[], onKeys: Set<string>): void {
  const chips = vocab.map((t) =>
    `<button class="tag-chip${onKeys.has(t.key) ? " tag-chip-on" : ""}" data-tag="${escAttr(t.key)}" type="button" aria-pressed="${onKeys.has(t.key) ? "true" : "false"}">${escHtml(t.label)}</button>`
  ).join("");
  slot.innerHTML = `<div class="tags-chips">${chips}</div>`;
  slot.querySelectorAll<HTMLElement>("[data-tag]").forEach((b) =>
    b.addEventListener("click", () => toggleTagChip(b)));
}

// A chip flips in the same frame it is tapped; the toggle rides behind it and the
// server's answer settles the chip (it is the truth), a failure flips it back. One
// toggle in flight per chip — the others stay tappable.
const _tagTogglesInFlight = new Set<string>();
async function toggleTagChip(chip: HTMLElement): Promise<void> {
  const key = chip.dataset.tag;
  if (!key || _tagTogglesInFlight.has(key)) return;
  _tagTogglesInFlight.add(key);
  const was = chip.classList.contains("tag-chip-on");
  const paint = (on: boolean) => {
    chip.classList.toggle("tag-chip-on", on);
    chip.setAttribute?.("aria-pressed", on ? "true" : "false");
  };
  paint(!was);
  try {
    const res = await api("/context-tags/toggle", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    }) as CaptureContextTagToggleResponse;
    if (res && !res.error) paint(!!res.on);
    else {
      paint(was);
      toast("Couldn't save that — try again.");
    }
  } catch {
    paint(was);
    toast("Couldn't save that — try again.");
  } finally {
    _tagTogglesInFlight.delete(key);
  }
}

let _captureReads: ReturnType<CaptureReadsRuntime["createController"]> | null = null;

function captureReads(): ReturnType<CaptureReadsRuntime["createController"]> {
  if (!_captureReads) {
    _captureReads = (globalThis as unknown as { CairnCaptureReads: CaptureReadsRuntime }).CairnCaptureReads.createController({
      root: view,
      state,
      api,
      runOp,
      toast,
      collapseEl,
      escapeHtml: escHtml,
      storage: localStorage,
    });
  }
  return _captureReads;
}

function weekRangeLabel(iso: unknown): string {
  return (globalThis as unknown as { CairnCaptureReads: CaptureReadsRuntime }).CairnCaptureReads.weekRangeLabel(iso);
}

function loadTodayReads(): Promise<void> {
  return captureReads().loadTodayReads();
}

function reconnectInsight(): ClientAgentOpHandlers | null {
  return captureReads().reconnectInsight();
}

// Classic client scripts share one global scope. Keep the cross-file capture API
// explicit while this surface is migrated incrementally to TypeScript.
Object.assign(globalThis, {
  MIC_GLYPH,
  weekRangeLabel,
  setupWeightChip,
  setupVoiceCapture,
  loadCheckin,
  loadTagChips,
  loadTodayReads,
  reconnectInsight,
});
