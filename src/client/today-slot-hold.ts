// @ts-check
// Today's slot hold: a same-date rewrite of Today keeps what was already on screen.
//
// Today paints its frame in one write and then fills a dozen async slots (the fuel
// glance, the conductor thread, the context banner, the wearable strip, tag chips,
// the whole rail and its cards) one request at a time. A re-render of a Today that is
// ALREADY on screen — a resume after a few minutes away, an SWR revalidation that
// found a changed slice, a Brief whose day kind moved — used to write every one of
// those slots EMPTY and let them refill as their reads landed: the screen visibly
// rebuilt itself from the cached paint into the fresh one, blank and all, even when
// nothing had changed.
//
// The hold captures each async slot's markup BEFORE the rewrite and puts it back
// into the matching (still empty) slot right after, marked `data-held` and `inert`:
// the same pixels in the same space, never a live control (those listeners belonged
// to the nodes that were just replaced). The slot's own loader then writes it as it
// always does; that write releases the hold. A write identical to the held markup is
// QUIET (`slot-quiet` switches its entrance animation off, so an unchanged card never
// re-plays its rise); a different one animates as designed — that is a real change.
// A loader that never writes back (it failed, or the card is gone) lets the hold
// expire into the empty slot it would have left before.
//
// `<details>` open state rides along by id, so an open "Around today" or "more" fold
// is not snapped shut by a background refresh.

type TodaySlotHoldSnapshot = {
  slots: Map<string, string>;
  rail: string | null;
  open: Set<string>;
};

type TodaySlotHoldApi = {
  capture(root: ParentNode): TodaySlotHoldSnapshot;
  apply(root: ParentNode, snapshot: TodaySlotHoldSnapshot | null | undefined, opts?: { rail?: boolean }): number;
  release(slot: Element): void;
  heldCount(root: ParentNode): number;
  // The slot ids the hold covers (exported for tests and the snapshot guard).
  SLOT_IDS: readonly string[];
  EXPIRE_MS: number;
};

(() => {
  // Async slots only. Anything the render writes synchronously with its frame is
  // deliberately absent — holding it would race that write: the run line reuses its
  // own cache, the Brief's check-in paints from its own memo, and the fuel glance
  // (#todayFuelSlot) is created by its mount after the write and paints from the
  // SWR cache in the same turn.
  // #attentionLead and #changesLineSlot are absent too: the agenda MOVES a rail slot
  // into the first (a held copy there would sit beside the real card), and the
  // second is created by its own mount after the write.
  const SLOT_IDS = [
    "ctxEvents",
    "ctxHealth",
    "cfocusSlot",
    "sugSlot",
    "tagsSlot",
    "wearStrip",
    "wearBands",
    "briefProvenance",
    "weeklySlot",
    "fuelingSlot",
    "insightSlot",
    "weekAheadSlot",
    "adjustSlot",
    "garminReconcileSlot",
    "fuelSlot",
    "qlRecent",
  ] as const;
  // Open folds worth keeping open across a rewrite: any <details> with an id, plus
  // the Brief's "around today" fold, which has none.
  const OPEN_CLASS_KEYS = ["brief-around"] as const;
  const EXPIRE_MS = 10000;

  function hasObserver(): boolean {
    return typeof MutationObserver === "function";
  }

  function detailsKey(el: Element): string | null {
    if (el.id) return "#" + el.id;
    for (const cls of OPEN_CLASS_KEYS) if (el.classList.contains(cls)) return "." + cls;
    return null;
  }

  function capture(root: ParentNode): TodaySlotHoldSnapshot {
    const slots = new Map<string, string>();
    const open = new Set<string>();
    let rail: string | null = null;
    if (!root || typeof root.querySelector !== "function") return { slots, rail, open };
    for (const id of SLOT_IDS) {
      const el = root.querySelector(`#${id}`);
      const html = el ? String(el.innerHTML || "") : "";
      if (html.trim()) slots.set(id, html);
    }
    const railEl = root.querySelector(".today-rail");
    if (railEl && String(railEl.innerHTML || "").trim()) rail = railEl.innerHTML;
    root.querySelectorAll("details").forEach((d) => {
      const key = detailsKey(d);
      if (key && (d as HTMLDetailsElement).open) open.add(key);
    });
    return { slots, rail, open };
  }

  function setHeld(el: Element, on: boolean): void {
    if (on) {
      el.setAttribute("data-held", "");
      el.setAttribute("inert", "");
    } else {
      el.removeAttribute("data-held");
      el.removeAttribute("inert");
    }
  }

  const expiries = new WeakMap<Element, ReturnType<typeof setTimeout>>();
  const observers = new WeakMap<Element, MutationObserver>();

  function release(slot: Element): void {
    if (!slot || !slot.hasAttribute("data-held")) return;
    const timer = expiries.get(slot);
    if (timer !== undefined && typeof clearTimeout === "function") clearTimeout(timer);
    expiries.delete(slot);
    observers.get(slot)?.disconnect();
    observers.delete(slot);
    setHeld(slot, false);
  }

  // Watch a held slot until its loader writes it. The first write releases the
  // hold; an identical write stays quiet until the NEXT genuine change, which gets
  // its entrance back (the class comes off in the same turn the new nodes go in).
  function watch(slot: Element, held: string): void {
    if (!hasObserver()) return;
    let released = false;
    const observer = new MutationObserver(() => {
      if (!released) {
        released = true;
        const same = String(slot.innerHTML || "") === held;
        release(slot);
        if (same) {
          slot.classList.add("slot-quiet");
          // Keep listening once more: the next write is a real change.
          const after = new MutationObserver(() => {
            slot.classList.remove("slot-quiet");
            after.disconnect();
          });
          after.observe(slot, { childList: true });
        }
        return;
      }
    });
    observer.observe(slot, { childList: true });
    observers.set(slot, observer);
    if (typeof setTimeout === "function") {
      const timer = setTimeout(() => {
        if (!slot.hasAttribute("data-held")) return;
        // Never written back: settle on what the loader would have left (empty),
        // quietly, rather than a dead copy of the old card.
        observer.disconnect();
        observers.delete(slot);
        slot.innerHTML = "";
        release(slot);
      }, EXPIRE_MS);
      (timer as { unref?: () => void }).unref?.();
      expiries.set(slot, timer);
    }
  }

  function fill(el: Element, html: string): boolean {
    if (String(el.innerHTML || "").trim()) return false;
    el.innerHTML = html;
    setHeld(el, true);
    watch(el, html);
    return true;
  }

  // Put the captured markup back into the matching EMPTY slots under `root`. With
  // `rail: true` the reserved (empty) rail aside takes the whole old rail too — the
  // agenda rail replaces that aside wholesale when it lands, and apply() then runs
  // again for the slots inside the new one. Returns how many slots were filled.
  function apply(
    root: ParentNode,
    snapshot: TodaySlotHoldSnapshot | null | undefined,
    opts: { rail?: boolean } = {}
  ): number {
    if (!snapshot || !root || typeof root.querySelector !== "function" || !hasObserver()) return 0;
    let filled = 0;
    for (const [id, html] of snapshot.slots) {
      const el = root.querySelector(`#${id}`);
      if (el && !el.closest("[data-held]") && fill(el, html)) filled++;
    }
    if (opts.rail && snapshot.rail) {
      const railEl = root.querySelector(".today-rail");
      if (railEl && fill(railEl, snapshot.rail)) filled++;
    }
    root.querySelectorAll("details").forEach((d) => {
      const key = detailsKey(d);
      if (key && snapshot.open.has(key)) (d as HTMLDetailsElement).open = true;
    });
    return filled;
  }

  function heldCount(root: ParentNode): number {
    return root && typeof root.querySelectorAll === "function" ? root.querySelectorAll("[data-held]").length : 0;
  }

  const CAIRN_TODAY_SLOT_HOLD: TodaySlotHoldApi = { capture, apply, release, heldCount, SLOT_IDS, EXPIRE_MS };

  Object.assign(globalThis, { CairnTodaySlotHold: CAIRN_TODAY_SLOT_HOLD });
  if (typeof window !== "undefined") Object.assign(window, { CairnTodaySlotHold: CAIRN_TODAY_SLOT_HOLD });
})();
