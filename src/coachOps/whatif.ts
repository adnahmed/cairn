// The what-if (v2 wave 5, "Ask"): the athlete asks a hypothetical in their own words,
// and the team answers with ONE proposed change and its ripple across the six stones.
//
// Two ops, deliberately separate:
//
//   whatIf()   — a READ. It runs one agent turn over the projected coach context (the
//                `what_if` prompt site) under an enforced schema, and returns
//                {ok, change, ripple[]}. It NEVER writes: no proposal, no ledger row, no
//                cache entry. A dead rotation is the designed {ok:false, error, tried}.
//   whatIfDo() — the "Do it" hand-off. It re-validates the change server-side (never
//                trusting the client's echo), writes it as a DRAFT plan proposal, and
//                routes that draft through the ONE autonomy policy
//                (applyProposalWithAutonomy → decideAutonomyTier). It never applies on
//                its own authority: the policy decides the tier, and
//                  - anything clinical is held clinician-directed (the chat detector, now
//                    shared, reads the athlete's words and the change itself);
//                  - a calorie/protein target always waits on the athlete — the what-if
//                    did not run the check-in's protective caps, so the team never lands
//                    that number on its own;
//                  - a goal (or anything without a concrete edit) is never drafted at
//                    all — a goal is the athlete's to name, in their own words.
//
// The `stub` agent is the offline smoke path, as it is for propose/apply: its canned
// reply is proposal-shaped, so asking it for a what-if answers from a small authored
// table instead (whatIfFloor), deterministically and with no spawn.
import { isWhatIfResult, WHAT_IF_SCHEMA } from "../agent-contracts.js";
import {
  WHAT_IF_CHANGE_KINDS,
  WHAT_IF_CONFIDENCE,
  WHAT_IF_DIRECTIONS,
  WHAT_IF_HINT_AREAS,
  type WhatIfChange,
  type WhatIfChangeKind,
  type WhatIfConfidence,
  type WhatIfDirection,
  type WhatIfHint,
  type WhatIfPlanChange,
  type WhatIfResult,
  type WhatIfRippleEffect,
} from "../contracts/what-if.js";
import type { TodayStone, TodayStoneKey } from "../contracts/today-stones.js";
import { applyProposalWithAutonomy } from "../domain/brain/autonomy-service.js";
import { clinicalPlanProvenance } from "../domain/brain/clinical-provenance.js";
import { TODAY_STONE_ORDER, todayStones } from "../domain/today/today-stones.js";
import { buildWhatIfPrompt } from "../prompt/whatif.js";
import { violatesReadingGrammar } from "../repo/day-read-grammar.js";
import { clampNutritionFloors } from "../repo/nutrition-safety.js";
import { computeGoalCheck } from "../repo/profile.js";
import { createProposal, getProposal } from "../repo/proposals.js";
import { interactiveTimeoutForOp } from "../repo/settings.js";
import { runChosen } from "../runChosen.js";
import { agentFailure, agentStatusFor, type OpHooks } from "./shared.js";

export const WHAT_IF_OP = "what_if";
/** The proposal row's author: a draft the athlete handed over from a what-if. */
export const WHAT_IF_PROPOSAL_AGENT = "what-if";
export const WHAT_IF_INSTRUCTION_PREFIX = "what-if:";

const QUESTION_MAX = 1000;
const SUMMARY_MAX = 240;
const WHY_MAX = 200;
const CHANGES_MAX = 12;

export interface WhatIfInput {
  text?: unknown;
  hint?: unknown;
  date?: unknown;
}

/** Test seam: the one agent call, injectable so the agentic path runs offline. */
export interface WhatIfDeps {
  run?: typeof runChosen;
}

type Failure = {
  ok: false;
  error: string;
  tried: { agent: string; error: string }[];
  agent?: string | null;
  agent_busy?: true;
  agent_status?: "ok" | "unconfigured" | "all_failed";
};

// ---------- input normalization ----------

function cleanText(value: unknown, max: number): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function normalizeHint(value: unknown): WhatIfHint | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const area = (WHAT_IF_HINT_AREAS as readonly string[]).includes(String(raw.area))
    ? (raw.area as WhatIfHint["area"])
    : undefined;
  const direction = raw.direction === "more" || raw.direction === "less" ? raw.direction : undefined;
  return area || direction ? { ...(area ? { area } : {}), ...(direction ? { direction } : {}) } : null;
}

function finiteOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function intOrNull(value: unknown): number | null {
  const n = finiteOrNull(value);
  return n == null ? null : Math.max(0, Math.round(n));
}

// A run is never a plan item (migration 110): runs follow the stated run days and the
// run engine. Left among the strength edits, an un-kinded run would be applied as a
// fabricated lifting movement, so it is dropped here, before anything can draft it.
const RUN_WORDS = /\b(?:run|runs|running|jog|jogging|tempo|intervals?|long run|strides|fartlek)\b/i;
const RUN_FIELDS = ["target_distance_km", "target_duration_min", "target_zone", "interval"];

function normalizePlanChange(raw: unknown): WhatIfPlanChange | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const c = raw as Record<string, unknown>;
  const day = Number(c.day_number);
  if (!Number.isInteger(day) || day < 1) return null;
  if (RUN_FIELDS.some((field) => c[field] != null)) return null;
  const exercise = cleanText(c.exercise, 120);
  const swapRaw = c.swap && typeof c.swap === "object" ? (c.swap as Record<string, unknown>) : null;
  const swap = swapRaw ? { from: cleanText(swapRaw.from, 120), to: cleanText(swapRaw.to, 120) } : null;
  const validSwap = swap && swap.from && swap.to ? swap : null;
  if (!exercise && !validSwap) return null;
  if (RUN_WORDS.test(exercise) || (validSwap && (RUN_WORDS.test(validSwap.from) || RUN_WORDS.test(validSwap.to))))
    return null;
  const out: WhatIfPlanChange = { day_number: day };
  if (exercise) out.exercise = exercise;
  if (validSwap) out.swap = validSwap;
  if (c.remove === true) out.remove = true;
  for (const field of ["sets", "rep_low", "rep_high"] as const) {
    if (Object.hasOwn(c, field)) out[field] = intOrNull(c[field]);
  }
  for (const field of ["target_weight", "target_seconds"] as const) {
    if (Object.hasOwn(c, field)) out[field] = finiteOrNull(c[field]);
  }
  const reason = cleanText(c.reason, 200);
  if (reason) out.reason = reason;
  return out;
}

function normalizeNutrition(raw: unknown): { target_kcal: number | null; protein_g: number | null } | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const n = raw as Record<string, unknown>;
  const kcal = finiteOrNull(n.target_kcal);
  const protein = finiteOrNull(n.protein_g);
  const target_kcal = kcal != null && kcal > 0 ? Math.round(kcal) : null;
  const protein_g = protein != null && protein > 0 ? Math.round(protein) : null;
  return target_kcal == null && protein_g == null ? null : { target_kcal, protein_g };
}

function clinicalFor(question: string, change: { summary: string; changes?: unknown; nutrition?: unknown }): boolean {
  return (
    clinicalPlanProvenance({
      message: question,
      action: change,
      imageAloneIsClinical: false,
      source: "what_if_clinical_detection",
    }) !== null
  );
}

/**
 * The change, re-read on the server. Used on the agent's answer AND on the client's
 * echo at "Do it" — whichever side it came from, only a concrete strength edit or a
 * positive nutrition target is ever doable, and the clinical mark is the server's.
 */
export function normalizeWhatIfChange(raw: unknown, question = ""): WhatIfChange | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const c = raw as Record<string, unknown>;
  const summary = cleanText(c.summary, SUMMARY_MAX);
  if (!summary || violatesReadingGrammar(summary)) return null;
  const kind: WhatIfChangeKind = (WHAT_IF_CHANGE_KINDS as readonly string[]).includes(String(c.kind))
    ? (c.kind as WhatIfChangeKind)
    : "other";
  const change: WhatIfChange = { kind, summary, doable: false, clinical: false };
  if (kind === "training") {
    const changes = (Array.isArray(c.changes) ? c.changes : [])
      .slice(0, CHANGES_MAX)
      .map(normalizePlanChange)
      .filter((x): x is WhatIfPlanChange => x !== null);
    change.changes = changes;
    change.doable = changes.length > 0;
  } else if (kind === "nutrition") {
    const nutrition = normalizeNutrition(c.nutrition);
    if (nutrition) change.nutrition = nutrition;
    change.doable = nutrition !== null;
  }
  change.clinical = clinicalFor(question, change);
  return change;
}

// ---------- the ripple ----------

// A stone the answer does not touch reads steady, and says so plainly — never "costs".
const UNTOUCHED_WHY = "Nothing here should move much from this.";

function stoneBefore(stones: readonly TodayStone[], key: TodayStoneKey): TodayStone | null {
  return stones.find((s) => s.key === key) ?? null;
}

const STONE_LABELS: Record<TodayStoneKey, string> = {
  strength: "Strength",
  endurance: "Endurance",
  fuel: "Fuel",
  recovery: "Recovery",
  body: "Body",
  heart: "Heart",
};

function normalizeRipple(raw: unknown, stones: readonly TodayStone[]): WhatIfRippleEffect[] {
  const named = new Map<TodayStoneKey, { direction: WhatIfDirection; why: string; confidence: WhatIfConfidence }>();
  for (const entry of Array.isArray(raw) ? raw : []) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const key = String(e.stone ?? "").toLowerCase() as TodayStoneKey;
    if (!TODAY_STONE_ORDER.includes(key) || named.has(key)) continue;
    const direction = (WHAT_IF_DIRECTIONS as readonly string[]).includes(String(e.direction))
      ? (e.direction as WhatIfDirection)
      : "steady";
    const confidence = (WHAT_IF_CONFIDENCE as readonly string[]).includes(String(e.confidence))
      ? (e.confidence as WhatIfConfidence)
      : "unsure";
    const why = cleanText(e.why, WHY_MAX);
    if (!why || violatesReadingGrammar(why)) continue;
    named.set(key, { direction, why, confidence });
  }
  return TODAY_STONE_ORDER.map((key) => {
    const stone = stoneBefore(stones, key);
    const effect = named.get(key) ?? {
      direction: "steady" as const,
      why: UNTOUCHED_WHY,
      confidence: "unsure" as const,
    };
    return {
      stone: key,
      label: stone?.label ?? STONE_LABELS[key],
      ...effect,
      before: { word: stone?.word ?? "quiet", tone: stone?.tone ?? "quiet" },
    };
  });
}

// ---------- the offline floor (the `stub` agent) ----------

type FloorRow = [TodayStoneKey, WhatIfDirection, WhatIfConfidence, string];

// Authored, calm, one line each; every line passes the reading grammar (tested).
export const WHAT_IF_FLOOR_TABLE: Record<string, readonly FloorRow[]> = {
  "training:more": [
    ["strength", "helps", "likely", "More lifting gives your strength more to build on."],
    ["recovery", "costs", "possible", "More work asks more of your recovery between sessions."],
    ["fuel", "costs", "possible", "Extra sessions raise what your days need to eat."],
  ],
  "training:less": [
    ["strength", "costs", "possible", "Less lifting gives your strength less to build on."],
    ["recovery", "helps", "likely", "Fewer sessions leave more room to recover."],
  ],
  "endurance:more": [
    ["endurance", "helps", "likely", "More running builds more aerobic base."],
    ["recovery", "costs", "possible", "More running asks more of your legs and sleep."],
    ["fuel", "costs", "possible", "More running raises what your days need to eat."],
    ["heart", "helps", "possible", "Steady aerobic work tends to be kind to your heart."],
  ],
  "endurance:less": [
    ["endurance", "costs", "possible", "Less running gives your aerobic base less to build on."],
    ["recovery", "helps", "likely", "Less running leaves your legs fresher."],
  ],
  "fuel:more": [
    ["fuel", "helps", "likely", "More food covers more of what your training asks."],
    ["recovery", "helps", "possible", "Better-fueled days usually recover better."],
    ["body", "mixed", "possible", "Your weight trend may slow or turn, depending on where you're heading."],
  ],
  "fuel:less": [
    ["fuel", "costs", "likely", "Less food covers less of what your training asks."],
    ["recovery", "costs", "possible", "Leaner days can make recovery slower."],
    ["body", "mixed", "possible", "Your weight trend may move faster, depending on where you're heading."],
  ],
  "recovery:more": [
    ["recovery", "helps", "likely", "More rest gives your body more room to recover."],
    ["strength", "helps", "possible", "Fresher sessions tend to lift better."],
  ],
  "recovery:less": [
    ["recovery", "costs", "likely", "Less rest leaves less room to recover."],
    ["strength", "costs", "possible", "Tired sessions tend to lift less well."],
  ],
  "body:more": [["body", "mixed", "unsure", "How your body responds depends on what drives the change."]],
  "body:less": [["body", "mixed", "unsure", "How your body responds depends on what drives the change."]],
};

const FLOOR_KIND: Record<string, WhatIfChangeKind> = {
  training: "training",
  endurance: "other",
  fuel: "nutrition",
  recovery: "other",
  body: "goal",
};

export function whatIfFloor(question: string, hint: WhatIfHint | null, stones: readonly TodayStone[]) {
  const key = hint?.area && hint.direction ? `${hint.area}:${hint.direction}` : "";
  const rows = WHAT_IF_FLOOR_TABLE[key] ?? [];
  const kind: WhatIfChangeKind = hint?.area ? FLOOR_KIND[hint.area] : "other";
  // The floor never invents a concrete edit or a number: its change is the athlete's own
  // question, held as words, so "Do it" has nothing to draft from it.
  const change = normalizeWhatIfChange({ kind, summary: question }, question) ?? {
    kind: "other" as const,
    summary: "Your question, as asked.",
    doable: false,
    clinical: false,
  };
  change.doable = false;
  delete change.changes;
  delete change.nutrition;
  const ripple = normalizeRipple(
    rows.map(([stone, direction, confidence, why]) => ({ stone, direction, confidence, why })),
    stones
  );
  return { change, ripple };
}

// ---------- whatIf: the read ----------

function readStones(date: string | undefined): { date: string; stones: TodayStone[] } {
  try {
    const read = todayStones(date);
    return { date: read.date, stones: read.stones };
  } catch {
    return { date: date ?? "", stones: [] };
  }
}

/**
 * Answer a what-if. NEVER writes. `{ok:false, error, tried}` is the designed failure —
 * no question, or no agent returned a usable answer.
 */
export async function whatIf(
  agent: string | undefined | null,
  input: WhatIfInput,
  hooks?: OpHooks,
  deps: WhatIfDeps = {}
): Promise<WhatIfResult | Failure> {
  const question = cleanText(input?.text, QUESTION_MAX);
  if (!question) return { ok: false, error: "a what-if needs a question in words", tried: [] };
  const hint = normalizeHint(input?.hint);
  const dateArg = typeof input?.date === "string" && input.date ? input.date : undefined;
  const { date, stones } = readStones(dateArg);

  if (agent === "stub") {
    const floor = whatIfFloor(question, hint, stones);
    return { ok: true, date, question, ...floor, source: "deterministic", agent: "stub", tried: [] };
  }

  hooks?.onPhase?.("talking it through with the team");
  const run = deps.run ?? runChosen;
  let chosen: string | null = null;
  let parsed: unknown = null;
  let tried: { agent: string; error: string }[] = [];
  try {
    const prompt = buildWhatIfPrompt(question, { stones, hint });
    const out = await run(agent ?? undefined, prompt, {
      op: WHAT_IF_OP,
      timeoutMs: interactiveTimeoutForOp(WHAT_IF_OP),
      signal: hooks?.signal,
      acceptParsed: isWhatIfResult,
      schema: WHAT_IF_SCHEMA,
    });
    chosen = out.agent;
    parsed = out.result?.parsed;
    tried = out.tried ?? [];
  } catch (error) {
    const failure = agentFailure(error, hooks);
    return {
      ok: false,
      error: "the team couldn't read this what-if right now",
      ...failure,
      agent_status: agentStatusFor({ ok: false, ...failure }),
    };
  }
  const p = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  const change = normalizeWhatIfChange(p?.change, question);
  if (!p || !change) {
    return {
      ok: false,
      error: "the team couldn't read this what-if right now",
      agent: chosen,
      tried,
      agent_status: agentStatusFor({ ok: false, agent: chosen, tried }),
    };
  }
  return {
    ok: true,
    date,
    question,
    change,
    ripple: normalizeRipple(p.ripple, stones),
    source: "agent",
    agent: chosen,
    tried,
  };
}

// ---------- whatIfDo: "Do it" ----------

export interface WhatIfDoInput {
  change?: unknown;
  /** The athlete's original question — read for clinical signals alongside the change. */
  text?: unknown;
}

/**
 * Hand a what-if's change to the team as a DRAFT, routed by the autonomy policy.
 * Never applies on its own authority; `{ok:false, error, tried:[]}` when there is
 * nothing concrete to draft.
 */
export function whatIfDo(input: WhatIfDoInput): any {
  const question = cleanText(input?.text, QUESTION_MAX);
  const change = normalizeWhatIfChange(input?.change, question);
  if (!change) return { ok: false, error: "there's no change here to hand over", tried: [] };
  if (!change.doable) {
    return {
      ok: false,
      error:
        change.kind === "goal"
          ? "a goal is yours to name — say it in chat and the team will take it from there"
          : "this one is talked through rather than drafted — ask the team in chat",
      kind: change.kind,
      tried: [],
    };
  }
  const provenance = clinicalPlanProvenance({
    message: question,
    action: change,
    imageAloneIsClinical: false,
    source: "what_if_clinical_detection",
  });
  const instruction = `${WHAT_IF_INSTRUCTION_PREFIX} ${change.summary}`.slice(0, 500);
  let payload: Record<string, unknown>;
  if (change.kind === "nutrition" && change.nutrition) {
    const bounded = clampNutritionFloors(
      { ...change.nutrition },
      { kcal: "target_kcal", protein: "protein_g" },
      safeGoalCheck()
    );
    payload = { kind: "nutrition_target", summary: change.summary, nutrition: bounded };
  } else {
    payload = { summary: change.summary, changes: change.changes ?? [] };
  }
  if (provenance) payload.clinical_provenance = provenance;
  const proposal = createProposal(WHAT_IF_PROPOSAL_AGENT, instruction, "", payload) as any;
  const routed = applyProposalWithAutonomy(Number(proposal.id), {
    // The athlete asked for this change and tapped "Do it": their decision, not a
    // coach surprise. Every floor still applies on top.
    explicit_user_request: true,
    // A calorie target from a what-if always waits on the athlete: the check-in's
    // protective caps did not produce it, so the team never lands it on its own.
    ...(change.kind === "nutrition" ? { requested_tier: "ask" as const } : {}),
    clinical: provenance !== null,
    clinical_provenance: provenance ?? undefined,
  }) as any;
  const stored = getProposal(Number(proposal.id)) as any;
  return {
    ...routed,
    ok: routed?.ok !== false,
    proposal_id: Number(proposal.id),
    proposal_status: stored?.status ?? null,
    change,
    tier: routed?.tier ?? routed?.decision?.autonomy_tier ?? null,
  };
}

function safeGoalCheck(): unknown {
  try {
    return computeGoalCheck();
  } catch {
    return undefined;
  }
}
