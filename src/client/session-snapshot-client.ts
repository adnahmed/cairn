// @ts-check
// The Session destination's warm instant paint (the same idea as Today's
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
      if (!parsed || parsed.date !== date || typeof parsed.html !== "string" || typeof parsed.stamp !== "string") return null;
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

  const CAIRN_SESSION_SNAPSHOT = { KEY, stamp, save, load, storage };
  Object.assign(globalThis, { CairnSessionSnapshot: CAIRN_SESSION_SNAPSHOT });
}
