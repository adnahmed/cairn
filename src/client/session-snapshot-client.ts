// @ts-check
// The Session destination's first paint: its shell, the primer's early read, and its
// warm instant paint (the same idea as Today's
// cairn.today.plan.v2). Session's first content waits on the plan-session preparation
// and the strength line — round trips even when every cached read is warm — so a
// re-entry showed the previous screen for over half a second. The last real session
// paint is kept per DATE, with a stamp of the cached reads it was drawn from (the
// session, the day's composed session, the plan). It repaints at once only while those
// reads are untouched: every write drops or replaces one of them (a logged set, a skip,
// a swap, an outbox replay, a plan save), the stamp stops matching, and the screen
// waits for the truth instead. The real render always follows and settles on the live
// content. Per-tab (sessionStorage); every storage access is guarded.
{
  type Peek = (key: string) => { data: unknown } | null;
  type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

  const KEY = "cairn.session.surface.v1";

  function stamp(date: string, peek: Peek): string | null {
    const session = peek(`today:session:${date}`);
    if (!session) return null;
    let text = "";
    try {
      text = JSON.stringify([
        session.data ?? null,
        peek(`today:daily-session:${date}`)?.data ?? null,
        peek("plan")?.data ?? null,
      ]);
    } catch {
      return null;
    }
    let hash = 5381;
    for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
    return `${text.length}:${hash >>> 0}`;
  }

  function save(store: Store | null, date: string, html: string, peek: Peek): void {
    if (!store) return;
    const now = stamp(date, peek);
    try {
      if (!now) store.removeItem(KEY);
      else store.setItem(KEY, JSON.stringify({ date, stamp: now, html }));
    } catch {
      /* quota or blocked storage: skip */
    }
  }

  /** The last session paint for `date`, only while the reads it was drawn from are unchanged. */
  function load(store: Store | null, date: string, peek: Peek): string | null {
    if (!store) return null;
    try {
      const raw = store.getItem(KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { date?: unknown; stamp?: unknown; html?: unknown } | null;
      if (!parsed || parsed.date !== date || typeof parsed.html !== "string" || typeof parsed.stamp !== "string")
        return null;
      const now = stamp(date, peek);
      return now && now === parsed.stamp ? parsed.html : null;
    } catch {
      return null;
    }
  }

  function storage(): Store | null {
    try {
      return typeof sessionStorage !== "undefined" ? sessionStorage : null;
    } catch {
      return null;
    }
  }

  // The session's other first-paint pieces, split out of today-screen.ts: the primer's
  // read (asked early, so it lands in the same frame as the list) and the shell.
  const PRIMER_WAIT_MS = 1200;

  /** The primer's read for a date and plan day, spelled exactly as the primer asks it. */
  function primerPath(date: string, dayNumber: number | null): string {
    const params: string[] = [];
    if (date) params.push(`date=${encodeURIComponent(String(date))}`);
    if (dayNumber != null && Number.isFinite(Number(dayNumber)))
      params.push(`day=${encodeURIComponent(String(dayNumber))}`);
    return `/session-primer?${params.join("&")}`;
  }

  function shellHtml(
    inner: string,
    meta: {
      fresh: boolean;
      kicker: string;
      dayName: string;
      dayFocus: string;
      why?: string;
      estimate?: number | null;
      exDone: number;
      exTotal: number;
      /** The plan day's own list when most of today's slots moved — one tap away. */
      original?: string[];
      /** Offer the plan day itself when the accepted session holds no lift for it. */
      startDay?: { dayNumber: number; label: string } | null;
    }
  ): string {
    const capped = Math.min(meta.exTotal, 12);
    const dots = meta.exTotal
      ? `<div class="sess-dots" aria-hidden="true">${Array.from({ length: capped }, (_v, i) => `<span class="sess-dot${i < meta.exDone ? " on" : ""}"></span>`).join("")}</div>`
      : "";
    const prog = meta.exTotal
      ? `<span class="sess-prog"><b>${meta.exDone}</b><span class="sess-prog-sep"> of </span>${meta.exTotal}</span>`
      : "";
    return `<div class="sess-dest${meta.fresh ? " sess-fresh" : ""}">
    <div class="sess-topbar">
      <button class="sess-close" id="sessClose" type="button" aria-label="Back to today">←</button>
      <div class="sess-topbar-mid">
        <div class="sess-kicker lbl">${escHtml(meta.kicker)}</div>
        <div class="sess-dayname" role="heading" aria-level="1" tabindex="-1">${escHtml(meta.dayName)}${meta.dayFocus ? `<span class="sess-focus"> · ${escHtml(meta.dayFocus)}</span>` : ""}</div>
        ${meta.why || meta.estimate ? `<div class="sess-topbar-why">${meta.why ? escHtml(meta.why) : ""}${meta.estimate ? `${meta.why ? " · " : ""}${Math.round(meta.estimate)} min` : ""}</div>` : ""}
        ${meta.original && meta.original.length ? `<details class="strength-line-orig sess-orig"><summary>The plan's list</summary><span>${escHtml(meta.original.join(" · "))}</span></details>` : ""}
        ${meta.startDay ? `<button type="button" class="ghostbtn sess-line-start daybtn" data-day="${escAttr(meta.startDay.dayNumber)}">${escHtml(meta.startDay.label)}</button>` : ""}
      </div>
      <div class="sess-topbar-side">${prog}</div>
    </div>
    ${dots}
    <div class="sess-body"><div id="sessionPrimerSlot" class="sess-primer-slot"></div>${inner}</div>
  </div>`;
  }

  const CAIRN_SESSION_SNAPSHOT = { KEY, stamp, save, load, storage, PRIMER_WAIT_MS, primerPath, shellHtml };
  Object.assign(globalThis, { CairnSessionSnapshot: CAIRN_SESSION_SNAPSHOT });
}
