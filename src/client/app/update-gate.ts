// @ts-check
// When a new shell takes control, reload only when it cannot cost the athlete a thing.
//
// sw.js skipWaiting()s and clients.claim()s, so a deploy fires `controllerchange`
// on every open page the moment the new worker activates — which, with the resume
// update checks in sw-recovery.ts, can be mid-set, mid-sheet, mid-sentence. A blind
// location.reload() there dropped the open sheet, the half-typed note and the scroll
// position of a workout in progress. The rule now:
//   - the page is hidden (the athlete is not looking), and nothing is being typed:
//     reload now — they come back to the new shell;
//   - visible, and nothing is in flight (no session screen, no open sheet, no focused
//     input, no running rest timer, no unsent chat/food draft, no queued writes):
//     reload now, exactly as before;
//   - otherwise: one quiet "Updated — tap to refresh" line, and reload by itself the
//     next time the page is hidden and safe.
// The installed-PWA self-update guarantee holds: the new worker is already live and
// serving the new shell; the only thing deferred is swapping the page under a hand
// that is still using it.

type UpdateGateInput = {
  hidden: boolean;
  sessionActive: boolean;
  sheetOpen: boolean;
  editing: boolean;
  typing: boolean;
  restActive: boolean;
  draftUnsent: boolean;
  outboxPending: boolean;
};

type UpdateGateRoot = typeof globalThis & {
  state?: { tab?: string };
  CairnRestTimer?: { isActive?: () => boolean };
  outboxCount?: () => number;
};

type UpdateGateApi = {
  isSafe(input: UpdateGateInput): boolean;
  snapshot(): UpdateGateInput;
  onControllerChange(reload: () => void): "reloaded" | "deferred";
  reloadIfPending(): boolean;
  hasPending(): boolean;
  whenLoadedAndIdle(run: () => void): void;
  controllerChangeListener(hadController: boolean, reload: () => void): () => void;
  LINE_TEXT: string;
  DRAFT_KEYS: readonly string[];
};

{
  const LINE_TEXT = "Updated — tap to refresh";
  // Drafts a reload would not lose (they persist) but that mean the athlete is
  // mid-thought: a visible page with one waits for the tap.
  const DRAFT_KEYS: readonly string[] = ["cairn.chat.draft", "cairn.fuelLogDraft"];

  function isSafe(input: UpdateGateInput): boolean {
    if (input.hidden) return !input.typing;
    return !(
      input.sessionActive ||
      input.sheetOpen ||
      input.editing ||
      input.typing ||
      input.restActive ||
      input.draftUnsent ||
      input.outboxPending
    );
  }

  function isEditable(el: Element | null): el is HTMLElement {
    if (!el || typeof HTMLElement === "undefined" || !(el instanceof HTMLElement)) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName;
    if (tag === "TEXTAREA" || tag === "SELECT") return true;
    if (tag !== "INPUT") return false;
    const type = String((el as HTMLInputElement).type || "text").toLowerCase();
    return !["button", "submit", "reset", "checkbox", "radio", "range", "color", "file", "image", "hidden"].includes(type);
  }

  function readDraft(key: string): boolean {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return false;
      try {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed === "string") return parsed.trim().length > 0;
        if (parsed && typeof parsed === "object") {
          const text = (parsed as { text?: unknown }).text;
          return typeof text === "string" ? text.trim().length > 0 : Object.keys(parsed).length > 0;
        }
        return !!parsed;
      } catch {
        return raw.trim().length > 0;
      }
    } catch {
      return false;
    }
  }

  function snapshot(): UpdateGateInput {
    const root = globalThis as UpdateGateRoot;
    const doc = typeof document !== "undefined" ? document : null;
    const active = doc ? doc.activeElement : null;
    const editing = isEditable(active);
    let typing = false;
    if (editing && active) {
      const field = active as HTMLInputElement;
      typing = active.isContentEditable || (typeof field.value === "string" && field.value !== (field.defaultValue ?? ""));
    }
    let restActive = false;
    try {
      restActive = !!root.CairnRestTimer?.isActive?.();
    } catch {}
    let outboxPending = false;
    try {
      outboxPending = typeof root.outboxCount === "function" && Number(root.outboxCount()) > 0;
    } catch {}
    return {
      hidden: !!doc && doc.visibilityState === "hidden",
      sessionActive: root.state?.tab === "session",
      sheetOpen: !!doc?.querySelector?.('[data-ui-sheet], [aria-modal="true"], dialog[open]'),
      editing,
      typing,
      restActive,
      draftUnsent: DRAFT_KEYS.some(readDraft),
      outboxPending,
    };
  }

  function showLine(reload: () => void): void {
    if (typeof document === "undefined" || !document.body) return;
    if (document.querySelector(".update-line")) return;
    const line = document.createElement("button");
    line.type = "button";
    line.className = "update-line";
    line.setAttribute("role", "status");
    line.setAttribute("aria-live", "polite");
    line.textContent = LINE_TEXT;
    line.addEventListener("click", () => reload());
    document.body.appendChild(line);
    const show = () => line.classList.add("show");
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(show);
    else show();
  }

  let deferred = false;
  let pendingReload: (() => void) | null = null;

  // A deferred page still runs the OLD bundles while the new worker already serves
  // the NEW shell, so it must not pull a lazy bundle (app/lazy-bundles.ts) across
  // that line: a navigation that would is a safe point, and takes the update.
  function reloadIfPending(): boolean {
    if (!pendingReload) return false;
    pendingReload();
    return true;
  }

  // An idle warm-up is not a safe point: it asks, and stops rather than reload.
  function hasPending(): boolean {
    return pendingReload != null;
  }

  function onControllerChange(reload: () => void): "reloaded" | "deferred" {
    if (isSafe(snapshot())) {
      reload();
      return "reloaded";
    }
    pendingReload = reload;
    showLine(reload);
    if (!deferred && typeof document !== "undefined" && typeof document.addEventListener === "function") {
      deferred = true;
      const onHide = () => {
        if (document.visibilityState !== "hidden") return;
        if (!isSafe(snapshot())) return;
        document.removeEventListener("visibilitychange", onHide);
        reload();
      };
      document.addEventListener("visibilitychange", onHide);
    }
    return "deferred";
  }

  // ---- shared by both service-worker lifecycle copies ----
  // (app/service-worker.ts and app/sw-recovery.ts start the same lifecycle; this
  // module loads before either, so the timing and the reload rule live here once.)

  // After the window's load event, then the next idle slot (bounded, so a busy
  // page still registers within a few seconds). Without a DOM or the timing APIs
  // (tests, an old engine) it runs at once.
  function whenLoadedAndIdle(run: () => void): void {
    const idle = (): void => {
      const ric = (globalThis as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number })
        .requestIdleCallback;
      if (typeof ric === "function") ric(run, { timeout: 3000 });
      else if (typeof setTimeout === "function") setTimeout(run, 1);
      else run();
    };
    const doc = typeof document !== "undefined" ? document : null;
    const win = typeof window !== "undefined" ? window : null;
    if (!doc || !doc.readyState || doc.readyState === "complete" || !win || typeof win.addEventListener !== "function") {
      idle();
      return;
    }
    win.addEventListener("load", idle, { once: true });
  }

  // The `controllerchange` listener: the first-ever install (no prior controller)
  // never reloads; otherwise the gate decides WHEN, and the reload fires once.
  function controllerChangeListener(hadController: boolean, reload: () => void): () => void {
    let reloading = false;
    const reloadOnce = (): void => {
      if (reloading) return;
      reloading = true;
      reload();
    };
    return () => {
      if (!hadController || reloading) return;
      try {
        CAIRN_UPDATE_GATE.onControllerChange(reloadOnce);
        return;
      } catch {}
      reloadOnce();
    };
  }

  const CAIRN_UPDATE_GATE: UpdateGateApi = {
    isSafe,
    snapshot,
    onControllerChange,
    reloadIfPending,
    hasPending,
    whenLoadedAndIdle,
    controllerChangeListener,
    LINE_TEXT,
    DRAFT_KEYS,
  };
  Object.assign(globalThis, { CairnUpdateGate: CAIRN_UPDATE_GATE });
}
