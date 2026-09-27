// @ts-check
// The stone renderer's model (docs/DESIGN.md "Stones"): pure geometry for the one
// stone every surface draws — the You cairn, the stone detail. A stone is an
// organic superellipse whose outline is jittered by a SEEDED
// generator, so the same stone keeps the same shape on every paint, device and
// reload. Nothing here knows a colour: a stone's hue is its key (`--s-<key>`),
// applied by the view through a class, and its state is never a fill.
//
// Pure numbers and path strings; no DOM, no globals read. Drawn by CairnStone.
{
  const STONE_KEYS: readonly ClientStoneKey[] = ["strength", "endurance", "recovery", "fuel", "body", "heart"];
  const KEY_SET: ReadonlySet<string> = new Set<string>(STONE_KEYS);

  /** Points around the outline, and the superellipse exponent that squares it off. */
  const OUTLINE_POINTS = 16;
  const SQUARENESS = 2.7;
  /** ± half this fraction of radius, per point. */
  const JITTER = 0.1;
  /** The lower half sits flatter: a stone rests on its belly. */
  const BELLY = 0.84;

  /** One decimal place, "-0" folded to "0": stable, compact path numbers. */
  function fx(n: number): string {
    const r = Math.round(n * 10) / 10;
    return Object.is(r, -0) ? "0" : String(r);
  }

  /** Park–Miller minimal standard generator: a seed always yields the same sequence. */
  function rng(seed: number): () => number {
    let s = Math.floor(Math.abs(seed)) % 2147483647;
    if (s <= 0) s += 2147483646;
    return () => {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };
  }

  function isStoneKey(key: unknown): key is ClientStoneKey {
    return typeof key === "string" && KEY_SET.has(key);
  }

  /** The stone's fixed seed: its place in the six, so Heart is always Heart's shape. */
  function seedFor(key: string, fallback = 0): number {
    const index = STONE_KEYS.indexOf(key as ClientStoneKey);
    return (index >= 0 ? index : fallback) + 3;
  }

  /**
   * The outline: OUTLINE_POINTS points on a superellipse (exponent SQUARENESS), each
   * scaled by a seeded ±JITTER/2, the lower half flattened by BELLY, closed with a
   * Catmull-Rom → cubic Bézier pass so the rim reads as worn, never polygonal.
   */
  function stonePoints(cx: number, cy: number, rx: number, ry: number, seed: number): Array<[number, number]> {
    const next = rng(seed * 7919 + 13);
    const points: Array<[number, number]> = [];
    for (let i = 0; i < OUTLINE_POINTS; i++) {
      const a = (i / OUTLINE_POINTS) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      let x = Math.sign(c) * Math.abs(c) ** (2 / SQUARENESS) * rx;
      let y = Math.sign(s) * Math.abs(s) ** (2 / SQUARENESS) * ry;
      const k = 1 + (next() - 0.5) * JITTER;
      x *= k;
      y *= k;
      if (s > 0) y *= BELLY;
      points.push([cx + x, cy + y]);
    }
    return points;
  }

  function stonePath(cx: number, cy: number, rx: number, ry: number, seed: number): string {
    const pts = stonePoints(cx, cy, rx, ry, seed);
    const n = pts.length;
    let d = `M${fx(pts[0][0])},${fx(pts[0][1])}`;
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n];
      const p1 = pts[i];
      const p2 = pts[(i + 1) % n];
      const p3 = pts[(i + 2) % n];
      d += `C${fx(p1[0] + (p2[0] - p0[0]) / 6)},${fx(p1[1] + (p2[1] - p0[1]) / 6)} ${fx(p2[0] - (p3[0] - p1[0]) / 6)},${fx(
        p2[1] - (p3[1] - p1[1]) / 6
      )} ${fx(p2[0])},${fx(p2[1])}`;
    }
    return `${d}Z`;
  }

  /** Everything one stone draws: its outline, the contact shadow under it, the faint under-curve. */
  function stoneGeometry(spec: ClientStoneSpec): ClientStoneGeometry {
    const { cx, cy, rx, ry } = spec;
    return {
      path: stonePath(cx, cy, rx, ry, spec.seed),
      shadow: { cx: cx + rx * 0.05, cy: cy + ry * 0.8, rx: rx * 0.9, ry: ry * 0.26 },
      under: `M${fx(cx - rx * 0.66)},${fx(cy + ry * 0.12)} Q${fx(cx)},${fx(cy + ry * 0.5)} ${fx(cx + rx * 0.7)},${fx(cy)}`,
    };
  }

  /** Top → base radii for a six-stone cairn; a shorter cairn keeps the BASE end. */
  const CAIRN_RX = [30, 37, 43, 49, 55, 62];
  const CAIRN_RY = [13, 15, 16.5, 18, 19.5, 21];
  /** Gentle x-offsets, top → base: a stacked cairn, never a ruler-straight column. */
  const CAIRN_OFFSETS = [-3, 6, -5, 8, -7, 0];

  /**
   * A cairn of `count` stones, index 0 at the TOP, the base widest. Each stone rests
   * on the one below it with a small overlap, centred on `cx` with the gentle offsets.
   * Returns specs plus the height it needs (base resting on `height - pad`).
   */
  function cairnLayout(count: number, opts: { cx?: number; scale?: number; pad?: number } = {}): ClientCairnLayout {
    const n = Math.max(0, Math.min(CAIRN_RX.length, Math.floor(count)));
    const scale = opts.scale && opts.scale > 0 ? opts.scale : 1;
    const pad = opts.pad ?? 6;
    const cx = opts.cx ?? 70 * scale;
    const first = CAIRN_RX.length - n;
    const rest: ClientStoneSpec[] = [];
    // Build base-up so each stone sits on the one below it, then flip to top-first.
    let floor = 0;
    for (let i = n - 1; i >= 0; i--) {
      const rx = CAIRN_RX[first + i] * scale;
      const ry = CAIRN_RY[first + i] * scale;
      const cy = floor - ry * 0.92;
      rest.push({ cx: cx + CAIRN_OFFSETS[first + i] * scale, cy, rx, ry, seed: i + 3 });
      floor = cy - ry * 0.92 + 5 * scale;
    }
    const top = rest.length ? Math.min(...rest.map((s) => s.cy - s.ry)) : 0;
    const shift = pad - top;
    const stones = rest.reverse().map((s) => ({ ...s, cy: s.cy + shift }));
    const baseShadow = stones.length ? stones[stones.length - 1] : null;
    const height = baseShadow ? baseShadow.cy + baseShadow.ry * 1.1 + pad : pad * 2;
    return { stones, width: cx * 2, height };
  }

  const CAIRN_STONE_MODEL: Window["CairnStoneModel"] = {
    STONE_KEYS,
    isStoneKey,
    seedFor,
    rng,
    fx,
    stonePath,
    stoneGeometry,
    cairnLayout,
  };

  Object.assign(globalThis, { CairnStoneModel: CAIRN_STONE_MODEL });
}
