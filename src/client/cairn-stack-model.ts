// @ts-check
// The cairn-stack (docs/V2-PLAN.md wave 5, `cairn-stack`), the model: GET
// /api/today/stones → the six stones stacked for the You home. Pure shaping only.
// Every name, word and line is the server's, carried verbatim
// (src/domain/today/today-stones.ts owns the words); the tone is clamped to the
// reading layer's three (`ok` / `watch` / `quiet`, unknown → `quiet`). A stone with no
// word of its own is left off rather than given one: this module never works a
// stone's word out. Where a stone OPENS is the one thing the You home decides for
// itself: its own detail (you/stone?id=<key>), never the server's own `target`.
{
  type StoneTarget = ClientYouTarget;

  const TONES: ReadonlySet<string> = new Set<ClientStoneTone>(["ok", "watch", "quiet"]);
  const KEY_PREFIX = "today:stones:";
  const PATH = "/today/stones";

  const keyFor = (date: string): string => `${KEY_PREFIX}${date}`;
  const pathFor = (date: string): string => `${PATH}?date=${encodeURIComponent(date)}`;

  function text(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
  }

  /** The stone detail route for `key`. */
  function stoneTarget(key: string): StoneTarget {
    return { tab: "you", section: "stone", id: key };
  }

  /** The stack's view model, or null when the payload is not a stones read at all. */
  function cairnStackModel(
    read: Partial<ClientStonesRead> | null | undefined,
    opts: { hrefFor?: (target: StoneTarget) => string | null } = {}
  ): ClientCairnStackModel | null {
    if (!read || typeof read !== "object" || !Array.isArray(read.stones)) return null;
    const stones: ClientCairnStone[] = [];
    const seen = new Set<string>();
    for (const stone of read.stones) {
      if (!stone || typeof stone !== "object") continue;
      const key = text(stone.key);
      const label = text(stone.label);
      const word = typeof stone.word === "string" ? stone.word.trim() : "";
      if (!key || !label || !word || seen.has(key)) continue;
      seen.add(key);
      let href: string | null = null;
      if (opts.hrefFor) {
        try {
          href = opts.hrefFor(stoneTarget(key)) || null;
        } catch {
          href = null;
        }
      }
      stones.push({
        key,
        label,
        word,
        tone: (TONES.has(String(stone.tone)) ? stone.tone : "quiet") as ClientStoneTone,
        line: text(stone.line) || null,
        href,
      });
    }
    return { date: text(read.date), stones };
  }

  const CAIRN_STACK_MODEL: Window["CairnStackModel"] = {
    KEY_PREFIX,
    keyFor,
    pathFor,
    stoneTarget,
    model: cairnStackModel,
  };

  Object.assign(globalThis, { CairnStackModel: CAIRN_STACK_MODEL });
}
