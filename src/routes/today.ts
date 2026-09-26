import { Router } from "express";
import {
  acknowledgeTodayAgendaCandidate,
  confirmGoalCheckin,
  dismissGoalCheckin,
  learnedTimeline,
  sinceLastLookedCandidate,
  teamWeekRead,
  todayAgenda,
} from "../domain/brain/index.js";
import { allGuidelines, guidelineFor } from "../domain/health/index.js";
import {
  todayStrengthLine,
} from "../domain/training/index.js";
import { markTodayAgendaSeen, todayAggregate, todayDateParam, todayStones } from "../domain/today/index.js";
import { memoizedRead } from "./response-memo.js";
import { publicTodayPlanDay, todaySurfaceResponses } from "./today-responses.js";
import { recordDismissal } from "../repo/surface-dismissals.js";

export const todayRouter = Router();

// Re-exported so existing importers (tests, tooling) keep one name for the
// aggregate; the composition itself lives in src/domain/today.
export { todayAggregate, publicTodayPlanDay };

// ---- Era 2 (the calm daily driver, docs/VISION.md §12) ----
// One server read for the whole Today open: the independent low-risk reads the
// client used to fetch separately (/plan, /sessions?date=, /stats, /profile,
// /exercises) PLUS the per-plan-day last sets, that day's progression, the
// strength journey, the salience agenda and the conductor's focus. Every one of
// those routes still exists and answers identically — this only collapses the
// request count; the client still primes their individual SWR keys.
//
// `?surface=today` (the Today tab, not the Session destination) widens it with
// `responses`: the bodies every other Today GET would answer, keyed by the path the
// client asks with (routes/today-responses.ts), so the whole open is one trip.
//
// Memoized on the response freshness key (routes/response-memo.ts): a repeat open
// with nothing logged since answers the stored body — or a 304 — without recomputing.
todayRouter.get("/today",
  memoizedRead("today", (req) => {
    const aggregate = todayAggregate(req.query.date);
    if (req.query.surface !== "today") return aggregate;
    return {
      ...aggregate,
      responses: todaySurfaceResponses(aggregate.date, {
        agenda: aggregate.agenda,
        progressionDay: aggregate.progression_day,
        coachingFocus: aggregate.coaching_focus,
        strengthJourney: aggregate.strength_journey,
      }),
    };
  })
);

// Canonical implicit plan-day choice for Today/Session. Manual day selection is
// an explicit client override and therefore does not call this route. The public
// DTO is deliberately bounded: internal candidate scores and load arrays stay on
// the server.
todayRouter.get("/today-plan-day", (req, res) => {
  res.json(publicTodayPlanDay(req.query.date));
});

// Today's lift in one line — plan day NAME, its state off the log, a rest/easy read
// as a caveat, a run logged today beside it. Every strength surface renders this
// verbatim; the Brief and the aggregate carry the same object.
todayRouter.get("/today-strength-line", (req, res) => {
  res.json(todayStrengthLine(todayDateParam(req.query.date)));
});

// The six stones (v2 wave 4): Strength, Endurance, Fuel, Recovery, Body, Heart — one
// plain word and a reading-layer tone each, projected on the server from the signal
// state and the domain reads (src/domain/today/today-stones.ts). A part of the picture
// with nothing fresh reads "quiet", never low; no score. A pure read.
todayRouter.get("/today/stones", (req, res) => {
  res.json(todayStones(req.query.date));
});

// The Today salience arbiter: ONE ranking + budget pass over the whole Today
// surface, so only the 1-2 things that matter most today render inline and the
// rest collapse behind a quiet "more". Marking "seen" at the end (debounced)
// powers the "since you last looked" continuity line.
todayRouter.get("/today-agenda", (req, res) => {
  const date = typeof req.query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
    ? req.query.date
    : undefined;
  const agenda = todayAgenda(date);
  // Shared with the Today aggregate, which computes the same agenda. The stamp is
  // debounced (~1h) inside markTodaySeen, so one open advances it exactly once
  // however many of the two surfaces the client actually asked.
  markTodayAgendaSeen(date);
  res.json(agenda);
});

// Presentation acknowledgement only: health-focus retires its current semantic
// revision without resolving/dismissing the underlying directives; the
// fast-loss-attention item retires the current cut-quality episode for 14 days.
// Materially new evidence can create a new revision and surface either item sooner.
todayRouter.post("/today-agenda/ack", (req, res) => {
  const id = String(req.body?.id ?? "").trim();
  if (!id) return res.status(400).json({ ok: false, error: "id required" });
  const revision = typeof req.body?.revision === "string" ? req.body.revision : null;
  const result = acknowledgeTodayAgendaCandidate(id, revision);
  res.status(result.stale ? 409 : result.ok ? 200 : 404).json(result);
});

// A dismiss is DIFFERENT from an ack: ack is a presentation-only revision retire
// (health-focus / fast-loss-attention only, and it can 409 stale). Dismiss is the
// generic "hide this card" affordance every dismissible agenda candidate already
// has client-side — this just also records the evidence row (surface_dismissals)
// so a REPEATED dismissal of the same card can, over time, feed the same soft
// suppression a thumbs-down already drives for insights. Fire-and-forget from the
// client; always 200 (recording is best-effort, never blocks the dismiss itself).
todayRouter.post("/today-agenda/dismiss", (req, res) => {
  const id = String(req.body?.id ?? "").trim();
  if (!id) return res.status(400).json({ ok: false, error: "id required" });
  recordDismissal("today_agenda", id);
  res.json({ ok: true, id });
});

// The team's-week digest — the deterministic "here's what your team did this
// week" read that sits under the agentic weekly sentence (pull-only; words, no
// scores). This is the human-facing surface, so it MAY drain the oldest 1-2
// unseen backlog insights (flipping new→seen) so nothing rots unseen.
todayRouter.get("/team-week",
  memoizedRead("team-week", () => teamWeekRead({ drainBacklog: true }))
);

// The legible "what Cairn has learned about you" timeline (pull-only; no scores).
todayRouter.get("/learned-timeline", (req, res) => {
  const limit = Number.parseInt(String(req.query.limit ?? ""), 10);
  res.json(learnedTimeline({ limit: Number.isFinite(limit) ? limit : undefined }));
});

// Trusted clinical-guideline statements (offline pack) for a marker, or the whole set.
todayRouter.get("/guidelines", (req, res) => {
  const marker = typeof req.query.marker === "string" ? req.query.marker : "";
  if (marker.trim()) return res.json({ marker, guideline: guidelineFor(marker) });
  res.json({ guidelines: allGuidelines() });
});

// The "since you last looked" continuity line standalone (or null).
todayRouter.get("/since-last", (_req, res) => res.json(sinceLastLookedCandidate() ?? null));

// Gentle goal check-in (you-drive): confirm restarts the ~3-month stable clock;
// dismiss starts the cooldown. Neither changes the goal — that's the profile flow.
todayRouter.post("/goal-checkin/confirm", (_req, res) => {
  confirmGoalCheckin();
  res.json({ ok: true });
});
todayRouter.post("/goal-checkin/dismiss", (_req, res) => {
  dismissGoalCheckin();
  res.json({ ok: true });
});
