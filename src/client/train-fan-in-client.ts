// @ts-check
// Train in one request. Each Train screen (the home, Program, Endurance) asks for its
// reads by their own paths, as it always has; this primes the request layer with ONE
// GET /train-home?view=… whose `responses` carry every one of those bodies, keyed by
// path (routes/screen-responses.ts). A read the fan-in came back without asks for
// itself; a fan-in that could not reach Cairn fails its reads without the wire, so each
// goes straight to its last-known paint (api-reach.ts). Any write clears every prime.
type TrainFanInView = "overview" | "program" | "endurance";

(() => {
  function pathsFor(view: TrainFanInView, date: string): string[] {
    const q = encodeURIComponent;
    if (view === "program") {
      return [
        "/coaching-focus", "/program-state", "/strength-journeys", "/strength-journey", "/performance",
        "/program/blocks/active", "/program/adjustments", "/test-week", "/muscle-trajectory", "/dexa-targeting",
      ];
    }
    if (view === "endurance") {
      return [
        "/stats", "/endurance-prs", "/endurance-goal", "/run-compliance", "/settings", "/run-plan", "/race-build",
        `/training-agenda?date=${q(date)}`, "/program-state", `/calibration/status?date=${q(date)}`,
      ];
    }
    return [];
  }

  // Prime `view`'s reads (or the caller's own list) from one /train-home request.
  function prime(view: TrainFanInView, paths?: readonly string[]): void {
    try {
      const date = localISO();
      const asked = paths && paths.length ? paths : pathsFor(view, date);
      const path = `/train-home?view=${view}&date=${encodeURIComponent(date)}`;
      apiPrime(asked, api(path as "/train-home").then((value) => (value as { responses?: unknown } | null)?.responses ?? null));
    } catch {
      /* every read simply asks for its own path */
    }
  }

  Object.assign(globalThis, { CairnTrainFanIn: { prime, pathsFor } });
})();
