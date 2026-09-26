// @ts-check
// Records slots (docs/V2-PLAN.md wave 3): named mount points the Stand health surface
// exposes for components another stream owns, so that stream never edits the screen.
// Today there is one, "packet" — the doctor-packet builder (stream C), hosted in Stand
// → "Share with your doctor" in an element carrying `data-slot="packet"`.
//
// Contract for a slot owner (all inside the lazy me-health bundle):
//   CairnRecordsSlot.register("packet", (host, deps) => teardown)
// at module load — this module sits ahead of stand-screen.js and every later module
// in the bundle, so it exists by then. The screen calls
//   CairnRecordsSlot.mount("packet", host, deps)
// each time it paints the Share view, and runs the returned teardown when it paints
// any other view. With nothing registered the slot stays empty (`:empty` collapses
// it) and the Share view reads as it does today. A mount that throws leaves the slot
// empty rather than breaking the view. `deps` is ClientRecordsPacketDeps.
{
  type SlotName = ClientRecordsSlotName;
  type SlotMount = ClientRecordsSlotMount;

  const SLOTS = new Map<SlotName, SlotMount>();

  function register(name: SlotName, mountFn: SlotMount): void {
    if (typeof mountFn === "function") SLOTS.set(name, mountFn);
  }

  function has(name: SlotName): boolean {
    return SLOTS.has(name);
  }

  function mount(name: SlotName, host: Element | null, deps: ClientRecordsPacketDeps): () => void {
    const fn = SLOTS.get(name);
    if (!host || !fn) return () => {};
    try {
      const teardown = fn(host, deps);
      return typeof teardown === "function" ? teardown : () => {};
    } catch {
      host.innerHTML = "";
      return () => {};
    }
  }

  const CAIRN_RECORDS_SLOT = { register, has, mount };

  Object.assign(globalThis, { CairnRecordsSlot: CAIRN_RECORDS_SLOT });
}
