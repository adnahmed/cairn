// @ts-check
// The stone detail (docs/V2-PLAN.md wave 5), the view: a step back to You, the one
// stone settled large in its own hue (CairnStone; a dawn dot when it is worth a look,
// never a tone fill), its name, the server's word and line,
// then "Where it lives" — the surfaces that already own that part of the picture,
// each one quiet row. The homes paint at once; only the stone's own words wait on
// the read, and a read that never comes leaves the name and the homes standing.
// Pure strings; wired by CairnStoneDetailController.
{
  function linkHtml(link: ClientStoneHomeLink, index: number): string {
    const inner = `<span class="stone-detail-ltext"><span class="set-you-t">${escHtml(link.title)}</span><span class="set-you-s">${escHtml(link.sub)}</span></span>
      <span class="set-you-arw chev" aria-hidden="true">›</span>`;
    return link.href
      ? `<a class="set-you-card stone-detail-link reveal" style="--i:${index}" href="${escAttr(link.href)}" data-stone-detail-go="${escAttr(link.key)}">${inner}</a>`
      : `<button class="set-you-card stone-detail-link reveal" style="--i:${index}" type="button" data-stone-detail-go="${escAttr(link.key)}">${inner}</button>`;
  }

  /** One of the six in the switcher: its own dot and name, the open one current. */
  function chipHtml(peer: ClientStonePeer, current: string): string {
    const on = peer.key === current;
    return `<button class="stone-detail-chip ${CairnStone.hueClass(peer.key)}" type="button" data-stone-detail-open="${escAttr(peer.key)}"${on ? ' aria-current="page"' : ""}><span class="dot" aria-hidden="true"></span>${escHtml(peer.name)}</button>`;
  }

  /** A stone this one moves with: its dot, its name and its own word for today. */
  function peerHtml(peer: ClientStonePeer, index: number): string {
    return `<button class="stone-detail-peer ${CairnStone.hueClass(peer.key)} reveal" style="--i:${index}" type="button" data-stone-detail-open="${escAttr(peer.key)}"><span class="dot" aria-hidden="true"></span><span class="stone-detail-ptext"><b>${escHtml(peer.name)}</b>${
      peer.word ? `<span class="stone-detail-pword stone-word">${escHtml(peer.word)}</span>` : ""
    }</span><span class="chev" aria-hidden="true">›</span></button>`;
  }

  function readHtml(model: ClientStoneDetailModel, loading: boolean): string {
    const stone = model.stone;
    if (stone) {
      return `<p class="stone-detail-word stone-word">${escHtml(stone.word)}</p>${
        stone.line ? `<p class="stone-detail-line">${escHtml(stone.line)}</p>` : ""
      }`;
    }
    return loading ? `<p class="stone-detail-word"><span class="hshimmer hshimmer-sm stone-detail-ghost"></span></p>` : "";
  }

  /**
   * The detail. `enter` lets the stone settle once (never under reduced motion);
   * `loading` shows a ghost where the word will land.
   *
   * Top to bottom: the step back, the six as a switcher, the stone's head (a card
   * washed in its own hue: the name in mono, the word in serif, the line), then
   * "Where it lives" and "Moves with" — the stones this one is read alongside.
   */
  function stoneDetailHtml(model: ClientStoneDetailModel, opts: { enter?: boolean; loading?: boolean } = {}): string {
    const tone = model.stone ? model.stone.tone : "quiet";
    const back =
      typeof homeBackHtml === "function"
        ? homeBackHtml("you", "You")
        : `<button class="home-back linkbtn linkbtn-plain" type="button" data-home-back="you">‹ You</button>`;
    const rock = CairnStone.pebbleSvg(model.key, { idPrefix: "stone-detail", flag: tone === "watch", drift: true });
    const all = model.all || [];
    const peers = model.peers || [];
    return `<article class="stone-detail stone-detail-${escAttr(model.key)} ${CairnStone.hueClass(model.key)} cairn-stack-${escAttr(tone)}${opts.enter ? " is-entering" : ""}" aria-labelledby="stoneDetailH">
      ${back}
      ${all.length ? `<nav class="stone-detail-chips rail rail-bleed" aria-label="The six stones">${all.map((peer) => chipHtml(peer, model.key)).join("")}</nav>` : ""}
      <header class="stone-detail-hero">
        <div class="stone-detail-read">
          <h2 class="stone-detail-h sr-only" id="stoneDetailH">${escHtml(model.name)}</h2>
          ${readHtml(model, !!opts.loading)}
        </div>
        <span class="stone-detail-rock" aria-hidden="true">${rock}</span>
      </header>
      <section class="stone-detail-sec">
        <h3 class="lbl stone-detail-sub">Where it lives</h3>
        <nav class="set-you stone-detail-links" aria-label="${escAttr(`Where ${model.name} lives`)}">${model.links
          .map((link, index) => linkHtml(link, index))
          .join("")}</nav>
      </section>
      ${
        peers.length
          ? `<section class="stone-detail-sec">
        <h3 class="lbl stone-detail-sub">Moves with</h3>
        <div class="stone-detail-peers">${peers.map((peer, index) => peerHtml(peer, index)).join("")}</div>
      </section>`
          : ""
      }
    </article>`;
  }

  const CAIRN_STONE_DETAIL: Window["CairnStoneDetail"] = { html: stoneDetailHtml };

  Object.assign(globalThis, { CairnStoneDetail: CAIRN_STONE_DETAIL });
}
