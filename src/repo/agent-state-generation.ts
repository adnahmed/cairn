// A process-local counter that moves whenever what Cairn knows about its agent CLIs
// moves in memory — a presence probe or login verdict recorded, or those caches
// dropped after an in-app login, install or update. None of that is a DB write, yet
// /settings and the Brief's agent_status read it, so the response freshness key
// (repo/response-freshness.ts) folds this in. A leaf: it imports nothing.
let generation = 0;

/** Note that the in-memory agent state changed. */
export function bumpAgentStateGeneration(): void {
  generation++;
}

/** The current in-memory agent-state generation. */
export function agentStateGeneration(): number {
  return generation;
}
