// @ts-check
// evidence-wanted (docs/V2-PLAN.md wave 3): an overdue recheck or rescan surfaced ONCE,
// as evidence the team would like — a single calm line, never a list, a badge or a
// nag. The model picks the first lab/DEXA item whose window is open from the server's
// next-checkup read (GET /api/health/next-checkup `due_now`; the label and the "when"
// arrive finished from the server). `key` names that ask (item + due date), so a
// "Not now" holds until the ask itself changes. Informational, never medical advice.
{
  type Model = ClientEvidenceWanted;

  function model(checkup: unknown): Model | null {
    const due = (checkup as { due_now?: unknown } | null)?.due_now;
    if (!Array.isArray(due)) return null;
    for (const raw of due) {
      if (!raw || typeof raw !== "object") continue;
      const item = raw as Record<string, unknown>;
      if (item.kind !== "lab" && item.kind !== "dexa") continue;
      const label = String(item.label || "").trim();
      if (!label) continue;
      return {
        key: `${String(item.signal_key || label)}@${String(item.next_due || "")}`,
        label,
        when: String(item.when_text || "").trim(),
        kind: item.kind,
      };
    }
    return null;
  }

  function text(m: Model): string {
    const what = m.kind === "dexa" ? `A fresh ${m.label} scan` : `A fresh ${m.label} reading`;
    return `${what} would sharpen the team's read${m.when ? ` (${m.when})` : ""}.`;
  }

  /** The one line, or "" (the slot collapses when empty). */
  function lineHtml(m: Model | null, opts: { canOpen?: boolean } = {}): string {
    if (!m) return "";
    const open = opts.canOpen
      ? `<button type="button" class="linkbtn linkbtn-plain evw-act" data-evidence-wanted-open>Next checkup</button>`
      : "";
    return `<p class="evw reveal" role="note"><span class="evw-text">${escHtml(text(m))}</span><span class="evw-acts">${open}<button type="button" class="linkbtn linkbtn-plain evw-act" data-evidence-wanted-dismiss>Not now</button></span></p>`;
  }

  const CAIRN_EVIDENCE_WANTED = { model, text, lineHtml };

  Object.assign(globalThis, { CairnEvidenceWanted: CAIRN_EVIDENCE_WANTED });
}
