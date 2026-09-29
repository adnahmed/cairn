// @ts-check
// Shared view-transition helpers. Keeps transition-abort handling out of screen shells.

type UiViewTransitionDeps = {
  view: HTMLElement;
  reducedMotion(): boolean;
};

type UiViewTransitionOptions = {
  // Names the transition on <html data-vt="…"> for its lifetime, so CSS can tune
  // one family (the tab switch's shorter root crossfade) without touching the rest.
  kind?: string;
};

type UiViewTransitionApi = {
  viewEnter(): void;
  withViewTransition(fn: () => unknown, options?: UiViewTransitionOptions): Promise<unknown>;
  skelSwap(fn: () => unknown): Promise<unknown>;
  tabSwap(fn: () => unknown): Promise<unknown>;
  viewHydrate(): void;
};

type UiViewTransitionsClientApi = {
  create(deps: UiViewTransitionDeps): UiViewTransitionApi;
  isViewTransitionAbort(error: unknown): boolean;
};

(() => {
  function errorRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  }

  function isViewTransitionAbort(error: unknown): boolean {
    const row = error instanceof Error ? { name: error.name, message: error.message } : errorRecord(error);
    const name = String(row.name || "");
    const message = String(row.message || error || "");
    return name === "AbortError" || (name === "InvalidStateError" && /transition/i.test(message));
  }

  function create(deps: UiViewTransitionDeps): UiViewTransitionApi {
    let active = false;

    function viewEnter(): void {
      if (deps.reducedMotion()) return;
      deps.view.classList.remove("view-in", "view-hydrate");
      void deps.view.offsetWidth;
      deps.view.classList.add("view-in");
    }

    // Skeleton → content: the real content arrives at partial opacity and settles
    // in one short fade (--dur-1), reading as a crossfade out of the skeleton rather
    // than a blank-then-rise. ONE entrance only: the `.reveal` stagger (and any
    // `.settle-in`) on the cards painted in this swap is switched off inline, so a
    // hydrated view never fades AND rises. Cards that arrive later into async slots
    // keep their own entrance. No-op under reduced motion.
    function viewHydrate(): void {
      if (deps.reducedMotion()) return;
      const el = deps.view;
      el.querySelectorAll<HTMLElement>(".reveal, .settle-in").forEach((card) => {
        card.style.animation = "none";
      });
      el.classList.remove("view-in", "view-hydrate");
      void el.offsetWidth;
      el.classList.add("view-hydrate");
      const done = (event: AnimationEvent): void => {
        if (event.target !== el) return;
        el.classList.remove("view-hydrate");
        el.removeEventListener("animationend", done);
      };
      el.addEventListener("animationend", done);
    }

    // How long a transition may hold the screen still while its swap runs. One
    // short frame budget: long enough for a synchronous or cache-warm paint to ride
    // the crossfade, never long enough to read as a frozen tap.
    const SWAP_BUDGET_MS = 160;

    function boundedSwap(swap: Promise<unknown>): Promise<unknown> {
      if (typeof setTimeout !== "function") return swap;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const budget = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, SWAP_BUDGET_MS);
      });
      return Promise.race([swap.then(() => undefined), budget]).finally(() => {
        if (timer !== undefined && typeof clearTimeout === "function") clearTimeout(timer);
      });
    }

    function runViewSwap(fn: () => unknown): Promise<unknown> {
      try {
        return Promise.resolve(fn());
      } catch (error) {
        return Promise.reject(error);
      }
    }

    function quietTransitionPromise(promise: Promise<unknown>): Promise<unknown> {
      return Promise.resolve(promise).catch((error) => {
        if (!isViewTransitionAbort(error)) throw error;
      });
    }

    function quietSecondaryTransitionPromise(promise: Promise<unknown>): void {
      Promise.resolve(promise).catch((error) => {
        if (!isViewTransitionAbort(error))
          setTimeout(() => {
            throw error;
          }, 0);
      });
    }

    function setKind(kind: string | undefined): void {
      if (!kind) return;
      try {
        document.documentElement.dataset.vt = kind;
      } catch {}
    }

    function clearKind(kind: string | undefined): void {
      if (!kind) return;
      try {
        if (document.documentElement.dataset.vt === kind) delete document.documentElement.dataset.vt;
      } catch {}
    }

    // True when a real View Transition will carry the swap: the API exists, motion
    // is allowed, and no other transition owns the document right now.
    function canTransition(): boolean {
      return !!document.startViewTransition && !deps.reducedMotion() && !active;
    }

    function withViewTransition(fn: () => unknown, options: UiViewTransitionOptions = {}): Promise<unknown> {
      if (canTransition()) {
        try {
          active = true;
          setKind(options.kind);
          // The browser SUSPENDS RENDERING until the update callback settles. A swap
          // that awaits the network (renderToday's data load, a Brief read) used to
          // freeze the whole screen for that round trip — a tapped chip painted
          // nothing for seconds, then everything jumped at once, and Chrome aborts a
          // callback after 4 s. The freeze is bounded to one short frame budget: a
          // swap that settles inside it is carried by the transition, a slower one
          // keeps rendering and lands on its own when its data does.
          let swap: Promise<unknown> | null = null;
          const transition = document.startViewTransition(() => {
            swap = runViewSwap(fn);
            return boundedSwap(swap);
          });
          const done = transition.updateCallbackDone || transition.finished || Promise.resolve();
          if (transition.ready) quietSecondaryTransitionPromise(transition.ready);
          if (transition.finished) {
            Promise.resolve(transition.finished).then(
              () => clearKind(options.kind),
              () => clearKind(options.kind)
            );
            if (transition.finished !== done) quietSecondaryTransitionPromise(transition.finished);
          } else clearKind(options.kind);
          // Callers await the WHOLE swap (a morph class comes off after it), not just
          // the bounded part the transition carried.
          return quietTransitionPromise(done)
            .finally(() => {
              active = false;
            })
            .then(() => swap);
        } catch {
          active = false;
          clearKind(options.kind);
        }
      }
      return runViewSwap(fn);
    }

    function skelSwap(fn: () => unknown): Promise<unknown> {
      if (active) return runViewSwap(fn);
      return withViewTransition(fn);
    }

    // A tab switch: ONE fade, whichever mechanism carries it. With View Transitions
    // the root crossfade (shortened under `html[data-vt="tab"]` in CSS) IS the fade,
    // so the view-enter keyframe is not also played on top of it; without them (or
    // while another transition is mid-flight) the view-enter keyframe is the fade.
    function tabSwap(fn: () => unknown): Promise<unknown> {
      if (canTransition()) return withViewTransition(fn, { kind: "tab" });
      return runViewSwap(fn).then((value) => {
        viewEnter();
        return value;
      });
    }

    return { viewEnter, withViewTransition, skelSwap, tabSwap, viewHydrate };
  }

  const CAIRN_UI_VIEW_TRANSITIONS: UiViewTransitionsClientApi = {
    create,
    isViewTransitionAbort,
  };

  Object.assign(globalThis, { CairnUiViewTransitions: CAIRN_UI_VIEW_TRANSITIONS });

  if (typeof window !== "undefined") {
    Object.assign(window, { CairnUiViewTransitions: CAIRN_UI_VIEW_TRANSITIONS });
  }
})();
