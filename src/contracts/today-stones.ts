// The stones contract (v2 wave 4, "The race horizon, then the pebbles").
//
// Six athlete-facing stones — Strength, Endurance, Fuel, Recovery, Body, Heart — each
// ONE plain word (or two) about where that part of the picture stands today. The
// server projects the five signal dimensions (src/repo/signal-state.ts) and the
// domain reads (today's lift, the race build, today's intake, the weight trend, the
// lab read) onto them in src/domain/today/today-stones.ts; a renderer prints the word,
// maps the tone to a class and never works a word out itself.
//
// Served by `GET /api/today/stones` (`get_today_stones`). No score and no number that
// grades: a stone is words plus a tone. A part of the picture with no fresh signal
// reads "quiet" — never "low" — and nothing here asks for a tap.
//
// Self-contained apart from the route vocabulary: src/client/** can read these types
// through `import("../contracts/today-stones.js")`.
import type { ClientRouteSection, ClientTabName } from "./client-routes.js";

/** The six stones, in the order they are always returned. */
export type TodayStoneKey = "strength" | "endurance" | "fuel" | "recovery" | "body" | "heart";

/**
 * The reading layer's own tone words (DESIGN.md "Reading layer primitives"): `ok` sage,
 * `watch` terracotta — attention or a lever, never punishment — and `quiet` the neutral
 * outline for thin or absent data. No colours travel in the DTO.
 */
export type TodayStoneTone = "ok" | "watch" | "quiet";

/** The existing surface a stone opens: a route the client already knows. */
export interface TodayStoneTarget {
  tab: ClientTabName;
  section: ClientRouteSection | null;
}

export interface TodayStone {
  key: TodayStoneKey;
  /** The stone's name ("Strength"), for the label under the pebble and its aria text. */
  label: string;
  /** One or two plain words, finished on the server ("steady", "in progress", "quiet"). */
  word: string;
  /**
   * The same word as ONE word ("go gently" → "gently"), for a label that must sit on
   * one line under a pebble at phone width. Null only when no one-word form exists;
   * a renderer then prints `word`.
   */
  short: string | null;
  tone: TodayStoneTone;
  /** One short athlete-facing sentence, or null when the word says it all. */
  line: string | null;
  target: TodayStoneTarget;
}

export interface TodayStonesRead {
  date: string;
  /** Always all six, always in TodayStoneKey order. */
  stones: TodayStone[];
}
