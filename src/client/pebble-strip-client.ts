// @ts-check
// The pebble strip (docs/V2-PLAN.md wave 4, `pebble-strip`), the view: one quiet row
// of six pebbles under the Brief — Strength, Endurance, Fuel, Recovery, Body, Heart —
// each a small stone tinted by the reading layer's tone class, its name, and the
// server's word printed verbatim beneath it. Each pebble is a link into its stone's
// own surface. Nothing here asks for a tap: no badge, no count, no chevron, no
// "tap to" copy, and no number. Pure strings; wired by CairnPebbleStripController.
{
  function pebbleHtml(pebble: ClientPebble, index: number): string {
    const name = `${pebble.label}: ${pebble.word}${pebble.line ? `. ${pebble.line}` : ""}`;
    const inner = `<span class="pebble-strip-stone" aria-hidden="true"></span><span class="pebble-strip-label">${escHtml(
      pebble.label
    )}</span><span class="pebble-strip-word">${escHtml(pebble.word)}</span>`;
    const cls = `pebble-strip-pebble pebble-strip-${pebble.tone}`;
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

  /** Cold load: six ghost stones in the strip's own shape, nothing said. */
  function skeletonHtml(): string {
    const items = Array.from(
      { length: 6 },
      () =>
        `<li class="pebble-strip-item"><span class="pebble-strip-pebble"><span class="pebble-strip-stone hshimmer"></span><span class="pebble-strip-ghost hshimmer hshimmer-sm"></span></span></li>`
    ).join("");
    return `<div class="pebble-strip pebble-strip-skel" aria-busy="true" aria-label="Today's stones"><ul class="pebble-strip-list">${items}</ul></div>`;
  }

  const CAIRN_PEBBLE_STRIP = { html: pebbleStripHtml, skeletonHtml };

  Object.assign(globalThis, { CairnPebbleStrip: CAIRN_PEBBLE_STRIP });
}
