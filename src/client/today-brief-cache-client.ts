// @ts-check
// The Brief's last-known REAL read, remembered on this device so a warm reopen paints
// the true sentence instantly (today-brief-controller.ts reconciles it post-render).

(() => {
  // localStorage key holding the most recent REAL (agentic, no-override) day read
  // so a warm reopen paints the true sentence INSTANTLY — no invented placeholder,
  // no visible swap when nothing changed. Bumped if the shape ever changes.
  const BRIEF_LS_KEY = "cairn.brief.v1";

  function briefStore(): Storage | null {
    try {
      return typeof localStorage !== "undefined" ? localStorage : null;
    } catch {
      return null;
    }
  }

  // The stored real read IFF it's for exactly this date (a previous day's read must
  // never paint for today). Returns a clean read (no internal flags) or null.
  function readCachedBrief(date: string): TodayBriefControllerDayRead | null {
    const store = briefStore();
    if (!store) return null;
    try {
      const raw = store.getItem(BRIEF_LS_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { date?: unknown; read?: TodayBriefControllerDayRead } | null;
      if (!parsed || parsed.date !== date || !parsed.read || !parsed.read.kind) return null;
      if (parsed.read._provisional) return null;
      return parsed.read;
    } catch {
      return null;
    }
  }

  // Persist the last-known real read. Only ever the canonical (no-override) read —
  // an override ("rough night") is transient and must not poison the next open —
  // and never a provisional/placeholder. Strips internal flags before storing.
  function persistCachedBrief(
    date: string,
    override: string,
    read: TodayBriefControllerDayRead | null | undefined
  ): void {
    if (override || !read || read._provisional || !read.kind) return;
    const store = briefStore();
    if (!store) return;
    try {
      const clean = { ...read } as TodayBriefControllerDayRead;
      delete clean._provisional;
      delete clean._cached;
      store.setItem(BRIEF_LS_KEY, JSON.stringify({ date, read: clean }));
    } catch {}
  }

  const CAIRN_TODAY_BRIEF_CACHE: Window["CairnTodayBriefCache"] = {
    read: readCachedBrief,
    persist: persistCachedBrief,
  };

  Object.assign(globalThis, { CairnTodayBriefCache: CAIRN_TODAY_BRIEF_CACHE });
})();
