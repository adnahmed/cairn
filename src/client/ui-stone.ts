// @ts-check
// The stone renderer's view (docs/DESIGN.md "Stones"): SVG strings for one stone, a
// pebble laid flat, and a stacked cairn, all drawn from CairnStoneModel's geometry.
//
// Every stone is four marks, back to front: a soft contact shadow, the rock filled
// with ITS OWN hue (the `stone-<key>` class maps it to `--s-<key>`), a vertical sheen
// over it, and a faint under-curve. A stone's reading state never changes its fill;
// the one mark a state may add is `flag` — a small dawn dot for "worth a look" — and
// the words beside the stone say the rest. Colours live in CSS (the sheen's stops are
// classes), so no markup here carries a colour literal.
//
// Pure strings; every caller string is escaped here.
{
  type Attrs = Record<string, string | number | null | undefined>;

  const fx = (n: number): string => CairnStoneModel.fx(n);

  function attrsHtml(attrs: Attrs | undefined): string {
    if (!attrs) return "";
    let out = "";
    for (const [name, value] of Object.entries(attrs)) {
      if (value == null || !/^[a-z][a-z0-9-]*$/i.test(name)) continue;
      out += ` ${name}="${escAttr(String(value))}"`;
    }
    return out;
  }

  /** A stone's hue class: `stone-<key>` for the six, `stone-plain` for anything else. */
  function hueClass(key: string): string {
    return CairnStoneModel.isStoneKey(key) ? `stone-${key}` : "stone-plain";
  }

  /** The shared vertical sheen, one per <svg>: light at the top, clear by .55, shade at the base. */
  function sheenDefs(id: string): string {
    return `<defs><linearGradient id="${escAttr(id)}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="stone-sheen-hi"/><stop offset=".55" class="stone-sheen-mid"/><stop offset="1" class="stone-sheen-lo"/></linearGradient></defs>`;
  }

  /** One stone as a <g>. Its drift phase follows the nearest `--i` (CSS), so a cairn never bobs in unison. */
  function stoneGroup(spec: ClientStoneDraw): string {
    const g = CairnStoneModel.stoneGeometry(spec);
    const cls = ["stone", hueClass(spec.key), spec.cls || ""].filter(Boolean).join(" ");
    const flag = spec.flag
      ? `<circle class="stone-flag" cx="${fx(spec.cx + spec.rx * 0.86)}" cy="${fx(spec.cy - spec.ry * 0.78)}" r="${fx(
          Math.max(2.6, spec.ry * 0.24)
        )}"/>`
      : "";
    const body = `<ellipse class="stone-contact" cx="${fx(g.shadow.cx)}" cy="${fx(g.shadow.cy)}" rx="${fx(g.shadow.rx)}" ry="${fx(
      g.shadow.ry
    )}"/><path class="stone-rock" d="${g.path}"/><path class="stone-sheen" d="${g.path}" fill="url(#${escAttr(
      spec.sheenId
    )})"/><path class="stone-under" d="${g.under}"/>${flag}`;
    const inner = spec.drift ? `<g class="stone-drift">${body}</g>` : body;
    return `<g class="${escAttr(cls)}"${attrsHtml(spec.attrs)}>${inner}</g>`;
  }

  /** One pebble, laid flat, in its own small <svg> (the stone detail's own rock). */
  function pebbleSvg(key: string, opts: { idPrefix: string; flag?: boolean; drift?: boolean; cls?: string }): string {
    const sheenId = `${opts.idPrefix}-sheen`;
    const seed = CairnStoneModel.seedFor(key);
    return `<svg class="stone-svg stone-pebble${opts.cls ? ` ${escAttr(opts.cls)}` : ""}" viewBox="0 0 48 30" aria-hidden="true" focusable="false">${sheenDefs(
      sheenId
    )}${stoneGroup({ key, cx: 24, cy: 14, rx: 20, ry: 10.5, seed, sheenId, flag: opts.flag, drift: opts.drift })}</svg>`;
  }

  /**
   * A cairn: `stones` top → base, the base widest. Each entry's `attrs`/`cls` ride on
   * that stone's <g> (a hook for the caller's own click handling), and `--i` carries
   * its position for CSS (entrance order, drift phase).
   *
   * The <g>s are EMITTED base-first: SVG paints in document order, so each upper
   * stone must come after the one it rests on to sit in front of its belly.
   */
  function cairnSvg(
    stones: ReadonlyArray<{ key: string; flag?: boolean; cls?: string; attrs?: Attrs }>,
    opts: { idPrefix: string; drift?: boolean; scale?: number; cls?: string; label?: string }
  ): string {
    if (!stones.length) return "";
    const layout = CairnStoneModel.cairnLayout(stones.length, { scale: opts.scale });
    const sheenId = `${opts.idPrefix}-sheen`;
    const groups = layout.stones
      .map((spec, index) => {
        const stone = stones[index];
        return stoneGroup({
          ...spec,
          key: stone.key,
          seed: CairnStoneModel.seedFor(stone.key, index),
          sheenId,
          flag: stone.flag,
          drift: opts.drift,
          cls: stone.cls,
          attrs: stone.attrs,
        });
      })
      .reverse()
      .join("");
    const labelled = opts.label ? ` role="img" aria-label="${escAttr(opts.label)}"` : ` aria-hidden="true"`;
    return `<svg class="stone-svg stone-cairn${opts.cls ? ` ${escAttr(opts.cls)}` : ""}" viewBox="0 0 ${fx(layout.width)} ${fx(
      layout.height
    )}"${labelled} focusable="false">${sheenDefs(sheenId)}${groups}</svg>`;
  }

  const CAIRN_STONE: Window["CairnStone"] = { sheenDefs, stoneGroup, pebbleSvg, cairnSvg, hueClass };

  Object.assign(globalThis, { CairnStone: CAIRN_STONE });
}
