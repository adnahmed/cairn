// @ts-check
// One-tap rename and merge cards after "Tidy exercise names". The tidy request
// itself stays on the Program controller; this is the suggestion markup and its
// taps. Loaded before progress-program-controller, in the same lazy Train bundle.

// A merge the agent found plausible but wasn't confident/structurally-related
// enough to auto-apply (see shouldAutoApplyMerge server-side) — surfaced instead
// as a one-tap suggestion.
// A rename the librarian proposed that the identity guard would not land on its own
// (it reads like a different movement). Parked on the row server-side; one tap lands
// it, "Keep" declines it AND remembers the no, so the next Tidy never re-asks.

function renameSuggestionCardHtml(pair: ExerciseRenameSuggestion, idx: number): string {
  return `<div class="exmerge-card" data-exrename-card="${idx}">
    <div class="exmerge-text">Call <b>${escHtml(pair.from)}</b> "<b>${escHtml(pair.into)}</b>"?</div>
    <div class="exmerge-why">Same numbers, cleaner name. Keep remembers your answer.</div>
    <div class="exmerge-actions">
      <button class="ghostbtn" type="button" data-exrename-accept="${idx}">Rename</button>
      <button class="ghostbtn" type="button" data-exrename-keep="${idx}">Keep</button>
    </div>
  </div>`;
}

async function answerRenameSuggestion(
  btn: HTMLElement,
  pairs: ExerciseRenameSuggestion[],
  accept: boolean,
  deps: ClientProgressProgramControllerDeps
): Promise<void> {
  const idx = Number(btn.getAttribute(accept ? "data-exrename-accept" : "data-exrename-keep"));
  const pair = pairs[idx];
  const card = btn.closest(".exmerge-card");
  if (!pair || !card) return;
  const restore = deps.busy(btn, accept ? "renaming…" : "keeping…");
  let result: { name?: string; error?: string } | null = null;
  try {
    result = (await deps.api(`/exercises/${encodeURIComponent(String(pair.id))}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(accept ? { name: pair.into } : { keep_name: true }),
    })) as { name?: string; error?: string } | null;
  } catch {
    result = null;
  }
  if (result && !result.error) {
    deps.toast(accept ? `${pair.from} is now ${result.name || pair.into}` : `Keeping ${pair.from}`);
    card.remove();
    if (accept) {
      deps.invalidate("progress:program");
      if (deps.state.tab === "progress") deps.renderSelf();
    }
    return;
  }
  restore();
  deps.toast(result?.error || (accept ? "Couldn't rename that — try again." : "Couldn't save that — try again."));
}

function wireRenameSuggestions(
  slot: Element,
  pairs: ExerciseRenameSuggestion[],
  deps: ClientProgressProgramControllerDeps
): void {
  slot.querySelectorAll<HTMLElement>("[data-exrename-accept]").forEach((b) => {
    b.addEventListener("click", () => void answerRenameSuggestion(b, pairs, true, deps));
  });
  slot.querySelectorAll<HTMLElement>("[data-exrename-keep]").forEach((b) => {
    b.addEventListener("click", () => void answerRenameSuggestion(b, pairs, false, deps));
  });
}

function mergeSuggestionCardHtml(pair: ExerciseMergeSuggestion, idx: number): string {
  const why = String(pair.why || "").trim();
  return `<div class="exmerge-card" data-exmerge-card="${idx}">
    <div class="exmerge-text">Merge <b>${escHtml(pair.from)}</b> into <b>${escHtml(pair.into)}</b></div>
    ${why ? `<div class="exmerge-why">${escHtml(why)}</div>` : ""}
    <div class="exmerge-actions">
      <button class="ghostbtn" type="button" data-exmerge-accept="${idx}">Accept</button>
      <button class="ghostbtn" type="button" data-exmerge-skip="${idx}">Skip</button>
    </div>
  </div>`;
}

function mergeSuggestionsInnerHtml(pairs: ExerciseMergeSuggestion[], renames: ExerciseRenameSuggestion[] = []): string {
  return (
    `<div class="exmerge-head lbl">Cairn's not sure — take a look</div>` +
    pairs.map((p, i) => mergeSuggestionCardHtml(p, i)).join("") +
    renames.map((p, i) => renameSuggestionCardHtml(p, i)).join("")
  );
}

// One tap confirms a suggested merge via the existing deterministic /exercises/merge
// endpoint (no agent turn). A per-card busy state guards the double-tap; a failed
// merge surfaces the server's message and leaves the card in place, unlike a
// success which removes it and refreshes the program read.
async function acceptMergeSuggestion(
  acceptBtn: HTMLElement,
  pairs: ExerciseMergeSuggestion[],
  deps: ClientProgressProgramControllerDeps
): Promise<void> {
  const idx = Number(acceptBtn.getAttribute("data-exmerge-accept"));
  const pair = pairs[idx];
  const card = acceptBtn.closest(".exmerge-card");
  if (!pair || !card) return;
  const restore = deps.busy(acceptBtn, "merging…");
  let result: { ok?: boolean; error?: string } | null = null;
  try {
    result = (await deps.api("/exercises/merge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: pair.from, into: pair.into }),
    })) as { ok?: boolean; error?: string } | null;
  } catch {
    result = null;
  }
  if (result?.ok) {
    deps.toast(`Merged ${pair.from} into ${pair.into}`);
    deps.invalidate("progress:program");
    card.remove();
    if (deps.state.tab === "progress") deps.renderSelf();
    return;
  }
  restore();
  deps.toast(result?.error || "Couldn't merge that — try again.");
}

// Skip just drops the card for THIS run — deliberately no server-side memory, so
// the same suggestion can resurface on the next Tidy.
function wireMergeSuggestions(
  slot: Element,
  pairs: ExerciseMergeSuggestion[],
  deps: ClientProgressProgramControllerDeps
): void {
  slot.querySelectorAll<HTMLElement>("[data-exmerge-skip]").forEach((skipBtn) => {
    skipBtn.addEventListener("click", () => {
      skipBtn.closest(".exmerge-card")?.remove();
    });
  });
  slot.querySelectorAll<HTMLElement>("[data-exmerge-accept]").forEach((acceptBtn) => {
    acceptBtn.addEventListener("click", () => {
      void acceptMergeSuggestion(acceptBtn, pairs, deps);
    });
  });
}

const CAIRN_PROGRESS_EXERCISE_SUGGESTIONS = {
  mergeSuggestionsInnerHtml,
  wireMergeSuggestions,
  wireRenameSuggestions,
};

Object.assign(globalThis, {
  CairnProgressExerciseSuggestions: CAIRN_PROGRESS_EXERCISE_SUGGESTIONS,
  mergeSuggestionsInnerHtml,
  wireMergeSuggestions,
  wireRenameSuggestions,
});
