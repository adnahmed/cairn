// @ts-check
// evidence-wanted, the controller. `mount(host, deps)` reads the server's one line
// through SWR (`health:evidence-wanted`, GET /api/health/evidence-wanted): a warm peek
// paints at once, the read always revalidates, and a changed answer repaints in place
// (nothing paints while it loads, and a failure leaves the slot empty — the line is a
// quiet extra, never a spinner or an error). "Next checkup" hands off to `deps.onOpen`;
// "Not now" hides this ask for this viewer (`cairn.records.evw`, keyed on the ask, so a
// new ask, or the same one after a fresh reading, surfaces once more). Returns the
// teardown.
{
  const DISMISS_KEY = "cairn.records.evw";
  const KEY = "health:evidence-wanted";
  const PATH = "/health/evidence-wanted";

  function dismissed(deps: ClientEvidenceWantedDeps): string {
    try {
      return deps.storage?.getItem(DISMISS_KEY) || "";
    } catch {
      return "";
    }
  }

  function mountEvidenceWanted(host: Element, deps: ClientEvidenceWantedDeps): () => void {
    let current: ClientEvidenceWantedLine | null = null;
    let painted = "";
    let generation = 0;

    function paint(read: unknown): void {
      current = CairnEvidenceWanted.model(read);
      const html =
        current && dismissed(deps) !== current.key
          ? CairnEvidenceWanted.lineHtml(current, { canOpen: !!deps.onOpen })
          : "";
      if (html === painted) return;
      painted = html;
      host.innerHTML = html;
    }

    return CairnUiActions.mount(host, "evidence-wanted", ({ delegate }) => {
      delegate("click", {
        "evidence-wanted-open": () => deps.onOpen?.(),
        "evidence-wanted-dismiss": () => {
          try {
            if (current) deps.storage?.setItem(DISMISS_KEY, current.key);
          } catch {
            /* a per-viewer convenience; the line still goes for this visit */
          }
          painted = "";
          host.innerHTML = "";
        },
      });
      const gen = ++generation;
      let peek: SwrPeek<unknown> | null = null;
      try {
        peek = deps.peekCached(KEY);
      } catch {
        peek = null;
      }
      host.innerHTML = "";
      if (peek?.data) paint(peek.data);
      deps
        .cachedApi(PATH, { key: KEY })
        .then((data) => {
          if (gen !== generation || !host.isConnected) return;
          if (data && typeof data === "object") paint(data);
        })
        .catch(() => {
          /* the line is a quiet extra: a failed read leaves whatever was painted */
        });
      return () => {
        generation++;
      };
    });
  }

  const CAIRN_EVIDENCE_WANTED_CONTROLLER = { DISMISS_KEY, KEY, PATH, mount: mountEvidenceWanted };

  Object.assign(globalThis, { CairnEvidenceWantedController: CAIRN_EVIDENCE_WANTED_CONTROLLER });
}
