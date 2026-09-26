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
  /** The pile's board: stones on the right, a label column on the left joined by leader lines. */
  const PILE_W = 340;
  const PILE_CX = 232;
  const PILE_SCALE = 1.6;
  const LABEL_X = 2;
  const LEADER_X = 116;
  /** The least vertical room one label (mono name over a serif word) needs. */
  const LABEL_GAP = 40;

  type PileStone = { key: string; tone: string; go: boolean; label?: string; word?: string };

  /**
   * The pile: the stones drawn by CairnStone's own geometry, top → base (the base
   * widest), each in its own hue with a watch stone's dawn dot. Beside each, a leader
   * line to a mono name and the server's word in serif; the labels are spread evenly
   * down the column so short upper stones never crowd their words. The ghost pile
   * draws the same stones in the skeleton's fill and says nothing.
   */
  function pileHtml(stones: ReadonlyArray<PileStone>, ghost = false): string {
    if (!stones.length) return "";
    const fx = CairnStoneModel.fx;
    const layout = CairnStoneModel.cairnLayout(stones.length, { cx: PILE_CX, scale: PILE_SCALE, pad: 8 });
    const idPrefix = ghost ? "cairn-stack-ghost" : "cairn-stack";
    const sheenId = `${idPrefix}-sheen`;
    const specs = layout.stones;
    // Labels: level with their stone, nudged down only where an upper label would crowd it.
    const labelY: number[] = [];
    specs.forEach((spec, index) => {
      const floor = index ? labelY[index - 1] + LABEL_GAP : 18;
      labelY.push(Math.max(spec.cy, floor));
    });
    const height = Math.max(layout.height, labelY[labelY.length - 1] + 22);
    const rocks = specs
      .map((spec, index) => {
        const stone = stones[index];
        return CairnStone.stoneGroup({
          ...spec,
          key: stone.key,
          seed: CairnStoneModel.seedFor(stone.key, index),
          sheenId,
          flag: stone.tone === "watch",
          drift: !ghost,
          cls: `cairn-stack-rock cairn-stack-${stone.tone}${ghost ? " stone-ghost" : ""}`,
          attrs: { "data-cairn-stack-go": stone.go ? stone.key : null, style: `--i:${index}` },
        });
      })
      .reverse()
      .join("");
    const labels = ghost
      ? ""
      : specs
          .map((spec, index) => {
            const stone = stones[index];
            const y = labelY[index];
            const end = spec.cx - spec.rx - 8;
            return `<g class="cairn-pile-label ${CairnStone.hueClass(stone.key)}" style="--i:${index}"><path class="cairn-pile-leader" d="M${fx(LEADER_X)},${fx(y)} L${fx(Math.max(LEADER_X + 8, end - 14))},${fx(y)} L${fx(end)},${fx(spec.cy)}"/><text class="cairn-pile-name" x="${LABEL_X}" y="${fx(y - 5)}">${escHtml((stone.label || "").toUpperCase())}${
              stone.tone === "watch" ? `<tspan class="cairn-pile-flag" dx="5">●</tspan>` : ""
            }</text><text class="cairn-pile-word" x="${LABEL_X}" y="${fx(y + 13)}">${escHtml(stone.word || "")}</text></g>`;
          })
          .join("");
    return `<svg class="stone-svg stone-cairn cairn-pile" viewBox="0 0 ${PILE_W} ${fx(height)}" aria-hidden="true" focusable="false">${CairnStone.sheenDefs(
      sheenId
    )}${labels}${rocks}</svg>`;
  }

  function rowHtml(stone: ClientCairnStone, index: number): string {
    const name = `${stone.label}: ${stone.word}${stone.line ? `. ${stone.line}` : ""}`;
    const inner = `<span class="cairn-stack-mark" aria-hidden="true"></span>
      <span class="cairn-stack-text"><span class="cairn-stack-top"><span class="cairn-stack-label">${escHtml(stone.label)}</span><span class="cairn-stack-sep" aria-hidden="true">·</span><span class="cairn-stack-word stone-word">${escHtml(stone.word)}</span></span>${
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
    const rocks = pileHtml(
      model.stones.map((stone) => ({ key: stone.key, tone: stone.tone, go: true, label: stone.label, word: stone.word }))
    );
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
