// @ts-check
// The cairn-stack (docs/V2-PLAN.md wave 5), the view. It leads the You home with the
// whole cairn:
//
//   - a small stacked cairn (CairnStone), drawn from the six stones top to bottom (the
//     base stone widest, so Heart sits under everything), each in its OWN hue — the
//     tone never becomes a fill; a stone worth a look carries a small dawn dot. It is
//     the picture, not a control: aria-hidden, and a stone tapped there opens the
//     same detail as its row.
//   - one row per stone beneath it: the stone's name, the server's word in the
//     stone's deep hue, and the server's line in muted prose. Each row is a link into
//     that stone's detail (you/stone?id=).
//
// Words and a tone only: no number, no badge, no grade. Pure strings; wired by
// CairnStackController.
{
  /** The pile: the renderer's cairn, each stone carrying the row's hook and position. */
  function pileHtml(stones: ReadonlyArray<{ key: string; tone: string; go: boolean }>, ghost = false): string {
    return CairnStone.cairnSvg(
      stones.map((stone, index) => ({
        key: stone.key,
        flag: stone.tone === "watch",
        cls: `cairn-stack-rock cairn-stack-${stone.tone}${ghost ? " stone-ghost" : ""}`,
        attrs: { "data-cairn-stack-go": stone.go ? stone.key : null, style: `--i:${index}` },
      })),
      { idPrefix: ghost ? "cairn-stack-ghost" : "cairn-stack", drift: !ghost }
    );
  }

  function rowHtml(stone: ClientCairnStone, index: number): string {
    const name = `${stone.label}: ${stone.word}${stone.line ? `. ${stone.line}` : ""}`;
    const inner = `<span class="cairn-stack-mark" aria-hidden="true"></span>
      <span class="cairn-stack-text"><span class="cairn-stack-top"><span class="cairn-stack-label">${escHtml(stone.label)}</span><span class="cairn-stack-word stone-word">${escHtml(stone.word)}</span></span>${
        stone.line ? `<span class="cairn-stack-line">${escHtml(stone.line)}</span>` : ""
      }</span>`;
    const cls = `cairn-stack-row cairn-stack-${stone.tone}`;
    const body = stone.href
      ? `<a class="${cls}" href="${escAttr(stone.href)}" data-cairn-stack-go="${escAttr(stone.key)}" aria-label="${escAttr(name)}">${inner}<span class="cairn-stack-arw" aria-hidden="true">›</span></a>`
      : `<span class="${cls}">${inner}</span>`;
    return `<li class="cairn-stack-item ${CairnStone.hueClass(stone.key)}" style="--i:${index}">${body}</li>`;
  }

  /**
   * The stack. `enter` gives the stones their one settle entrance, base stone first
   * (the controller never asks for it under reduced motion). No stones, no stack.
   */
  function cairnStackHtml(model: ClientCairnStackModel | null, opts: { enter?: boolean } = {}): string {
    if (!model || !model.stones.length) return "";
    const count = model.stones.length;
    const rocks = pileHtml(model.stones.map((stone) => ({ key: stone.key, tone: stone.tone, go: true })));
    return `<section class="cairn-stack${opts.enter ? " is-entering" : ""}" style="--n:${count}" aria-label="Your cairn today">
      <div class="cairn-stack-pile" aria-hidden="true">${rocks}</div>
      <ul class="cairn-stack-list">${model.stones.map((stone, index) => rowHtml(stone, index)).join("")}</ul>
    </section>`;
  }

  /** Cold load: the stack's own shape in ghost stones and lines, nothing said. */
  function skeletonHtml(): string {
    const rocks = pileHtml(Array.from({ length: 6 }, () => ({ key: "", tone: "quiet", go: false })), true);
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
