// The what-if contract (v2 wave 5, "Ask").
//
// The athlete asks a hypothetical in their own words ("what if I ran four days a week
// instead of three?"). The team answers with ONE proposed change and its ripple across
// the six stones (src/contracts/today-stones.ts): for each stone, which way it would
// likely move, one plain line of why, and how sure the team is, in words.
//
// Served by `POST /api/what-if` (MCP `what_if`) as a durable agent job; "Do it" is
// `POST /api/what-if/do` (MCP `what_if_do`), which hands the change to the team as a
// DRAFT through the server's autonomy policy. The what-if itself never changes
// anything, and "Do it" never applies a change on its own authority.
//
// No score anywhere: a direction is a word, a confidence is a word, and `before` is the
// stone's own server-owned word and tone from the same stones projection the pebble
// strip prints. Self-contained apart from the stone vocabulary, so src/client/** can
// read these types through `import("../contracts/what-if.js")`.
import type { TodayStoneKey, TodayStoneTone } from "./today-stones.js";

/** Which way a stone would likely move. Words, never a number. */
export const WHAT_IF_DIRECTIONS = ["helps", "costs", "steady", "mixed"] as const;
export type WhatIfDirection = (typeof WHAT_IF_DIRECTIONS)[number];

/** How sure the team is about one stone's move. Words, never a percentage. */
export const WHAT_IF_CONFIDENCE = ["likely", "possible", "unsure"] as const;
export type WhatIfConfidence = (typeof WHAT_IF_CONFIDENCE)[number];

/**
 * What kind of change the hypothetical is. Only `training` (a concrete plan edit) and
 * `nutrition` (a calorie/protein target) can be handed to the team as a draft; a goal
 * or anything else is talked through, never drafted — a goal is the athlete's to name.
 */
export const WHAT_IF_CHANGE_KINDS = ["training", "nutrition", "goal", "other"] as const;
export type WhatIfChangeKind = (typeof WHAT_IF_CHANGE_KINDS)[number];

/** The optional structured hint a surface may send alongside the words. */
export const WHAT_IF_HINT_AREAS = ["training", "endurance", "fuel", "recovery", "body"] as const;
export type WhatIfHintArea = (typeof WHAT_IF_HINT_AREAS)[number];

export interface WhatIfHint {
  area?: WhatIfHintArea;
  /** "more" or "less" of that area. */
  direction?: "more" | "less";
}

/** One plan edit, in the same shape a plan proposal's `changes[]` carries. */
export interface WhatIfPlanChange {
  day_number: number;
  exercise?: string;
  swap?: { from: string; to: string };
  remove?: boolean;
  sets?: number | null;
  rep_low?: number | null;
  rep_high?: number | null;
  target_weight?: number | null;
  target_seconds?: number | null;
  reason?: string;
}

export interface WhatIfChange {
  kind: WhatIfChangeKind;
  /** The change in plain words, athlete-facing. */
  summary: string;
  /** Present only for `training`: the concrete edits "Do it" would draft. */
  changes?: WhatIfPlanChange[];
  /** Present only for `nutrition`: the target "Do it" would draft. */
  nutrition?: { target_kcal: number | null; protein_g: number | null };
  /** Server-computed: whether "Do it" can hand this to the team as a draft. */
  doable: boolean;
  /**
   * Server-computed: the words carry a clinical signal (an injury, imaging, a
   * clinician). "Do it" then always waits on the athlete, clinician-directed.
   */
  clinical: boolean;
}

export interface WhatIfRippleEffect {
  stone: TodayStoneKey;
  /** The stone's name ("Strength"). */
  label: string;
  direction: WhatIfDirection;
  /** One plain athlete-facing line. */
  why: string;
  confidence: WhatIfConfidence;
  /** Where the stone stands today — the server's own word and tone. */
  before: { word: string; tone: TodayStoneTone };
}

export interface WhatIfResult {
  ok: true;
  date: string;
  question: string;
  change: WhatIfChange;
  /** Always all six stones, in stone order. */
  ripple: WhatIfRippleEffect[];
  /** "agent" for a team read, "deterministic" for the offline floor. */
  source: "agent" | "deterministic";
  agent: string | null;
  tried: { agent: string; error: string }[];
}
