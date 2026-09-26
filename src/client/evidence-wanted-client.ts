// @ts-check
// evidence-wanted (docs/V2-PLAN.md wave 3): an overdue recheck or rescan surfaced ONCE,
// as evidence the team would like — a single calm line, never a list, a badge or a
// nag. The line is the SERVER's (GET /api/health/evidence-wanted, ClientEvidenceWantedRead
// in src/contracts/health-records.ts, src/domain/health/evidence-wanted.ts — the doctor
// loop, a stale body scan, or an aged finding, at most one): this renderer prints its
// finished `line` and never composes a word of it. `key` names that ask (the evidence's
// identity + the date of the reading it would refresh), so a "Not now" holds until the
// ask itself changes. Informational, never medical advice.
{
  type Line = ClientEvidenceWantedLine;

  function model(read: unknown): Line | null {
    const item = read && typeof read === "object" ? (read as { item?: unknown }).item : null;
    if (!item || typeof item !== "object") return null;
    const it = item as Record<string, unknown>;
    const line = String(it.line ?? "").trim();
    const key = String(it.key ?? "").trim();
    if (!line || !key) return null;
    return {
      key: `${key}@${String(it.since ?? "")}`,
      line,
      kind: it.kind === "rescan" ? "rescan" : "recheck",
    };
  }

  /** The one line, or "" (the slot collapses when empty). */
  function lineHtml(m: Line | null, opts: { canOpen?: boolean } = {}): string {
    if (!m) return "";
    const open = opts.canOpen
      ? `<button type="button" class="linkbtn linkbtn-plain evw-act" data-evidence-wanted-open>Next checkup</button>`
      : "";
    return `<p class="evw reveal" role="note"><span class="evw-text">${escHtml(m.line)}</span><span class="evw-acts">${open}<button type="button" class="linkbtn linkbtn-plain evw-act" data-evidence-wanted-dismiss>Not now</button></span></p>`;
  }

  const CAIRN_EVIDENCE_WANTED = { model, lineHtml };

  Object.assign(globalThis, { CairnEvidenceWanted: CAIRN_EVIDENCE_WANTED });
}
