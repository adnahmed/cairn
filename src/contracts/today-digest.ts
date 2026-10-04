// The overnight digest contract (the Today redesign, "What the team did").
//
// What the team changed lately, ONE row per lift: which way it moved, a short reason,
// and the prescription before → after in its own units, with the server-owned Undo of
// the decision behind it. A held draft the team set aside is not here: that is
// housekeeping, carried as a quiet line in Ask › Changes (`ClientBrainChanges.set_aside`).
// A projection over the Changes feed
// (src/domain/brain/changes-feed.ts) and the decisions it reads — it decides nothing.
//
// Served by `GET /api/today-digest` (`get_today_digest`) and the `/today` fan-in. No
// score, no grade: values are loads, reps, sets and seconds.
//
// Self-contained on purpose: src/client/** reads these types through
// `import("../contracts/today-digest.js")`, and this module imports nothing.

export type TodayDigestDirection = "up" | "down" | "same" | "range" | "added";

export interface TodayDigestMove {
  exercise: string;
  direction: TodayDigestDirection;
  /** The prescription before, in words with its unit ("205 lb", "6–8 reps"); null when unknown or nothing moved. */
  from_text: string | null;
  /** The prescription after ("210 lb", "+1 rep", "4 sets", "185 lb"). */
  to_text: string;
  /** The change's own item reason, in the athlete register; null when none was written. */
  reason: string | null;
}

export interface TodayDigestChange {
  /** The `brain_decisions` id — what Undo posts to `/api/brain/decisions/:id/revert`. */
  id: number;
  state: "announced" | "applied";
  /** The Changes feed's finished title ("Raised your targets on 3 lifts"). */
  title: string;
  /** "Landed today", "Lands Monday" — the feed's own timing line. */
  status_line: string;
  /** Per-lift rows; empty for a change that is not about lifts (a calorie target). */
  moves: TodayDigestMove[];
  undo: { available: boolean; label: string | null };
  new: boolean;
}

export interface TodayDigest {
  as_of: string;
  /** "Overnight", "Since you last looked", or "Lately". */
  when: string;
  /** "3 lifts moved" / "2 changes" (the mast reads "Overnight · 3 lifts moved"); null when nothing changed. */
  headline: string | null;
  /**
   * Every row the qualifying changes take in full (one per lift, one per change about
   * no lift), counted past the capped `changes` list — what "+N more in Changes" is
   * measured against.
   */
  total_rows: number;
  changes: TodayDigestChange[];
}
