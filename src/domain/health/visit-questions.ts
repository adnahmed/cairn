// Visit questions — what to raise at the next visit, proposed from what the team already
// knows, for the athlete to keep, drop or add to.
//
// Two sources, each read once and never re-derived here:
//   - the DOCTOR LOOP (`doctorLoopRead`, src/repo/doctor-loop.ts): every open follow-up
//     already folded to one item per panel / marker / review wording, so each follow-up
//     proposes ONE question. Only follow-ups due now or opening within the next-checkup
//     horizon are asked about — a surveillance row a year out is not a question for this
//     visit. Up to two worth-adding workups ride after them.
//   - WAITING CLINICAL ASKS (`awaitingBrainDecisions`, src/repo/brain-decisions.ts): a
//     decision the team holds for the athlete and their doctor (`for_clinician`), whose
//     sentence was written for a person — printed as written.
//
// Edits are NOT stored. The athlete's final list travels with the packet request
// (`?questions=` on /api/health-report*, `questions` on get_health_report) and is used
// verbatim; with no list sent, the proposals stand. No store for personal packet edits
// exists, and one list typed for one visit is not durable state worth a table.
//
// Informational, never medical advice: a question is something to ask, never a verdict.

import { awaitingBrainDecisions } from "../../repo/brain-decisions.js";
import { doctorLoopRead } from "../../repo/doctor-loop.js";
import type { DoctorLoopItem } from "../../repo/doctor-loop-items.js";
import { localDateISO } from "../../repo/shared.js";
import { daysBetweenISO, isoDate } from "../../lib/dates.js";
import type { ClientVisitQuestion, ClientVisitQuestionsRead } from "../../contracts/health-records.js";

export type VisitQuestion = ClientVisitQuestion;
export type VisitQuestionsRead = ClientVisitQuestionsRead;

// The same horizon the next-checkup read calls "upcoming" (src/repo/next-checkup.ts).
export const VISIT_QUESTION_HORIZON_DAYS = 180;
export const VISIT_QUESTION_LIMIT = 8;
export const VISIT_QUESTION_MAX_CHARS = 280;
const WORKUP_QUESTION_LIMIT = 2;

export const VISIT_QUESTIONS_FRAME =
  "Questions to bring to the next visit, drawn from the follow-ups Cairn is keeping and anything the team is holding for your doctor. Keep, drop or add your own. Informational, not medical advice.";

// The calendar day a stored date or timestamp names, validated.
const dayOf = (value: unknown): string | null => isoDate(String(value ?? "").slice(0, 10));

function clean(value: unknown, max = VISIT_QUESTION_MAX_CHARS): string {
  const s = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

// One follow-up, one question — worded by the kind of follow-up it is.
function loopQuestionText(item: DoctorLoopItem): string {
  const label = clean(item.label, 160);
  if (item.kind === "dexa") return "Is it time for a repeat body-composition (DEXA) scan?";
  if (item.kind === "review") return `The last health review suggested "${label}" — is now a good time for it?`;
  return `Is it time to recheck ${label}?`;
}

// The follow-up's reason as the athlete reads it. The doctor loop stores a machine-register
// reason that leads with a status clause ("<marker> is outside its optimal/lab range; " or
// "... is under an active follow-up lever; ") — one phrase that merges the lab's flag with
// the optimal band, which the athlete-facing surfaces keep as two separate marks. The
// question already names the marker, so the basis keeps only the plain policy sentence,
// cased as written (it may open on a marker name such as "hs-CRP").
const LOOP_STATUS_CLAUSE = /^[^;]{1,160}? is (?:outside its optimal\/lab range|under an active follow-up lever);\s*/i;

function loopBasis(reason: unknown): string | null {
  return clean(reason, 400).replace(LOOP_STATUS_CLAUSE, "") || null;
}

function withinHorizon(item: DoctorLoopItem, asOf: string): boolean {
  if (item.due) return true;
  if (!item.next_due) return false;
  const days = daysBetweenISO(item.next_due, asOf);
  return days != null && days > 0 && days <= VISIT_QUESTION_HORIZON_DAYS;
}

/**
 * The proposed questions for the next visit. READ-ONLY: the doctor loop is read as the
 * nightly pass left it (pass `refresh` to run the deterministic attention pass first,
 * as the explicit packet actions do).
 */
export function visitQuestionsRead(opts: { asOf?: string; refresh?: boolean } = {}): VisitQuestionsRead {
  const asOf = dayOf(opts.asOf) ?? localDateISO();
  const out: VisitQuestion[] = [];
  const seenText = new Set<string>();
  const push = (q: VisitQuestion) => {
    const key = q.text.toLowerCase();
    if (!q.text || seenText.has(key) || out.length >= VISIT_QUESTION_LIMIT) return;
    seenText.add(key);
    out.push(q);
  };

  // Clinical asks first: the team is already holding these for a doctor.
  try {
    for (const d of awaitingBrainDecisions(20)) {
      if (!d.for_clinician || !d.explanation) continue;
      push({ id: `ask:${d.id}`, text: clean(d.explanation), source: "clinical_ask", basis: null });
    }
  } catch {
    /* the ledger is optional context; the loop still speaks */
  }

  let loop: ReturnType<typeof doctorLoopRead> | null = null;
  try {
    loop = doctorLoopRead({ refresh: !!opts.refresh, asOf });
  } catch {
    loop = null;
  }
  if (loop) {
    // Each follow-up once (the loop is already collapsed), due ones first — the loop's
    // own order is soonest-first, then clinical panel order.
    const open = loop.attention.filter((item) => withinHorizon(item, asOf));
    const ordered = [...open.filter((i) => i.due), ...open.filter((i) => !i.due)];
    const seenKey = new Set<string>();
    for (const item of ordered) {
      if (seenKey.has(item.key)) continue;
      seenKey.add(item.key);
      push({
        id: `loop:${item.key}`,
        text: loopQuestionText(item),
        source: "doctor_loop",
        basis: loopBasis(item.reason),
      });
    }
    for (const w of loop.missing_workup.slice(0, WORKUP_QUESTION_LIMIT)) {
      push({
        id: `workup:${w.key}`,
        text: `Worth adding ${clean(w.label, 120)} to the next draw?`,
        source: "missing_workup",
        basis: clean(w.reason, 400) || null,
      });
    }
  }

  return { as_of: asOf, questions: out, frame: VISIT_QUESTIONS_FRAME };
}

/**
 * The athlete's final list, as sent with a packet request. `undefined` means "not sent"
 * (the proposals stand); a sent list — even an empty one — replaces them. Blank lines are
 * dropped, each question is capped, and the list is capped at twice the proposal limit.
 */
export function parseVisitQuestionList(raw: unknown): string[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  const list = Array.isArray(raw) ? raw : [raw];
  const out: string[] = [];
  for (const entry of list) {
    if (typeof entry !== "string") continue;
    const text = clean(entry);
    if (text) out.push(text);
    if (out.length >= VISIT_QUESTION_LIMIT * 2) break;
  }
  return out;
}

/**
 * The questions a packet prints: the athlete's own list when one was sent (in their
 * order, marked `athlete` unless it matches a proposal word for word), else the proposals.
 */
export function resolveVisitQuestions(
  finalList: string[] | undefined,
  opts: { asOf?: string; refresh?: boolean } = {}
): VisitQuestion[] {
  const proposed = visitQuestionsRead(opts).questions;
  const list = parseVisitQuestionList(finalList);
  if (list === undefined) return proposed;
  const byText = new Map(proposed.map((q) => [q.text.toLowerCase(), q]));
  const seen = new Set<string>();
  const out: VisitQuestion[] = [];
  list.forEach((text, index) => {
    const key = text.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const match = byText.get(key);
    out.push(match ?? { id: `custom:${index + 1}`, text, source: "athlete", basis: null });
  });
  return out;
}
