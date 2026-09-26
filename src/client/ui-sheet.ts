// @ts-check
// The one overlay primitive (docs/DESIGN.md "Accessibility minimums": overlays
// share one primitive). `CairnUiSheet.open` mounts a caller-rendered sheet as a
// modal dialog and owns the whole overlay contract: role="dialog" +
// aria-modal="true" + a label, focus moved in and returned to the opener on
// close, Escape and a backdrop tap both close (unless the sheet is not
// dismissible), Tab stays inside, and everything behind it is inert.
//
// A new surface takes the default `.ui-sheet-ov` / `.ui-sheet` classes (a bottom
// sheet on phones, a centred dialog on wider screens, styles.css). An existing
// overlay passes its own classes so its markup and CSS stay exactly as they were.
{
  type UiSheetCloseReason = "escape" | "backdrop" | "button" | "api";
  type UiSheetOptions = {
    /** The sheet's inner markup; every caller string already escaped. */
    html: string;
    /** Accessible name when no visible title is referenced by `labelledBy`. */
    label?: unknown;
    labelledBy?: string;
    describedBy?: string;
    /** Overlay (backdrop) classes; default `ui-sheet-ov`. */
    overlayClass?: string;
    /** Dialog classes; default `ui-sheet`. */
    sheetClass?: string;
    sheetTag?: "div" | "section";
    /** Overlay element id, for callers that look the open sheet up by id. */
    id?: string;
    /** Extra overlay attributes (`data-*`), escaped as attribute values. */
    attrs?: Record<string, unknown>;
    /** Escape and a backdrop tap close the sheet. Default true. */
    dismissible?: boolean;
    /** Clicking an element matching this closes the sheet. Default `[data-ui-sheet-close]`. */
    closeSelector?: string;
    /** Selector (inside the sheet) that takes focus on open; default the first control. */
    initialFocus?: string;
    /** Delay before moving focus in (ms); default 0. */
    focusDelayMs?: number;
    /** Class added to the overlay on the next frame (an entrance transition). */
    openClass?: string;
    /** With `openClass`: on close, drop the class and remove the node after this many ms. */
    exitMs?: number;
    /** Class held on <body> while the sheet is open (scroll lock). */
    bodyClass?: string;
    /** Runs once, after the sheet is closed. */
    onClose?(reason: UiSheetCloseReason): void;
  };
  type UiSheetHandle = {
    overlay: HTMLElement;
    sheet: HTMLElement;
    close(options?: { instant?: boolean; reason?: UiSheetCloseReason }): void;
    isOpen(): boolean;
  };
  type UiSheetEntry = { overlay: HTMLElement; handle: UiSheetHandle; bodyClass: string };

  const FOCUSABLE = "a[href],button,input,select,textarea,[tabindex]";
  const INERT_MARK = "data-ui-sheet-inert";
  // Open sheets, oldest first; the last one is the top.
  const STACK: UiSheetEntry[] = [];
  const HANDLES = new WeakMap<Element, UiSheetHandle>();

  function sheetReducedMotion(): boolean {
    return typeof reducedMotion === "function" ? reducedMotion() : false;
  }

  function focusableIn(sheet: Element): HTMLElement[] {
    return [...sheet.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => {
      if (el.hasAttribute("disabled") || el.getAttribute("tabindex") === "-1") return false;
      if (el.localName === "input" && el.getAttribute("type") === "hidden") return false;
      if (el.localName === "a" && !el.getAttribute("href")) return false;
      return !el.closest("[hidden]");
    });
  }

  // Background inertness is recomputed from the stack on every open and close, so
  // closing a lower sheet first never frees the page under a sheet still open.
  function syncInert(doc: Document): void {
    doc.querySelectorAll(`[${INERT_MARK}]`).forEach((el) => {
      el.removeAttribute("inert");
      el.removeAttribute(INERT_MARK);
    });
    const top = STACK[STACK.length - 1];
    if (!top || !doc.body) return;
    for (const child of [...doc.body.children]) {
      if (child === top.overlay || child.hasAttribute("inert")) continue;
      const tag = child.localName;
      if (tag === "script" || tag === "style" || tag === "link" || tag === "template") continue;
      // Toasts and live regions keep speaking while a sheet is open.
      if (child.classList.contains("toast") || child.hasAttribute("aria-live")) continue;
      child.setAttribute("inert", "");
      child.setAttribute(INERT_MARK, "");
    }
  }

  function isTop(overlay: HTMLElement): boolean {
    return STACK[STACK.length - 1]?.overlay === overlay;
  }

  function openSheet(options: UiSheetOptions): UiSheetHandle {
    const doc = document;
    const dismissible = options.dismissible !== false;
    const closeSelector = options.closeSelector || "[data-ui-sheet-close]";
    const tag = options.sheetTag === "section" ? "section" : "div";
    const labelAttr = options.labelledBy
      ? ` aria-labelledby="${escAttr(options.labelledBy)}"`
      : ` aria-label="${escAttr(options.label ?? "Dialog")}"`;
    const describedAttr = options.describedBy ? ` aria-describedby="${escAttr(options.describedBy)}"` : "";

    const overlay = doc.createElement("div");
    overlay.className = options.overlayClass || "ui-sheet-ov";
    if (options.id) overlay.id = options.id;
    overlay.setAttribute("data-ui-sheet", "");
    overlay.innerHTML = `<${tag} class="${escAttr(options.sheetClass || "ui-sheet")}" role="dialog" aria-modal="true" tabindex="-1"${labelAttr}${describedAttr}>${options.html}</${tag}>`;
    for (const [key, value] of Object.entries(options.attrs || {})) {
      if (value == null || value === false || !/^[a-zA-Z][a-zA-Z0-9_:.-]*$/.test(key)) continue;
      overlay.setAttribute(key, value === true ? "" : String(value));
    }
    const sheet = overlay.firstElementChild as HTMLElement;
    const opener =
      doc.activeElement instanceof HTMLElement && doc.activeElement !== doc.body ? doc.activeElement : null;

    let open = true;
    let focusTimer: ReturnType<typeof setTimeout> | null = null;
    const listeners = new AbortController();

    function close(closeOptions: { instant?: boolean; reason?: UiSheetCloseReason } = {}): void {
      if (!open) return;
      open = false;
      if (focusTimer != null) clearTimeout(focusTimer);
      listeners.abort();
      const at = STACK.findIndex((entry) => entry.overlay === overlay);
      if (at >= 0) STACK.splice(at, 1);
      // A body class is released only when no other open sheet still holds it.
      if (options.bodyClass && !STACK.some((entry) => entry.bodyClass === options.bodyClass))
        doc.body?.classList.remove(options.bodyClass);
      const animated =
        !closeOptions.instant &&
        !!options.openClass &&
        Number(options.exitMs) > 0 &&
        !sheetReducedMotion() &&
        typeof setTimeout === "function";
      if (animated) {
        overlay.classList.remove(options.openClass as string);
        overlay.setAttribute("aria-hidden", "true");
        setTimeout(() => overlay.remove(), Number(options.exitMs));
      } else {
        overlay.remove();
      }
      syncInert(doc);
      // Hand focus back to whatever opened the sheet, if it is still on the page.
      const next = STACK[STACK.length - 1];
      try {
        if (opener && opener.isConnected) opener.focus();
        else if (next) next.handle.sheet.focus();
      } catch {}
      options.onClose?.(closeOptions.reason || "api");
    }

    const handle: UiSheetHandle = { overlay, sheet, close, isOpen: () => open };
    HANDLES.set(overlay, handle);

    overlay.addEventListener(
      "click",
      (event: Event) => {
        const target = event.target as Element | null;
        if (target === overlay) {
          if (dismissible) close({ reason: "backdrop" });
          return;
        }
        if (target && typeof target.closest === "function" && target.closest(closeSelector))
          close({ reason: "button" });
      },
      { signal: listeners.signal }
    );
    doc.addEventListener(
      "keydown",
      (event: Event) => {
        const key = event as KeyboardEvent;
        if (!isTop(overlay)) return;
        if (key.key === "Escape") {
          if (!dismissible) return;
          key.preventDefault();
          close({ reason: "escape" });
          return;
        }
        if (key.key !== "Tab") return;
        const focusable = focusableIn(sheet);
        const active = doc.activeElement;
        if (!focusable.length) {
          key.preventDefault();
          sheet.focus();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const inside = !!active && sheet.contains(active);
        if (key.shiftKey && (active === first || !inside)) {
          key.preventDefault();
          last.focus();
        } else if (!key.shiftKey && (active === last || !inside)) {
          key.preventDefault();
          first.focus();
        }
      },
      { signal: listeners.signal }
    );

    doc.body.appendChild(overlay);
    STACK.push({ overlay, handle, bodyClass: options.bodyClass || "" });
    if (options.bodyClass) doc.body.classList.add(options.bodyClass);
    syncInert(doc);
    if (options.openClass) {
      const cls = options.openClass;
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => open && overlay.classList.add(cls));
      else overlay.classList.add(cls);
    }

    const focusIn = (): void => {
      focusTimer = null;
      if (!open) return;
      const wanted = options.initialFocus ? sheet.querySelector<HTMLElement>(options.initialFocus) : null;
      try {
        (wanted || focusableIn(sheet)[0] || sheet).focus();
      } catch {}
    };
    const delay = Math.max(0, Number(options.focusDelayMs) || 0);
    if (typeof setTimeout === "function") focusTimer = setTimeout(focusIn, delay);
    else focusIn();
    return handle;
  }

  /** The handle of the open sheet whose overlay is (or contains) `el`, if any. */
  function sheetFor(el: Element | null | undefined): UiSheetHandle | null {
    const overlay = el?.closest?.("[data-ui-sheet]");
    return (overlay && HANDLES.get(overlay)) || null;
  }

  /** The topmost open sheet's handle, if any. */
  function topSheet(): UiSheetHandle | null {
    return STACK[STACK.length - 1]?.handle || null;
  }

  const CAIRN_UI_SHEET = {
    open: openSheet,
    sheetFor,
    top: topSheet,
  };

  Object.assign(globalThis, { CairnUiSheet: CAIRN_UI_SHEET });
}
