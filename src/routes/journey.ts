import { Router } from "express";
import {
  activateJourneyPhase,
  createJourneyPhase,
  discardJourneyPhase,
  getJourneyPhase,
  journeyMilestones,
  journeyRead,
  journeyTransitionSuggestion,
  listJourneyPhases,
} from "../repo/journey.js";
import { forwardTimeline } from "../repo/forward-timeline.js";
import { goalConsistencyRead } from "../repo/goal-consistency.js";
import { memoizedRead } from "./response-memo.js";

export const journeyRouter = Router();

// Every journey GET below is memoized on the response freshness key
// (routes/response-memo.ts): Horizon reads them on every open, and they only move
// when something the athlete logs, sets or has read for them moves.
const dateOf = (req: { query: Record<string, unknown> }) => (req.query.date ? String(req.query.date) : undefined);

journeyRouter.get("/journey", memoizedRead("journey", (req) => journeyRead(dateOf(req))));

// The road ahead: one ordered forward-looking timeline (goal, phase window,
// scheduled re-checks/re-tests, DEXA re-scan window, block boundary, nearest
// strength standards). A calm plan, never a countdown — empty DB yields [].
journeyRouter.get("/journey/timeline", memoizedRead("journey-timeline", (req) => forwardTimeline(dateOf(req))));

// One goal, said once: any disagreement between the profile goal weight/date and the
// active phase's target/end date, in plain words. A pure read — neither side is
// overwritten; the athlete says which one stands.
journeyRouter.get("/journey/goal-consistency", memoizedRead("journey-goal-consistency", () => goalConsistencyRead()));

journeyRouter.get("/journey/milestones", memoizedRead("journey-milestones", (req) => journeyMilestones(dateOf(req))));

journeyRouter.get(
  "/journey/transition-suggestion",
  memoizedRead("journey-transition-suggestion", (req) => journeyTransitionSuggestion(dateOf(req)))
);

journeyRouter.get(
  "/journey/phases",
  memoizedRead("journey-phases", (req) => listJourneyPhases((req.query.status ? String(req.query.status) : "all") as any))
);

journeyRouter.get(
  "/journey/phases/:id",
  memoizedRead("journey-phase", (req) => getJourneyPhase(Number(req.params.id)))
);

journeyRouter.post("/journey/phases", (req, res) => {
  try {
    res.json(createJourneyPhase(req.body ?? {}));
  } catch (e: any) {
    res.status(400).json({ error: e?.message ?? "invalid journey phase" });
  }
});

journeyRouter.post("/journey/phases/:id/activate", (req, res) => {
  try {
    res.json(activateJourneyPhase(Number(req.params.id)));
  } catch (e: any) {
    res.status(400).json({ error: e?.message ?? "could not activate journey phase" });
  }
});

journeyRouter.post("/journey/phases/:id/discard", (req, res) => {
  res.json(discardJourneyPhase(Number(req.params.id)));
});
