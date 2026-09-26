// The Ask what-if ripple card's browser contracts (v2 wave 5, stream D). Kept beside
// the card, like chat-screen-types.d.ts, so the classic-script build stays import-free
// and the shared client-globals registry is not edited per stream.

type ClientWhatIfResult = import("../contracts/what-if.js").WhatIfResult;
type ClientWhatIfTone = import("../contracts/today-stones.js").TodayStoneTone;

/** One stone in the card: the server's words verbatim, the tone clamped to the reading layer's three. */
type ClientRippleStone = {
  key: string;
  label: string;
  direction: "helps" | "costs" | "steady" | "mixed";
  confidence: "likely" | "possible" | "unsure";
  why: string;
  before: { word: string; tone: ClientWhatIfTone };
  after: { word: string; tone: ClientWhatIfTone };
  /** The team expects this stone to move (any direction but steady). */
  moved: boolean;
};

type ClientRippleAnswer = {
  question: string;
  summary: string;
  kind: "training" | "nutrition" | "goal" | "other";
  /** Server-computed: "Do it" can hand this to the team as a draft. */
  doable: boolean;
  /** Server-computed: the words carry a clinical signal, so it waits on the athlete. */
  clinical: boolean;
  stones: ClientRippleStone[];
};

/** How the team took a "Do it" — a framing of the server's routed result, never a decision of its own. */
type ClientRippleHanded = {
  state: "landed" | "lands" | "waiting" | "clinician" | "already" | "refused";
  line: string;
  /** The durable brain_decisions id, when the policy recorded one (its row carries the Undo). */
  decisionId: number | null;
  proposalId: number | null;
};

type ClientRippleCardStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type ClientRippleCardDeps = {
  api(path: string, init?: RequestInit & { headers?: Record<string, string> }): Promise<unknown>;
  toast(message: string, options?: { action?: string; onAction?: () => void }): void;
  openJobStream(
    jobId: string | number,
    handlers: {
      guard?: () => boolean;
      onPhase?: (job: import("../contracts/client-api.js").ClientAgentJob | null) => unknown;
      onDone?: (result: unknown) => unknown;
      onError?: (error?: unknown) => unknown;
      onCanceled?: () => unknown;
    }
  ): void;
  reducedMotion(): boolean;
  /** Open the team's record of changes (ask/changes). */
  openChanges(): void;
  /** Hand the question to the ordinary chat composer, unsent, to talk it through. */
  talkItThrough(question: string): void;
  /** The thread is still on screen (a navigation or re-render makes a late answer stale). */
  isLive(): boolean;
  /** Drop cached reads a landed change makes stale (the Changes feed, the plan). */
  invalidate?(key: string): void;
  /** Where the card remembers its what-if across a re-render (per-viewer convenience). */
  storage?: ClientRippleCardStorage | null;
  /** The thread emptied again after "Not now": put its starter chips back. */
  restoreEmpty?(log: HTMLElement): void;
};

interface Window {
  CairnRippleCardModel: {
    answer(result: unknown): ClientRippleAnswer | null;
    handed(result: unknown): ClientRippleHanded;
    findChange(
      read: unknown,
      decisionId: number | null
    ): import("../contracts/brain-changes.js").ClientBrainChange | null;
    question(raw: unknown): string;
    questionBody(raw: unknown): string;
  };
  CairnRippleCard: {
    askHtml(opts?: { draft?: string }): string;
    captionFor(phase?: unknown): string;
    thinkingHtml(question: string, phase?: string | null): string;
    answerHtml(answer: ClientRippleAnswer, opts?: { enter?: boolean }): string;
    failedHtml(question: string, message?: string | null): string;
    handedHtml(
      handed: ClientRippleHanded,
      row?: import("../contracts/brain-changes.js").ClientBrainChange | null
    ): string;
    stonesHtml(stones: ClientRippleStone[]): string;
  };
  CairnRippleCardController: {
    STORAGE_KEY: string;
    open(log: HTMLElement, deps: ClientRippleCardDeps, opts?: { draft?: string }): HTMLElement | null;
    resume(log: HTMLElement, deps: ClientRippleCardDeps): Promise<HTMLElement | null>;
    reattach(log: HTMLElement): boolean;
  };
}
declare const CairnRippleCardModel: Window["CairnRippleCardModel"];
declare const CairnRippleCard: Window["CairnRippleCard"];
declare const CairnRippleCardController: Window["CairnRippleCardController"];
