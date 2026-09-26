// @ts-check
// The pebble strip (docs/V2-PLAN.md wave 4, `pebble-strip`), the view: one quiet row
// of six pebbles under the Brief — Strength, Endurance, Fuel, Recovery, Body, Heart —
// each the cairn's own stone laid flat (CairnStone, in the stone's OWN hue), its name,
// and the server's word printed verbatim beneath it in the stone's deep hue. The tone
// rides as a class and adds at most a small dawn dot ("worth a look"); it never
// becomes the stone's fill. Each pebble is a link into its stone's
// own surface. Nothing here asks for a tap: no badge, no count, no chevron, no
// "tap to" copy, and no number. Pure strings; wired by CairnPebbleStripController.
{
  function pebbleHtml(pebble: ClientPebble, index: number): string {
    const name = `${pebble.label}: ${pebble.word}${pebble.line ? `. ${pebble.line}` : ""}`;
    const stone = CairnStone.pebbleSvg(pebble.key, { idPrefix: `pebble-${pebble.key}`, flag: pebble.tone === "watch" });
    const inner = `<span class="pebble-strip-stone" aria-hidden="true">${stone}</span><span class="pebble-strip-label">${escHtml(
      pebble.label
    )}</span><span class="pebble-strip-word">${escHtml(pebble.short || pebble.word)}</span>`;
    const cls = `pebble-strip-pebble pebble-strip-${pebble.tone} ${CairnStone.hueClass(pebble.key)}`;
    const body = pebble.href
      ? `<a class="${cls}" href="${escAttr(pebble.href)}" data-pebble-strip-go="${escAttr(pebble.key)}" aria-label="${escAttr(name)}">${inner}</a>`
      : `<span class="${cls}">${inner}</span>`;
    return `<li class="pebble-strip-item" style="--i:${index}">${body}</li>`;
  }

  /**
   * The strip. `enter` gives the stones their one settle entrance (the controller
   * never asks for it under reduced motion). No pebbles, no strip: the slot collapses.
   */
  function pebbleStripHtml(model: ClientPebbleStripModel | null, opts: { enter?: boolean } = {}): string {
    if (!model || !model.pebbles.length) return "";
    return `<nav class="pebble-strip${opts.enter ? " is-entering" : ""}" aria-label="Today's stones"><ul class="pebble-strip-list">${model.pebbles
      .map((pebble, index) => pebbleHtml(pebble, index))
      .join("")}</ul></nav>`;
  }

  /** Cold load: six ghost stones in the strip's own shape and height, nothing said. */
  function skeletonHtml(): string {
    const items = Array.from(
      { length: 6 },
      () =>
        // The ghost label and word lines carry the real lines' type metrics, so the ghost
        // row is exactly the real row's height and the Brief below never moves when the
        // stones land.
        `<li class="pebble-strip-item"><span class="pebble-strip-pebble"><span class="pebble-strip-stone hshimmer"></span><span class="pebble-strip-ghost-line pebble-strip-ghost-label">&nbsp;</span><span class="pebble-strip-ghost-line pebble-strip-ghost-word">&nbsp;</span></span></li>`
    ).join("");
    return `<div class="pebble-strip pebble-strip-skel" aria-busy="true" aria-label="Today's stones"><ul class="pebble-strip-list">${items}</ul></div>`;
  }

  const CAIRN_PEBBLE_STRIP = { html: pebbleStripHtml, skeletonHtml };

  Object.assign(globalThis, { CairnPebbleStrip: CAIRN_PEBBLE_STRIP });
}
