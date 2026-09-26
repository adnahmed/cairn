// @ts-check
// evidence-wanted, the controller. `mount(host, deps)` paints the one line from the
// checkup read the screen already holds (no fetch of its own), or leaves the slot
// empty. "Next checkup" hands off to `deps.onOpen`; "Not now" hides this ask for this
// viewer (`cairn.records.evw`, keyed on the ask, so a new or re-dated ask surfaces
// once more). Returns the teardown.
{
  const DISMISS_KEY = "cairn.records.evw";

  function dismissed(deps: ClientEvidenceWantedDeps): string {
    try {
      return deps.storage?.getItem(DISMISS_KEY) || "";
    } catch {
      return "";
    }
  }

  function mountEvidenceWanted(host: Element, deps: ClientEvidenceWantedDeps): () => void {
    const m = CairnEvidenceWanted.model(deps.checkup);
    host.innerHTML = m && dismissed(deps) !== m.key ? CairnEvidenceWanted.lineHtml(m, { canOpen: !!deps.onOpen }) : "";
    return CairnUiActions.mount(host, "evidence-wanted", ({ delegate }) => {
      delegate("click", {
        "evidence-wanted-open": () => deps.onOpen?.(),
        "evidence-wanted-dismiss": () => {
          try {
            if (m) deps.storage?.setItem(DISMISS_KEY, m.key);
          } catch {
            /* a per-viewer convenience; the line still goes for this visit */
          }
          host.innerHTML = "";
        },
      });
    });
  }

  const CAIRN_EVIDENCE_WANTED_CONTROLLER = { DISMISS_KEY, mount: mountEvidenceWanted };

  Object.assign(globalThis, { CairnEvidenceWantedController: CAIRN_EVIDENCE_WANTED_CONTROLLER });
}
