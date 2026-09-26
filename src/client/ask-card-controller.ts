// @ts-check
// The ask card controller. `mountAskCards(host, deps)` paints the remaining asks
// (GET /api/brain/decisions/waiting) into `host` from the SWR cache first, revalidates
// quietly, and wires the one optional door ("Talk it through" → chat, pre-filled).
// A missing read leaves the slot empty — it never blocks the Changes feed beside it.
// Idempotent per host through CairnUiActions.mount; returns the teardown.
{
  type AskCardDeps = {
    peekCached<T = unknown>(key: string): { data: T; fresh: boolean } | null;
    cachedApi(
      path: string,
      options?: { key?: string; onUpgrade?(data: unknown, meta: { changed: boolean }): void }
    ): Promise<unknown>;
    gotoChatWith(text: string): unknown;
  };

  // A `health:` key is memory-tier only (swr-cache.ts _swrMemOnly): the "For you and
  // your doctor" notes are clinical text and never reach disk.
  const KEY = "health:asks";
  const PATH = "/brain/decisions/waiting?limit=8";

  function mountAskCards(host: Element, deps: AskCardDeps): () => void {
    let rows: unknown = null;
    let generation = 0;
    const live = (gen: number): boolean => gen === generation && host.isConnected;
    const paint = (data: unknown): void => {
      rows = data;
      host.innerHTML = CairnAskCard.asksHtml(data);
    };

    const teardown = CairnUiActions.mount(host, "askcard", ({ delegate }) => {
      delegate("click", {
        "askcard-talk": (el) => {
          const text = CairnAskCard.talkPrefill(rows, el.getAttribute("data-askcard-talk"));
          if (text) deps.gotoChatWith(text);
        },
      });
      return () => {
        generation += 1;
      };
    });

    const gen = ++generation;
    const peek = deps.peekCached(KEY);
    if (peek && Array.isArray(peek.data)) paint(peek.data);
    else host.innerHTML = "";
    deps
      .cachedApi(PATH, {
        key: KEY,
        onUpgrade: (data, { changed }) => {
          if (live(gen) && (changed || !peek)) paint(data);
        },
      })
      .then((data) => {
        if (live(gen) && rows == null) paint(data);
      })
      .catch(() => {
        // An ask read that fails leaves the last paint (or nothing) in place.
      });
    return teardown;
  }

  const CAIRN_ASK_CARD_CONTROLLER = {
    KEY,
    PATH,
    mount: mountAskCards,
  };

  Object.assign(globalThis, { CairnAskCardController: CAIRN_ASK_CARD_CONTROLLER });
}
