// @ts-check
// Shared transient UI actions: toast, two-tap destructive confirmation, and the
// component mount contract (`delegate` + `mount`, docs/DESIGN.md "Component
// architecture", rule 4).
{
type UiActionHandler = (el: HTMLElement, event: Event) => unknown;
type UiActionMap = Record<string, UiActionHandler>;
type UiMountContext = {
  host: Element;
  signal: AbortSignal;
  delegate(type: string, actions: UiActionMap): void;
};
// `wire` may return a cleanup function; anything else it returns is ignored.
type UiMountWire = (ctx: UiMountContext) => unknown;

let toastTimer: ReturnType<typeof setTimeout> | null = null;

function showToast(msg: unknown, opts: ToastOptions = {}): void {
  let toastEl = document.querySelector(".toast");
  if (!toastEl) {
    toastEl = document.createElement("div");
    toastEl.className = "toast";
    // Announced to assistive tech: a transient, non-interrupting status line.
    toastEl.setAttribute("role", "status");
    toastEl.setAttribute("aria-live", "polite");
    toastEl.setAttribute("aria-atomic", "true");
    document.body.appendChild(toastEl);
  }
  if (toastTimer) clearTimeout(toastTimer);
  if (opts.action) {
    toastEl.textContent = "";
    const span = document.createElement("span");
    span.textContent = String(msg);
    const btn = document.createElement("button");
    btn.className = "toast-act";
    btn.textContent = opts.action;
    btn.addEventListener("click", () => {
      if (toastTimer) clearTimeout(toastTimer);
      toastEl.classList.remove("show", "toast-actionable");
      opts.onAction && opts.onAction();
    });
    toastEl.append(span, btn);
    toastEl.classList.add("toast-actionable");
  } else {
    toastEl.textContent = String(msg);
    toastEl.classList.remove("toast-actionable");
  }
  toastEl.classList.add("show");
  toastTimer = setTimeout(() => toastEl.classList.remove("show", "toast-actionable"), opts.action ? 5000 : 1400);
}

function armDestructiveAction(btn: Element | null | undefined, onConfirm: () => unknown, { label = "remove?" }: { label?: string } = {}): void {
  if (!btn) return;
  const target = btn as HTMLElement;
  if (target.dataset.armed) {
    onConfirm();
    return;
  }
  if (!target.dataset.restGlyph) target.dataset.restGlyph = target.textContent || "×";
  target.dataset.armed = "1";
  target.classList.add("armed");
  target.textContent = label;
  const reset = () => {
    delete target.dataset.armed;
    target.classList.remove("armed");
    target.textContent = target.dataset.restGlyph || "×";
    clearTimeout(timer);
  };
  const timer = setTimeout(reset, 3000);
  target.addEventListener("blur", reset, { once: true });
}

const ACTION_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// The innermost element, from the event target up to and including `host`, that
// carries one of the action attributes. Keys are checked in the order given, so an
// element that carries two actions runs the first one listed. A tap on an action
// nested inside another action's element runs only the inner one.
function actionTarget(host: Element, target: EventTarget | null, keys: string[]): [string, HTMLElement] | null {
  const start = target as (Node & { hasAttribute?: unknown }) | null;
  let node: Element | null =
    start && typeof start.hasAttribute === "function" ? (start as Element) : (start?.parentElement ?? null);
  while (node) {
    for (const key of keys) {
      if (node.hasAttribute(`data-${key}`)) return [key, node as HTMLElement];
    }
    if (node === host) return null;
    node = node.parentElement;
  }
  return null;
}

/**
 * One delegated listener on `host` for events of `type`. Each key of `actions` names
 * a data attribute without its `data-` prefix (`"pblock-advance"` matches
 * `[data-pblock-advance]`); the handler gets the element carrying it and the event.
 * At most one handler runs per event. Pass `signal` (a mount's) to tie the listener
 * to that mount; the returned function removes it on its own. Delegation alone does
 * not make re-wiring idempotent — `mount` does.
 */
function delegate(host: Element, type: string, actions: UiActionMap, options: { signal?: AbortSignal } = {}): () => void {
  const keys = Object.keys(actions);
  for (const key of keys) {
    if (!ACTION_KEY.test(key)) throw new Error(`delegate: bad action key "${key}"`);
  }
  const own = new AbortController();
  const signal = options.signal;
  if (signal) {
    if (signal.aborted) return () => {};
    signal.addEventListener("abort", () => own.abort(), { once: true });
  }
  host.addEventListener(
    type,
    (event: Event) => {
      const hit = actionTarget(host, event.target, keys);
      if (hit) actions[hit[0]](hit[1], event);
    },
    { signal: own.signal },
  );
  return () => own.abort();
}

// host -> (mount name -> that mount's teardown). Keyed by name as well as host so two
// components that share a legacy host (a whole view) never tear each other down.
const MOUNTS = new WeakMap<Element, Map<string, () => void>>();

/**
 * Mount `name` on `host`: run the previous teardown for the same (host, name) first,
 * then call `wire` with a fresh AbortController's `signal` and a `delegate` bound to
 * it. Mounting twice therefore leaves exactly one set of listeners. The returned
 * teardown aborts every listener registered with that signal, runs the cleanup
 * `wire` returned (if any), and forgets the mount; calling it again is a no-op.
 */
function mount(host: Element, name: string, wire: UiMountWire): () => void {
  let byName = MOUNTS.get(host);
  if (!byName) {
    byName = new Map();
    MOUNTS.set(host, byName);
  }
  byName.get(name)?.();
  const controller = new AbortController();
  let cleanup: unknown;
  let done = false;
  const teardown = () => {
    if (done) return;
    done = true;
    controller.abort();
    if (byName.get(name) === teardown) byName.delete(name);
    if (typeof cleanup === "function") cleanup();
  };
  byName.set(name, teardown);
  try {
    cleanup = wire({
      host,
      signal: controller.signal,
      delegate: (type, actions) => {
        delegate(host, type, actions, { signal: controller.signal });
      },
    });
  } catch (error) {
    teardown();
    throw error;
  }
  return teardown;
}

const CAIRN_UI_ACTIONS = {
  armDelete: armDestructiveAction,
  delegate,
  mount,
  toast: showToast,
};

Object.assign(globalThis, { CairnUiActions: CAIRN_UI_ACTIONS });

if (typeof window !== "undefined") {
  Object.assign(window, { CairnUiActions: CAIRN_UI_ACTIONS });
}
}
