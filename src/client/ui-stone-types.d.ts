// Erased declarations for the stone renderer (docs/DESIGN.md "Stones"). Execution
// code lives in src/client/ui-stone-model.ts (geometry) and src/client/ui-stone.ts
// (SVG strings); this file only names their shapes and globals.

/** Where one stone sits and how big it is, in its SVG's user units. */
type ClientStoneSpec = { cx: number; cy: number; rx: number; ry: number; seed: number };

type ClientStoneGeometry = {
  /** The jittered superellipse outline, closed. */
  path: string;
  /** The soft contact shadow ellipse under the stone. */
  shadow: { cx: number; cy: number; rx: number; ry: number };
  /** The faint under-curve across the stone's lower half. */
  under: string;
};

type ClientCairnLayout = { stones: ClientStoneSpec[]; width: number; height: number };

/** One stone to draw: geometry plus its key (its hue), the sheen to use and optional hooks. */
type ClientStoneDraw = ClientStoneSpec & {
  key: string;
  sheenId: string;
  /** A small dawn dot: "worth a look". Never a fill change. */
  flag?: boolean;
  drift?: boolean;
  cls?: string;
  attrs?: Record<string, string | number | null | undefined>;
};

interface Window {
  CairnStoneModel: {
    STONE_KEYS: readonly ClientStoneKey[];
    isStoneKey(key: unknown): key is ClientStoneKey;
    seedFor(key: string, fallback?: number): number;
    rng(seed: number): () => number;
    fx(n: number): string;
    stonePath(cx: number, cy: number, rx: number, ry: number, seed: number): string;
    stoneGeometry(spec: ClientStoneSpec): ClientStoneGeometry;
    cairnLayout(count: number, opts?: { cx?: number; scale?: number; pad?: number }): ClientCairnLayout;
  };
  CairnStone: {
    sheenDefs(id: string): string;
    stoneGroup(spec: ClientStoneDraw): string;
    pebbleSvg(key: string, opts: { idPrefix: string; flag?: boolean; drift?: boolean; cls?: string }): string;
    cairnSvg(
      stones: ReadonlyArray<{
        key: string;
        flag?: boolean;
        cls?: string;
        attrs?: Record<string, string | number | null | undefined>;
      }>,
      opts: { idPrefix: string; drift?: boolean; scale?: number; cls?: string; label?: string }
    ): string;
    hueClass(key: string): string;
  };
}
declare const CairnStoneModel: Window["CairnStoneModel"];
declare const CairnStone: Window["CairnStone"];
