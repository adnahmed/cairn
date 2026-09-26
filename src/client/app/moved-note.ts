// @ts-check
// The one-time "what moved here" line of the five-home navigation (Today, Train,
// Horizon, Ask, You). Eight tabs became five, and nothing was removed, only
// re-homed, so each home's landing names once, quietly, what now lives there
// ("Health, About you and Settings now live in You"). It is shown only on a device
// that used Cairn before the change, only on the home's own landing view, and never
// again once dismissed. Per-viewer convenience state: localStorage, every access
// guarded, and the page reads correctly without it.
//
// The line sits in the shell header (#movedNote in index.html), never inside #view,
// so a renderer repainting the view cannot drop it half-read. The shell calls
// sync(view, home) on every switch (highlightHome in app/tabs.ts).

type MovedNoteStorage = Pick<Storage, "getItem" | "setItem"> & Partial<Pick<Storage, "key" | "length">>;
type MovedNoteStamp = "upgraded" | "fresh";

type MovedNoteApi = {
  STAMP_KEY: string;
  DISMISS_PREFIX: string;
  NOTES: Readonly<Record<string, { view: string; text: string }>>;
  stamp(storage: MovedNoteStorage | null): MovedNoteStamp;
  noteFor(view: string, home: string, storage: MovedNoteStorage | null): string | null;
  dismiss(home: string, storage: MovedNoteStorage | null): void;
  sync(view: string, home: string): void;
};

{
  const STAMP_KEY = "cairn.nav.homes.v1";
  const DISMISS_PREFIX = "cairn.nav.moved.v1.";
  // One line per home, shown on the home's landing view only.
  const NOTES: Readonly<Record<string, { view: string; text: string }>> = {
    today: { view: "today", text: "Food logging now opens from Today, through the Fuel card." },
    train: { view: "progress", text: "Your plan now lives in Train, under Program." },
    horizon: { view: "horizon", text: "Your race build now lives in Horizon." },
    ask: { view: "chat", text: "Coach is now Ask. The team's change record lives here too." },
    you: { view: "you", text: "Health, About you and Settings now live in You." },
  };
  // Keys that say nothing about whether this device used Cairn before: this
  // module's own, the diagnostics ring, and the install-identity stamp, any of
  // which a fresh load can write before the stamp runs.
  const NOT_PRIOR_STATE = new Set([STAMP_KEY, "cairn.diagnostics.v1", "cairn.app.identity.v1"]);

  function read(storage: MovedNoteStorage | null, key: string): string | null {
    try {
      return storage ? storage.getItem(key) : null;
    } catch {
      return null;
    }
  }

  function write(storage: MovedNoteStorage | null, key: string, value: string): void {
    try {
      storage?.setItem(key, value);
    } catch {}
  }

  function hasPriorState(storage: MovedNoteStorage): boolean {
    try {
      const length = Number(storage.length) || 0;
      for (let i = 0; i < length; i++) {
        const key = storage.key?.(i) || "";
        if (NOT_PRIOR_STATE.has(key) || key.startsWith(DISMISS_PREFIX)) continue;
        if (key.startsWith("cairn") || key === "restSec" || key.startsWith("shop:")) return true;
      }
    } catch {}
    return false;
  }

  // Decided once per device, the first time it is asked: a device that already
  // carried Cairn state had learned the old tabs; a new one never saw them.
  function stamp(storage: MovedNoteStorage | null): MovedNoteStamp {
    const stored = read(storage, STAMP_KEY);
    if (stored === "upgraded" || stored === "fresh") return stored;
    const value: MovedNoteStamp = storage && hasPriorState(storage) ? "upgraded" : "fresh";
    write(storage, STAMP_KEY, value);
    return value;
  }

  function noteFor(view: string, home: string, storage: MovedNoteStorage | null): string | null {
    const note = NOTES[home];
    if (!note || note.view !== view) return null;
    if (stamp(storage) !== "upgraded") return null;
    if (read(storage, DISMISS_PREFIX + home)) return null;
    return note.text;
  }

  function dismiss(home: string, storage: MovedNoteStorage | null): void {
    write(storage, DISMISS_PREFIX + home, "1");
  }

  function localStore(): MovedNoteStorage | null {
    try {
      return typeof localStorage !== "undefined" ? localStorage : null;
    } catch {
      return null;
    }
  }

  let wired = false;
  function sync(view: string, home: string): void {
    const el = typeof document !== "undefined" ? document.getElementById("movedNote") : null;
    if (!el) return;
    const storage = localStore();
    const text = noteFor(view, home, storage);
    if (!text) {
      el.hidden = true;
      el.innerHTML = "";
      delete el.dataset.home;
      return;
    }
    if (el.dataset.home !== home) {
      el.innerHTML =
        `<span class="moved-note-text">${escHtml(text)}</span>` +
        `<button type="button" class="linkbtn linkbtn-plain moved-note-dismiss" data-moved-dismiss>Got it</button>`;
      el.dataset.home = home;
    }
    el.hidden = false;
    if (wired) return;
    wired = true;
    el.addEventListener("click", (event) => {
      const button = (event.target as Element | null)?.closest?.("[data-moved-dismiss]");
      if (!button) return;
      dismiss(String(el.dataset.home || ""), localStore());
      el.hidden = true;
      el.innerHTML = "";
      delete el.dataset.home;
      // The header just got shorter; a pinned layout (Ask's column) re-measures.
      try {
        window.dispatchEvent(new Event("resize"));
      } catch {}
    });
  }

  const CAIRN_MOVED_NOTE: MovedNoteApi = { STAMP_KEY, DISMISS_PREFIX, NOTES, stamp, noteFor, dismiss, sync };
  Object.assign(globalThis, { CairnMovedNote: CAIRN_MOVED_NOTE });
}
