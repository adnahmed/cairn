// @ts-check
// Progress program-block card and controls.

type ClientProgramBlock = import("../contracts/client-api.js").ClientProgramBlock;
type ClientProgramBlockFocus = import("../contracts/client-api.js").ClientProgramBlockFocus;

function blockFocusWord(focus: ClientProgramBlockFocus | unknown): string {
  if (focus === "strength") return "Strength";
  if (focus === "hypertrophy") return "Hypertrophy";
  if (focus === "endurance-base") return "Endurance base";
  if (focus === "peak") return "Peak";
  return focus ? String(focus) : "";
}

function activeBlockHtml(block: ClientProgramBlock | null | undefined): string {
  if (!block) return "";
  const b = block;
  const meta = [blockFocusWord(b.focus), phaseWord(b.phase)].filter(Boolean).join(" · ");
  return `<div class="pblock pblock-active">
    <div class="pblock-head">
      <span class="pblock-kicker lbl">Current block</span>
      <span class="pblock-week lbl">week ${Number(b.week_index)} of ${Number(b.total_weeks)}</span>
    </div>
    <div class="pblock-goal">${escHtml(b.goal || "Training block")}</div>
    ${meta ? `<div class="pblock-meta lbl">${escHtml(meta)}</div>` : ""}
    <div class="pblock-actions">
      <button class="pillbtn" type="button" data-blockadvance="${escAttr(b.id)}">Advance week</button>
      <button class="pillbtn" type="button" data-blockcomplete="${escAttr(b.id)}">Complete</button>
    </div>
  </div>`;
}

function startBlockHtml(): string {
  return `<div class="pblock">
    <button class="linkbtn" type="button" data-blockstart>+ Start a training block</button>
    <div class="pblock-composer" hidden>
      <input class="pblock-goal-in" type="text" autocomplete="off" placeholder="goal — e.g. Build squat + 10k base" aria-label="Block goal">
      <div class="pblock-composer-row">
        <select class="pblock-focus-in" aria-label="Focus">
          <option value="strength">Strength</option>
          <option value="hypertrophy">Hypertrophy</option>
          <option value="endurance-base">Endurance base</option>
          <option value="peak">Peak</option>
        </select>
        <input class="pblock-weeks-in" type="number" inputmode="numeric" min="2" max="12" value="5" aria-label="Weeks">
        <span class="lbl">weeks</span>
        <button class="pillbtn pill-accent" type="button" data-blockcreate>Start</button>
      </div>
    </div>
  </div>`;
}

type ProgramBlockMountDeps = {
  api(path: string, init?: RequestInit & { headers?: Record<string, string> }): Promise<unknown>;
  toast(message: string): void;
  armDelete(btn: Element, onConfirm: () => unknown): void;
  /** Repaint the block card after a write landed. */
  refresh(): void;
};

async function loadProgramBlock(): Promise<void> {
  const slot = view.querySelector("#progBlockSlot");
  if (!slot) return;
  let block: ClientProgramBlock | null = null;
  try {
    block = await api("/program/blocks/active");
  } catch {
    return;
  }
  if (state.tab !== "progress" || !slot.isConnected) return;
  slot.innerHTML = block ? activeBlockHtml(block) : startBlockHtml();
  mountProgramBlock(slot, {
    api,
    toast,
    armDelete,
    refresh: () => {
      swrInvalidate("plan:coach");
      loadProgramBlock();
    },
  });
}

// Wires the block card painted into `slot` through one delegated click listener.
// Re-mounting on the same slot (every repaint does) replaces the previous listener.
function mountProgramBlock(slot: Element, deps: ProgramBlockMountDeps): () => void {
  const post = async (path: string, okMsg: string): Promise<void> => {
    try {
      const result = (await deps.api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })) as {
        error?: unknown;
      } | null;
      if (result?.error) {
        deps.toast("Couldn't update the block");
        return;
      }
      if (okMsg) deps.toast(okMsg);
      deps.refresh();
    } catch {
      deps.toast("Couldn't update the block");
    }
  };
  const create = async (): Promise<void> => {
    const goal = ((slot.querySelector(".pblock-goal-in") as HTMLInputElement | null)?.value || "").trim();
    const focus = (slot.querySelector(".pblock-focus-in") as HTMLSelectElement | null)?.value || "strength";
    const total_weeks = Number((slot.querySelector(".pblock-weeks-in") as HTMLInputElement | null)?.value) || 5;
    try {
      const result = (await deps.api("/program/blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: goal || "Training block", focus, total_weeks }),
      })) as ClientProgramBlock | null;
      if (result?.id) {
        deps.toast("Block started — the coach will periodize toward it");
        deps.refresh();
      } else {
        deps.toast("Couldn't start the block");
      }
    } catch {
      deps.toast("Couldn't start the block");
    }
  };
  return CairnUiActions.mount(slot, "pblock", ({ delegate }) => {
    delegate("click", {
      blockstart: () => {
        const composer = slot.querySelector(".pblock-composer") as HTMLElement | null;
        if (composer) {
          composer.hidden = false;
          (slot.querySelector(".pblock-goal-in") as HTMLInputElement | null)?.focus();
        }
      },
      blockcreate: () => create(),
      blockadvance: (button) => post(`/program/blocks/${button.dataset.blockadvance}/advance`, "Moved to the next week"),
      blockcomplete: (button) =>
        deps.armDelete(button, () => post(`/program/blocks/${button.dataset.blockcomplete}/complete`, "Block completed")),
    });
  });
}

const CAIRN_PROGRESS_PROGRAM_BLOCK = {
  blockFocusWord,
  activeBlockHtml,
  startBlockHtml,
  loadProgramBlock,
  mountProgramBlock,
};

Object.assign(globalThis, {
  CairnProgressProgramBlock: CAIRN_PROGRESS_PROGRAM_BLOCK,
  blockFocusWord,
  activeBlockHtml,
  startBlockHtml,
  loadProgramBlock,
});

if (typeof window !== "undefined") {
  Object.assign(window, {
    CairnProgressProgramBlock: CAIRN_PROGRESS_PROGRAM_BLOCK,
    blockFocusWord,
    activeBlockHtml,
    startBlockHtml,
    loadProgramBlock,
  });
}
