// @ts-check
// The Today changes line (docs/V2-PLAN.md wave 1, `changes-line`): one quiet line,
// "2 changes overnight", that opens the Changes feed. The server owns the count and
// the sentence (`since_seen` / `since_seen_line`, GET /api/brain/changes); this
// renderer only frames them, and draws nothing at zero. Wired by
// CairnChangesLineController.
{
  type ChangesLineRead = Partial<import("../contracts/brain-changes.js").ClientBrainChanges>;
  type ChangesLineModel = {
    /** How many feed rows are new since the feed was last opened (the server's count). */
    count: number;
    /** The server's finished sentence, verbatim. */
    line: string;
    /** Ids of the new rows, so a line the athlete already opened stays quiet. */
    ids: number[];
  };

  /** The line's view model, or null when there is nothing new (zero hides the line). */
  function changesLineModel(read: ChangesLineRead | null | undefined): ChangesLineModel | null {
    if (!read || typeof read !== "object") return null;
    const count = Number(read.since_seen);
    const line = typeof read.since_seen_line === "string" ? read.since_seen_line.trim() : "";
    if (!Number.isFinite(count) || count <= 0 || !line) return null;
    const ids: number[] = [];
    for (const day of Array.isArray(read.days) ? read.days : []) {
      for (const change of Array.isArray(day?.changes) ? day.changes : []) {
        if (change?.new === true && Number.isFinite(Number(change.id))) ids.push(Number(change.id));
      }
    }
    return { count, line, ids };
  }

  /** One button: the sentence, a quiet mark and a chevron. `enter` adds the one entrance. */
  function changesLineHtml(model: ChangesLineModel | null, opts: { enter?: boolean } = {}): string {
    if (!model) return "";
    const cls = `changes-line${opts.enter ? " settle-in" : ""}`;
    return `<button class="${cls}" type="button" data-changes-line-open aria-label="${escAttr(`${model.line}. Open Changes`)}"><span class="changes-line-mark" aria-hidden="true"></span><span class="changes-line-text">${escHtml(model.line)}</span><span class="changes-line-go" aria-hidden="true">›</span></button>`;
  }

  const CAIRN_CHANGES_LINE = {
    model: changesLineModel,
    html: changesLineHtml,
  };

  Object.assign(globalThis, { CairnChangesLine: CAIRN_CHANGES_LINE });
}
