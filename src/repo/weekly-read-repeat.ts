// Weekly-read repeat detection: a weekly read that would say the same as last
// week says so in ONE calm line ("Same picture as last week — …") instead of
// repeating itself. Pull, never push: the line waits in-app exactly like a full
// read, and no number from the comparison is ever shown.
//
// The comparison is DETERMINISTIC and runs over the read's STRUCTURED content —
// never over a sliced string:
//   - headline: the stopword-trimmed word SET of the read's `text` (how the week went)
//   - move:     the word set of the ONE change the card shows (`next_step`, else the
//               milestone step folded the way the card prints it)
//   - milestone: the word set of the named milestone, when the read named one
// plus the week's discrete PICTURE, taken from the freshness signature
// (computeWeeklyReadSignature): the active directive set, the newest lab date and
// the newest context event. New labs, a new or closed finding, or a new trip is
// never "the same picture", whatever the prose says.
//
// A read is a REPEAT of last week's only when every slot holds:
//   - headline word-overlap (Jaccard) >= WEEKLY_READ_REPEAT_THRESHOLD
//   - move: both empty, or overlap >= WEEKLY_READ_REPEAT_THRESHOLD (one side with a
//     change and the other without is a change)
//   - milestone: compared only when both sides named one; overlap >= the threshold
//   - picture: unchanged (skipped only when last week's picture was never recorded)
// The threshold is 0.5 — looser than the 0.7 connection-insight text guard, because
// a model re-telling the same week rephrases it; tighter than that would call
// every paraphrase "new". The overlap stays internal, never surfaced.
//
// "Last week" is the newest weekly read written BEFORE this local week's Monday
// and no more than LAST_WEEK_MAX_AGE_DAYS old; anything older (a gap) or nothing at
// all (the first week) gets a full read. A read last week that the athlete
// thumbed DOWN is never carried forward as "the same picture" — the full path and
// its downvote-aware text guard answer instead.
import { db } from "../db.js";
import { daysBetweenISO, mondayOf } from "../lib/dates.js";
import { getAppState, setAppState } from "./app-state.js";
import { addInsight, computeWeeklyReadSignature, DOWNVOTED_DEDUP_LIMIT, stampWeeklyReadFreshness } from "./insights.js";
import { jaccard, memNorm } from "./memory.js";
import { localDateISO, localDayOfStamp } from "./shared.js";

export const WEEKLY_READ_REPEAT_THRESHOLD = 0.5;
export const LAST_WEEK_MAX_AGE_DAYS = 13;
export const REPEAT_LINE_LEAD = "Same picture as last week";

// Words that carry no picture of the week. Kept local: the memory fold's list is
// tuned for remembered preferences, not for a read of the week.
const READ_STOPWORDS = new Set(
  (
    "a an and are as at be been but by for from had has have i in is it its of on or so " +
    "that the their this to was were with you your yours week weeks another again still"
  ).split(" ")
);

export interface WeeklyReadCandidate {
  text?: unknown;
  rationale?: unknown;
  next_step?: unknown;
  milestone_step?: unknown;
}

export interface WeeklyReadContent {
  headline: string[];
  move: string[];
  milestone: string[] | null;
}

export interface WeeklyReadPicture {
  directive_keys: string[];
  latest_doc_date: string | null;
  latest_context_event_id: number | null;
}

export interface WeeklyReadComparison {
  repeat: boolean;
  // Which slots moved, in plain slot names — the evidence for the verdict.
  changed: Array<"headline" | "move" | "milestone" | "picture">;
}

export type WeeklyReadPlan =
  | {
      mode: "repeat";
      repeat_of: number;
      text: string;
      rationale: null;
      next_step: null;
      // The FULL read this one matched (carried forward so a run of same weeks is
      // always compared with the words last actually said, never a drifting chain).
      content: WeeklyReadContent;
      picture: WeeklyReadPicture;
    }
  | {
      mode: "full";
      reason: "first_week" | "changed" | "declined_last_week";
      text: string;
      rationale: string | null;
      next_step: string | null;
      content: WeeklyReadContent;
      picture: WeeklyReadPicture;
    };

function str(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function terms(value: unknown): string[] {
  return [...new Set(memNorm(str(value)).split(" "))].filter((w) => w && !READ_STOPWORDS.has(w)).sort();
}

function milestoneParts(value: unknown): { milestone: string; step: string } | null {
  const o = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  const step = str(o?.step);
  if (!step) return null;
  return { milestone: str(o?.milestone), step };
}

// The one change the card prints: the week's own next_step, else the milestone step
// ("Toward <milestone>: <step>"). The same fold generateInsight stores.
function milestoneStepText(value: unknown): string | null {
  const ms = milestoneParts(value);
  if (!ms) return null;
  return ms.milestone ? `Toward ${ms.milestone}: ${ms.step}` : ms.step; // addInsight caps it on a word boundary
}

export function weeklyReadMove(c: WeeklyReadCandidate): string | null {
  return str(c.next_step) || milestoneStepText(c.milestone_step);
}

export function weeklyReadContent(c: WeeklyReadCandidate): WeeklyReadContent {
  const ms = milestoneParts(c.milestone_step);
  return {
    headline: terms(c.text),
    move: terms(weeklyReadMove(c)),
    milestone: ms?.milestone ? terms(ms.milestone) : null,
  };
}

function overlap(a: string[], b: string[]): number {
  return jaccard(new Set(a), new Set(b));
}

function samePicture(prev: WeeklyReadPicture, cur: WeeklyReadPicture): boolean {
  const keys = (k: unknown) => JSON.stringify((Array.isArray(k) ? k.map(String) : []).sort());
  return (
    keys(prev.directive_keys) === keys(cur.directive_keys) &&
    str(prev.latest_doc_date) === str(cur.latest_doc_date) &&
    Number(prev.latest_context_event_id ?? 0) === Number(cur.latest_context_event_id ?? 0)
  );
}

export function compareWeeklyReads(
  prev: { content: WeeklyReadContent; picture: WeeklyReadPicture | null },
  next: { content: WeeklyReadContent; picture: WeeklyReadPicture }
): WeeklyReadComparison {
  const changed: WeeklyReadComparison["changed"] = [];
  const t = WEEKLY_READ_REPEAT_THRESHOLD;
  if (!next.content.headline.length || overlap(prev.content.headline, next.content.headline) < t) {
    changed.push("headline");
  }
  const pm = prev.content.move;
  const nm = next.content.move;
  if (pm.length !== 0 || nm.length !== 0) {
    if (!pm.length || !nm.length || overlap(pm, nm) < t) changed.push("move");
  }
  if (prev.content.milestone && next.content.milestone && overlap(prev.content.milestone, next.content.milestone) < t) {
    changed.push("milestone");
  }
  if (prev.picture && !samePicture(prev.picture, next.picture)) changed.push("picture");
  return { repeat: changed.length === 0, changed };
}

function sentence(s: string): string {
  const t = s.trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

// The ONE calm line. It names the one change still standing (so nothing the full
// read offered is lost) and nothing else — no rationale, no second line.
export function weeklyReadRepeatLine(c: WeeklyReadCandidate): string {
  const next = str(c.next_step);
  if (next) return `${REPEAT_LINE_LEAD} — the one change still worth considering: ${sentence(next)}`;
  const ms = milestoneParts(c.milestone_step);
  if (ms?.milestone) return `${REPEAT_LINE_LEAD} — still one step toward ${ms.milestone}: ${sentence(ms.step)}`;
  if (ms) return `${REPEAT_LINE_LEAD} — the one step still stands: ${sentence(ms.step)}`;
  return `${REPEAT_LINE_LEAD} — nothing new worth changing.`;
}

export function currentWeeklyReadPicture(): WeeklyReadPicture {
  const sig = computeWeeklyReadSignature();
  return {
    directive_keys: sig.directive_keys,
    latest_doc_date: sig.latest_doc_date,
    latest_context_event_id: sig.latest_context_event_id,
  };
}

// ---- what each stored weekly read said, in structured form ----
// A small bounded ledger in app_state keyed by insight id. A repeat row stores the
// content of the full read it matched (its basis), plus the picture at ITS OWN
// writing. Rows written before this ledger existed derive their content from their
// columns (text + the stored one change) and carry no picture.
const CONTENT_KEY = "weekly_read_content";
const CONTENT_LEDGER_LIMIT = 8;

interface ContentEntry {
  insight_id: number;
  repeat: boolean;
  content: WeeklyReadContent;
  picture: WeeklyReadPicture | null;
}

function readLedger(): ContentEntry[] {
  try {
    const v = JSON.parse(getAppState(CONTENT_KEY) || "[]");
    return Array.isArray(v) ? v.filter((e) => e && Number.isFinite(Number(e.insight_id)) && e.content) : [];
  } catch {
    return [];
  }
}

function recordLedger(entry: ContentEntry): void {
  try {
    const rest = readLedger().filter((e) => Number(e.insight_id) !== entry.insight_id);
    setAppState(CONTENT_KEY, JSON.stringify([entry, ...rest].slice(0, CONTENT_LEDGER_LIMIT)));
  } catch {
    /* the ledger never blocks a read being stored */
  }
}

export interface PreviousWeeklyRead {
  id: number;
  feedback: string | null;
  repeat: boolean;
  content: WeeklyReadContent;
  picture: WeeklyReadPicture | null;
}

// Last week's read: the newest weekly_read row (any status — a dismissed read was
// still said) written before this local week's Monday, within the age cap.
export function previousWeeklyRead(today: string = localDateISO()): PreviousWeeklyRead | null {
  const weekStart = mondayOf(today);
  const rows = db
    .prepare(
      `SELECT id, created_at, text, next_step, feedback FROM insights
        WHERE kind = 'weekly_read' ORDER BY id DESC LIMIT 20`
    )
    .all() as any[];
  const row = rows.find((r) => {
    const day = localDayOfStamp(r.created_at);
    return day != null && day < weekStart;
  });
  if (!row) return null;
  const age = daysBetweenISO(today, localDayOfStamp(row.created_at) as string);
  if (age == null || age > LAST_WEEK_MAX_AGE_DAYS) return null;
  const id = Number(row.id);
  const entry = readLedger().find((e) => Number(e.insight_id) === id);
  return {
    id,
    feedback: row.feedback ?? null,
    repeat: !!entry?.repeat,
    content: entry?.content ?? weeklyReadContent({ text: row.text, next_step: row.next_step }),
    picture: entry?.picture ?? null,
  };
}

// Decide what this week's read says. Null when the candidate carries no read at all
// (found:false / no text) — that stays the designed silence upstream.
export function planWeeklyRead(c: WeeklyReadCandidate, today: string = localDateISO()): WeeklyReadPlan | null {
  const text = str(c.text);
  if (!text) return null;
  const content = weeklyReadContent(c);
  const picture = currentWeeklyReadPicture();
  const full = (reason: "first_week" | "changed" | "declined_last_week"): WeeklyReadPlan => ({
    mode: "full",
    reason,
    text,
    rationale: str(c.rationale) || null,
    next_step: weeklyReadMove(c),
    content,
    picture,
  });
  const prev = previousWeeklyRead(today);
  if (!prev) return full("first_week");
  if (prev.feedback === "down") return full("declined_last_week");
  const cmp = compareWeeklyReads(prev, { content, picture });
  if (!cmp.repeat) return full("changed");
  return {
    mode: "repeat",
    repeat_of: prev.id,
    text: weeklyReadRepeatLine(c),
    rationale: null,
    next_step: null,
    content: prev.content,
    picture,
  };
}

// Store the planned read, record what it said, and stamp its freshness signature.
export function storeWeeklyRead(plan: WeeklyReadPlan) {
  const insight = addInsight({
    kind: "weekly_read",
    text: plan.text,
    rationale: plan.rationale,
    next_step: plan.next_step,
    status: "new",
    intent_key: null,
  }) as any;
  const id = Number(insight?.id);
  if (Number.isFinite(id)) {
    recordLedger({ insight_id: id, repeat: plan.mode === "repeat", content: plan.content, picture: plan.picture });
    stampWeeklyReadFreshness(id);
  }
  return insight;
}

// The text guard's corpus for a FULL weekly read: the recent insight texts minus
// earlier weeks' weekly reads (whether this week repeats last week is answered by
// the structured comparison above, never by the word guard), keeping this week's
// own reads and every downvoted text so a waved-off read is not said again.
export function weeklyReadGuardTexts(limit = 12, today: string = localDateISO()): string[] {
  const weekStart = mondayOf(today);
  const recent = (
    db.prepare(`SELECT kind, text, created_at FROM insights ORDER BY id DESC LIMIT ?`).all(limit) as any[]
  )
    .filter((r) => {
      if (r.kind !== "weekly_read") return true;
      const day = localDayOfStamp(r.created_at);
      return day == null || day >= weekStart;
    })
    .map((r) => str(r.text))
    .filter(Boolean);
  const downvoted = (
    db
      .prepare(`SELECT text FROM insights WHERE feedback = 'down' ORDER BY id DESC LIMIT ?`)
      .all(DOWNVOTED_DEDUP_LIMIT) as any[]
  )
    .map((r) => str(r.text))
    .filter(Boolean);
  return [...new Set([...recent, ...downvoted])];
}
