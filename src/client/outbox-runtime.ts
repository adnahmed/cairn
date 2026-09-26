// @ts-check
// Offline outbox, part 2 of 5: the page's one live queue (localStorage, or an
// in-memory stand-in when storage is disabled), the cross-tab runtime lease
// every queue mutation runs under, and the enqueue that maps runtime options
// onto a queue entry. The queue core is outbox-queue.ts; the drain is outbox.ts.
type OutboxEnqueueRuntimeOptions = {
  dependsOn?: string | null;
  groupId?: string | null;
  sessionDate?: string | null;
  method?: "POST" | "DELETE";
  prepareIntent?: Record<string, unknown> | null;
  retryBody?: Record<string, unknown> | null;
  retryIntent?: Record<string, unknown> | null;
  itemId?: string | null;
  state?: "pending" | "sending";
  inFlightUntil?: number | null;
  claimToken?: string | null;
};
type OutboxRuntimeApi = {
  queue(): OutboxController;
  withLock<T>(work: () => Promise<T> | T): Promise<T>;
  enqueueUnlocked(kind: string, path: string, body: unknown, options?: OutboxEnqueueRuntimeOptions): OutboxItem | null;
};
declare const CairnOutboxRuntime: OutboxRuntimeApi;

{
  const { createOutbox, KEY: OUTBOX_KEY } = CairnOutboxQueue;

  // ---------- the page's one live queue ----------
  function storageForOutbox(): OutboxStore {
    try {
      if (typeof localStorage !== "undefined" && localStorage) return localStorage;
    } catch {}
    // Private-mode / disabled storage → an in-memory queue for this session, so a
    // log is at least held until the tab closes rather than dropped outright.
    const mem = new Map<string, string>();
    return {
      getItem: (k) => (mem.has(k) ? (mem.get(k) as string) : null),
      setItem: (k, v) => {
        mem.set(k, String(v));
      },
    };
  }

  let outboxController: OutboxController | null = null;
  function outbox(): OutboxController {
    if (!outboxController) outboxController = createOutbox({ storage: storageForOutbox() });
    return outboxController;
  }

  // Runtime mutations are serialized across tabs with Web Locks. Older browsers
  // use a short renewable localStorage lease plus an in-tab promise tail. The
  // lease is advisory (localStorage has no compare-and-swap), but the yield-then-
  // verify acquisition prevents the classic simultaneous read/write winner loss.
  // Every session mutation now owns its server idempotency key before the direct
  // request, so even a suspended tab that outlives the lease cannot double-apply
  // that same mutation when its lost response falls back to replay. The advisory
  // path can still lose strict ordering between two genuinely distinct mutations.
  const OUTBOX_RUNTIME_LOCK = "cairn-outbox-v1";
  const OUTBOX_RUNTIME_LEASE_KEY = `${OUTBOX_KEY}.lock`;
  const OUTBOX_RUNTIME_LEASE_MS = 30_000;
  const outboxRuntimeOwner = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  let outboxRuntimeLockSeq = 0;
  let outboxRuntimeTail: Promise<unknown> = Promise.resolve();

  function outboxLockStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> | null {
    try {
      return typeof localStorage !== "undefined" && localStorage ? localStorage : null;
    } catch {
      return null;
    }
  }

  function outboxLeaseOwner(storage: Pick<Storage, "getItem">): { owner: string; expires: number } | null {
    try {
      const parsed = JSON.parse(storage.getItem(OUTBOX_RUNTIME_LEASE_KEY) || "null") as unknown;
      if (!parsed || typeof parsed !== "object") return null;
      const row = parsed as { owner?: unknown; expires?: unknown };
      return typeof row.owner === "string" && Number.isFinite(Number(row.expires))
        ? { owner: row.owner, expires: Number(row.expires) }
        : null;
    } catch {
      return null;
    }
  }

  function outboxLockPause(delay = 0): Promise<void> {
    if (typeof setTimeout !== "function") return Promise.resolve();
    return new Promise((resolve) => setTimeout(resolve, delay));
  }

  async function withOutboxStorageLease<T>(work: () => Promise<T> | T): Promise<T> {
    const storage = outboxLockStorage();
    if (!storage) return work();
    const owner = `${outboxRuntimeOwner}:${++outboxRuntimeLockSeq}`;
    for (;;) {
      const current = outboxLeaseOwner(storage);
      const now = Date.now();
      if (!current || current.expires <= now) {
        try {
          storage.setItem(OUTBOX_RUNTIME_LEASE_KEY, JSON.stringify({ owner, expires: now + OUTBOX_RUNTIME_LEASE_MS }));
          await outboxLockPause(0);
          if (outboxLeaseOwner(storage)?.owner === owner) break;
        } catch {
          // Storage-disabled contexts have no cross-tab durable queue to protect;
          // the in-tab promise tail below remains the relevant fallback.
          return work();
        }
      }
      await outboxLockPause(18 + Math.floor(Math.random() * 17));
    }

    let renewTimer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const renew = (): void => {
      if (stopped || outboxLeaseOwner(storage)?.owner !== owner) return;
      try {
        storage.setItem(
          OUTBOX_RUNTIME_LEASE_KEY,
          JSON.stringify({ owner, expires: Date.now() + OUTBOX_RUNTIME_LEASE_MS })
        );
      } catch {}
      if (typeof setTimeout === "function") renewTimer = setTimeout(renew, OUTBOX_RUNTIME_LEASE_MS / 3);
    };
    renew();
    try {
      return await work();
    } finally {
      stopped = true;
      if (renewTimer != null && typeof clearTimeout === "function") clearTimeout(renewTimer);
      try {
        if (outboxLeaseOwner(storage)?.owner === owner) storage.removeItem(OUTBOX_RUNTIME_LEASE_KEY);
      } catch {}
    }
  }

  function withOutboxRuntimeLock<T>(work: () => Promise<T> | T): Promise<T> {
    const locks =
      typeof navigator !== "undefined"
        ? (
            navigator as Navigator & {
              locks?: { request?<R>(name: string, callback: () => Promise<R> | R): Promise<R> };
            }
          ).locks
        : undefined;
    if (typeof locks?.request === "function") return locks.request(OUTBOX_RUNTIME_LOCK, work);
    const run = outboxRuntimeTail.then(
      () => withOutboxStorageLease(work),
      () => withOutboxStorageLease(work)
    );
    outboxRuntimeTail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  function enqueueOutboxUnlocked(
    kind: string,
    path: string,
    body: unknown,
    options: OutboxEnqueueRuntimeOptions = {}
  ): OutboxItem | null {
    return outbox().enqueue({
      ...(options.itemId ? { id: options.itemId } : {}),
      kind,
      path,
      ...(options.method === "DELETE" ? { method: "DELETE" as const } : {}),
      body,
      ...(options.sessionDate ? { session_date: options.sessionDate } : {}),
      ...(options.state ? { state: options.state } : {}),
      ...(options.inFlightUntil != null ? { in_flight_until: options.inFlightUntil } : {}),
      ...(options.claimToken ? { claim_token: options.claimToken } : {}),
      ...(options.dependsOn ? { depends_on: options.dependsOn } : {}),
      ...(options.groupId ? { group_id: options.groupId } : {}),
      ...(options.prepareIntent ? { prepare_intent: options.prepareIntent } : {}),
      ...(options.retryBody ? { retry_body: options.retryBody } : {}),
      ...(options.retryIntent ? { retry_intent: options.retryIntent } : {}),
    });
  }

  const CAIRN_OUTBOX_RUNTIME: OutboxRuntimeApi = {
    queue: outbox,
    withLock: withOutboxRuntimeLock,
    enqueueUnlocked: enqueueOutboxUnlocked,
  };

  Object.assign(globalThis, { CairnOutboxRuntime: CAIRN_OUTBOX_RUNTIME });
}
