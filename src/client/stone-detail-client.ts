// @ts-check
// The stone detail (docs/V2-PLAN.md wave 5), the view: a step back to You, the one
// stone settled large and tinted by its tone, its name, the server's word and line,
// then "Where it lives" — the surfaces that already own that part of the picture,
// each one quiet row. The homes paint at once; only the stone's own words wait on
// the read, and a read that never comes leaves the name and the homes standing.
// Pure strings; wired by CairnStoneDetailController.
{
  function linkHtml(link: ClientStoneHomeLink, index: number): string {
    const inner = `<span class="set-you-t">${escHtml(link.title)}</span><span class="set-you-s">${escHtml(link.sub)}</span>
      <span class="set-you-arw" aria-hidden="true">›</span>`;
    return link.href
      ? `<a class="set-you-card stone-detail-link reveal" style="--i:${index}" href="${escAttr(link.href)}" data-stone-detail-go="${escAttr(link.key)}">${inner}</a>`
      : `<button class="set-you-card stone-detail-link reveal" style="--i:${index}" type="button" data-stone-detail-go="${escAttr(link.key)}">${inner}</button>`;
  }

  function readHtml(model: ClientStoneDetailModel, loading: boolean): string {
    const stone = model.stone;
    if (stone) {
      return `<p class="stone-detail-word">${escHtml(stone.word)}</p>${
        stone.line ? `<p class="stone-detail-line">${escHtml(stone.line)}</p>` : ""
      }`;
    }
    return loading ? `<p class="stone-detail-word"><span class="hshimmer hshimmer-sm stone-detail-ghost"></span></p>` : "";
  }

  /**
   * The detail. `enter` lets the stone settle once (never under reduced motion);
   * `loading` shows a ghost where the word will land.
   */
  function stoneDetailHtml(model: ClientStoneDetailModel, opts: { enter?: boolean; loading?: boolean } = {}): string {
    const tone = model.stone ? model.stone.tone : "quiet";
    const back =
      typeof homeBackHtml === "function"
        ? homeBackHtml("you", "You")
        : `<button class="home-back linkbtn linkbtn-plain" type="button" data-home-back="you">‹ You</button>`;
    return `<article class="stone-detail stone-detail-${escAttr(model.key)} cairn-stack-${escAttr(tone)}${opts.enter ? " is-entering" : ""}" aria-labelledby="stoneDetailH">
      ${back}
      <header class="stone-detail-hero">
        <span class="stone-detail-rock" aria-hidden="true"></span>
        <div class="stone-detail-read">
          <h2 class="stone-detail-h" id="stoneDetailH">${escHtml(model.name)}</h2>
          ${readHtml(model, !!opts.loading)}
        </div>
      </header>
      <h3 class="lbl stone-detail-sub">Where it lives</h3>
      <nav class="set-you stone-detail-links" aria-label="${escAttr(`Where ${model.name} lives`)}">${model.links
        .map((link, index) => linkHtml(link, index))
        .join("")}</nav>
    </article>`;
  }

  const CAIRN_STONE_DETAIL: Window["CairnStoneDetail"] = { html: stoneDetailHtml };

  Object.assign(globalThis, { CairnStoneDetail: CAIRN_STONE_DETAIL });
}
