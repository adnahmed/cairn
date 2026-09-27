// @ts-check
// You -> Health in one request. GET /you-health?leaf=… carries, keyed by path, the nine
// reads behind the standing overview every Health leaf warms plus the open leaf's own
// (the documents, the evidence line, the packet preview) — routes/screen-responses.ts —
// and primes the request layer so every read on the screen keeps asking for its own path.
// Asked once per open: a second ask inside a few seconds (the tool view, then the
// overview's warm-behind) rides the first. A write clears every prime, and the reads then
// simply ask for themselves; a fan-in that could not reach Cairn fails them without the
// wire, so each goes to its last-known paint (api-reach.ts).
(() => {
  const REUSE_MS = 3000;
  const OVERVIEW = ["/markers/priority", "/coaching-focus", "/body-metrics?unit=in", "/health/synthesis", "/insights",
    "/recovery", "/supplements", "/directives", "/health/next-checkup"];
  const LEAF_READS: Record<string, string[]> = {
    records: ["/health-docs"],
    markers: ["/health/evidence-wanted"],
    share: ["/health-report.json", "/symptom-links", "/health/visit-questions"],
  };
  let last: { leaf: string; at: number } | null = null;

  function leafOf(seg: unknown): string {
    const s = String(seg || "");
    return s === "records" || s === "markers" || s === "share" ? s : "health";
  }

  function prime(seg: unknown): void {
    const leaf = leafOf(seg);
    if (last && last.leaf === leaf && Date.now() - last.at < REUSE_MS) return;
    last = { leaf, at: Date.now() };
    try {
      const paths = [...OVERVIEW, ...(LEAF_READS[leaf] || [])];
      apiPrime(paths, api(`/you-health?leaf=${leaf}` as "/you-health").then((v) => (v as { responses?: unknown } | null)?.responses ?? null));
    } catch {
      /* every read simply asks for its own path */
    }
  }

  Object.assign(globalThis, { CairnHealthFanIn: { prime, leafOf } });
})();
