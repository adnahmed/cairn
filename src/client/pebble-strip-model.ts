// @ts-check
// The pebble strip (docs/V2-PLAN.md wave 4, `pebble-strip`), the model: GET
// /api/today/stones → six pebbles. Pure shaping only. Every word, label and line is
// the server's, carried verbatim (src/domain/today/today-stones.ts owns the words and
// speaks them through spokenSignalVoice); the tone is clamped to the reading layer's
// own three (`ok` / `watch` / `quiet`, unknown → `quiet`) and the target is the
// server's own route. A stone with no word of its own is left off rather than given
// one: this module never works a stone's word out.
{
  type StonesRead = import("../contracts/today-stones.js").TodayStonesRead;
  type StoneTarget = import("../contracts/today-stones.js").TodayStoneTarget;
  type StoneTone = import("../contracts/today-stones.js").TodayStoneTone;

  const TONES: ReadonlySet<string> = new Set<StoneTone>(["ok", "watch", "quiet"]);

  function text(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
  }

  function targetOf(value: unknown): StoneTarget | null {
    if (!value || typeof value !== "object") return null;
    const { tab, section } = value as Partial<StoneTarget>;
    if (typeof tab !== "string" || !tab) return null;
    return { tab, section: typeof section === "string" && section ? section : null } as StoneTarget;
  }

  /** The strip's view model, or null when the payload is not a stones read at all. */
  function pebbleStripModel(
    read: Partial<StonesRead> | null | undefined,
    opts: { hrefFor?: (target: StoneTarget) => string | null } = {}
  ): ClientPebbleStripModel | null {
    if (!read || typeof read !== "object" || !Array.isArray(read.stones)) return null;
    const pebbles: ClientPebble[] = [];
    for (const stone of read.stones) {
      if (!stone || typeof stone !== "object") continue;
      const key = text(stone.key);
      const label = text(stone.label);
      const word = typeof stone.word === "string" ? stone.word : "";
      if (!key || !label || !word.trim()) continue;
      const target = targetOf(stone.target);
      let href: string | null = null;
      if (target && opts.hrefFor) {
        try {
          href = opts.hrefFor(target) || null;
        } catch {
          href = null;
        }
      }
      pebbles.push({
        key,
        label,
        word,
        tone: (TONES.has(String(stone.tone)) ? stone.tone : "quiet") as StoneTone,
        line: text(stone.line) || null,
        target,
        href,
      });
    }
    return { date: text(read.date), pebbles };
  }

  const CAIRN_PEBBLE_STRIP_MODEL = { model: pebbleStripModel };

  Object.assign(globalThis, { CairnPebbleStripModel: CAIRN_PEBBLE_STRIP_MODEL });
}
