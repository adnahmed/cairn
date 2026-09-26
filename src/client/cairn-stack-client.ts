// @ts-check
// The cairn-stack (docs/V2-PLAN.md wave 5), the view. It leads the You home with the
// whole cairn:
//
//   - a small stacked cairn, drawn from the six stones top to bottom (the base stone
//     widest, so Heart sits under everything), each tinted by the reading layer's
//     tone. It is the picture, not a control: aria-hidden, and a stone tapped there
//     opens the same detail as its row.
//   - one row per stone beneath it: the stone's name, the server's word in its tone,
//     and the server's line in muted prose. Each row is a link into that stone's
//     detail (you/stone?id=).
//
// Words and a tone only: no number, no badge, no grade. Pure strings; wired by
// CairnStackController.
{
  const STONE = (key: string, tone: string, index: number): string =>
    `<span class="cairn-stack-rock cairn-stack-${escAttr(tone)}" data-cairn-stack-go="${escAttr(key)}" style="--i:${index}"></span>`;

  function rowHtml(stone: ClientCairnStone, index: number): string {
    const name = `${stone.label}: ${stone.word}${stone.line ? `. ${stone.line}` : ""}`;
    const inner = `<span class="cairn-stack-mark" aria-hidden="true"></span>
      <span class="cairn-stack-text"><span class="cairn-stack-top"><span class="cairn-stack-label">${escHtml(stone.label)}</span><span class="cairn-stack-word">${escHtml(stone.word)}</span></span>${
        stone.line ? `<span class="cairn-stack-line">${escHtml(stone.line)}</span>` : ""
      }</span>`;
    const cls = `cairn-stack-row cairn-stack-${stone.tone}`;
    const body = stone.href
      ? `<a class="${cls}" href="${escAttr(stone.href)}" data-cairn-stack-go="${escAttr(stone.key)}" aria-label="${escAttr(name)}">${inner}<span class="cairn-stack-arw" aria-hidden="true">›</span></a>`
      : `<span class="${cls}">${inner}</span>`;
    return `<li class="cairn-stack-item" style="--i:${index}">${body}</li>`;
  }

  /**
   * The stack. `enter` gives the stones their one settle entrance, base stone first
   * (the controller never asks for it under reduced motion). No stones, no stack.
   */
  function cairnStackHtml(model: ClientCairnStackModel | null, opts: { enter?: boolean } = {}): string {
    if (!model || !model.stones.length) return "";
    const count = model.stones.length;
    const rocks = model.stones.map((stone, index) => STONE(stone.key, stone.tone, index)).join("");
    return `<section class="cairn-stack${opts.enter ? " is-entering" : ""}" style="--n:${count}" aria-label="Your cairn today">
      <div class="cairn-stack-pile" aria-hidden="true">${rocks}</div>
      <ul class="cairn-stack-list">${model.stones.map((stone, index) => rowHtml(stone, index)).join("")}</ul>
    </section>`;
  }

  /** Cold load: the stack's own shape in ghost stones and lines, nothing said. */
  function skeletonHtml(): string {
    const rocks = Array.from(
      { length: 6 },
      (_, index) => `<span class="cairn-stack-rock cairn-stack-quiet hshimmer" style="--i:${index}"></span>`
    ).join("");
    const rows = Array.from(
      { length: 6 },
      () =>
        `<li class="cairn-stack-item"><span class="cairn-stack-row"><span class="cairn-stack-mark hshimmer"></span><span class="cairn-stack-text"><span class="hshimmer hshimmer-sm cairn-stack-ghost"></span></span></span></li>`
    ).join("");
    return `<section class="cairn-stack cairn-stack-skel" style="--n:6" aria-busy="true" aria-label="Your cairn today">
      <div class="cairn-stack-pile" aria-hidden="true">${rocks}</div>
      <ul class="cairn-stack-list">${rows}</ul>
    </section>`;
  }

  const CAIRN_STACK: Window["CairnStack"] = { html: cairnStackHtml, skeletonHtml };

  Object.assign(globalThis, { CairnStack: CAIRN_STACK });
}
