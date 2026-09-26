// @ts-check
// Offline outbox, part 1 of 5: the queue core. The outbox never loses a
// gym-floor log: a durable localStorage queue holds a failed capture / set-log
// write and replays it, in order, the moment Cairn is reachable again.
// createOutbox is a pure, storage-injected unit — no DOM, no network — so its
// replay/ordering logic is fully testable. The rest of the outbox builds on it:
// outbox-runtime.ts (the page's one live queue + the cross-tab lease),
// outbox-replay.ts (reading a replayed response), outbox-session.ts (workout
// mutations and their staged session), outbox.ts (the drain and the public
// CairnOutbox API) and outbox-ui.ts (the "N to sync" bar and the review sheet).
type OutboxItem = {
  id: string;
  ts: number;
  kind: string;
  path: string;
  method?: "POST" | "DELETE";
  body: unknown;
  session_date?: string;
  state?: "pending" | "sending" | "prepared" | "needs_attention";
  in_flight_until?: number;
  claim_token?: string;
  failure_status?: number;
  depends_on?: string;
  group_id?: string;
  prepare_intent?: Record<string, unknown>;
  retry_body?: Record<string, unknown>;
  retry_intent?: Record<string, unknown>;
};
type OutboxStore = Pick<Storage, "getItem" | "setItem">;
type OutboxDrainResult = { sent: number; remaining: number; needsAttention: number };
type OutboxSendResult = undefined | "needs_attention";
type OutboxReviewEntry = { item: OutboxItem; role: "attention" | "blocked_dependent" };
type ClaimedOutboxItem = OutboxItem & {
  state: "sending";
  in_flight_until: number;
  claim_token: string;
};
type OutboxClaimResult = { item: ClaimedOutboxItem | null; blockedUntil?: number; storageError?: boolean };
type OutboxController = {
  enqueue(entry: {
    id?: string;
    kind: string;
    path: string;
    method?: "POST" | "DELETE";
    body: unknown;
    session_date?: string;
    state?: "pending" | "sending";
    in_flight_until?: number;
    claim_token?: string;
    depends_on?: string;
    group_id?: string;
    prepare_intent?: Record<string, unknown>;
    retry_body?: Record<string, unknown>;
    retry_intent?: Record<string, unknown>;
  }): OutboxItem | null;
  allocateId(): string;
  allocateClaimToken(): string;
  list(): OutboxItem[];
  review(): OutboxReviewEntry[];
  count(): number;
  retry(id: string): boolean;
  claimNext(): OutboxClaimResult;
  settle(
    id: string,
    claimToken: string,
    outcome: "delivered" | "attention" | "pending",
    failureStatus?: number
  ): boolean;
  remove(id: string): boolean;
  hasDependents(id: string): boolean;
  clear(): void;
  drain(send: (item: OutboxItem) => Promise<OutboxSendResult>): Promise<OutboxDrainResult>;
};
type OutboxQueueApi = {
  createOutbox(opts: { storage: OutboxStore; now?: () => number; key?: string; max?: number }): OutboxController;
  KEY: string;
  SEND_CLAIM_MS: number;
};
declare const CairnOutboxQueue: OutboxQueueApi;

{
  const OUTBOX_KEY = "cairn.outbox.v1";
  const OUTBOX_MAX = 250;
  const OUTBOX_SEND_CLAIM_MS = 30_000;
  const OUTBOX_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
  // `symptom_observation` has no PRODUCER any more — the per-card movement check that
  // queued it is gone, and pain is reported in words now. It stays recognized here on
  // purpose: an installed PWA can be carrying one in localStorage across this upgrade,
  // and an athlete's saved-offline answer must still drain and be labelled correctly
  // rather than degrade to a nameless "Saved log".
  const OUTBOX_WORKOUT_KINDS = new Set([
    "daily_session_prepare",
    "set",
    "finish",
    "skip",
    "restore",
    "symptom_observation",
  ]);

  function validOutboxId(value: unknown): value is string {
    return typeof value === "string" && OUTBOX_ID_RE.test(value);
  }

  function normalizedOutboxSessionDate(value: unknown): string | null {
    const text = String(value ?? "").trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
  }

  function inferredOutboxSessionDate(kind: unknown, explicit: unknown, body: unknown): string | null {
    if (!OUTBOX_WORKOUT_KINDS.has(String(kind || ""))) return null;
    const direct = normalizedOutboxSessionDate(explicit);
    if (direct) return direct;
    const record = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
    return normalizedOutboxSessionDate(record?.date);
  }

  // ---------- pure core: a durable FIFO queue over injected storage ----------
  function createOutbox(opts: {
    storage: OutboxStore;
    now?: () => number;
    key?: string;
    max?: number;
  }): OutboxController {
    const storage = opts.storage;
    const now = opts.now || (() => Date.now());
    const key = opts.key || OUTBOX_KEY;
    const max = opts.max && opts.max > 0 ? opts.max : OUTBOX_MAX;
    let seq = 0;
    let claimSeq = 0;

    function isItem(value: unknown): value is OutboxItem {
      return (
        !!value &&
        typeof value === "object" &&
        typeof (value as OutboxItem).id === "string" &&
        typeof (value as OutboxItem).path === "string" &&
        typeof (value as OutboxItem).kind === "string"
      );
    }
    function read(): OutboxItem[] {
      try {
        const raw = storage.getItem(key);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(isItem).map((item) => {
          if (item.session_date) return item;
          const sessionDate = inferredOutboxSessionDate(item.kind, null, item.body);
          return sessionDate ? { ...item, session_date: sessionDate } : item;
        });
      } catch {
        return [];
      }
    }
    function write(items: OutboxItem[]): { items: OutboxItem[]; persisted: boolean } {
      const serialized = JSON.stringify(items);
      try {
        storage.setItem(key, serialized);
        return { items, persisted: storage.getItem(key) === serialized };
      } catch {
        return { items: read(), persisted: false };
      }
    }
    function allocateId(): string {
      const existing = new Set(read().map((item) => item.id));
      let candidate = "";
      do {
        seq = (seq + 1) % 1_000_000;
        candidate = `${now().toString(36)}-${seq.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      } while (existing.has(candidate));
      return candidate;
    }
    function allocateClaimToken(): string {
      const existing = new Set(
        read()
          .map((item) => item.claim_token)
          .filter(Boolean)
      );
      let candidate = "";
      do {
        claimSeq = (claimSeq + 1) % 1_000_000;
        candidate = `claim:${now().toString(36)}:${claimSeq.toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
      } while (existing.has(candidate));
      return candidate;
    }
    function enqueue(entry: {
      id?: string;
      kind: string;
      path: string;
      method?: "POST" | "DELETE";
      body: unknown;
      session_date?: string;
      state?: "pending" | "sending";
      in_flight_until?: number;
      claim_token?: string;
      depends_on?: string;
      group_id?: string;
      prepare_intent?: Record<string, unknown>;
      retry_body?: Record<string, unknown>;
      retry_intent?: Record<string, unknown>;
    }): OutboxItem | null {
      if (entry.id != null && !validOutboxId(entry.id)) return null;
      if (entry.claim_token != null && !validOutboxId(entry.claim_token)) return null;
      if (entry.state === "sending" && !entry.claim_token) return null;
      const sessionDate = inferredOutboxSessionDate(entry.kind, entry.session_date, entry.body);
      const item: OutboxItem = {
        id: entry.id || allocateId(),
        ts: now(),
        kind: String(entry.kind || "log"),
        path: String(entry.path || ""),
        ...(entry.method === "DELETE" ? { method: "DELETE" as const } : {}),
        body: entry.body,
        ...(sessionDate ? { session_date: sessionDate } : {}),
        ...(entry.state ? { state: entry.state } : {}),
        ...(entry.in_flight_until != null && Number.isFinite(entry.in_flight_until)
          ? { in_flight_until: Number(entry.in_flight_until) }
          : {}),
        ...(entry.state === "sending" && entry.claim_token ? { claim_token: entry.claim_token } : {}),
        ...(entry.depends_on ? { depends_on: String(entry.depends_on) } : {}),
        ...(entry.group_id ? { group_id: String(entry.group_id) } : {}),
        ...(entry.prepare_intent ? { prepare_intent: entry.prepare_intent } : {}),
        ...(entry.retry_body ? { retry_body: entry.retry_body } : {}),
        ...(entry.retry_intent ? { retry_intent: entry.retry_intent } : {}),
      };
      const items = read();
      if (items.some((candidate) => candidate.id === item.id)) return null;
      const prerequisite = entry.depends_on
        ? items.find((candidate) => candidate.id === entry.depends_on && candidate.kind === "daily_session_prepare")
        : null;
      const group = entry.group_id ? items.find((candidate) => candidate.group_id === entry.group_id) : null;
      if (entry.depends_on && !prerequisite) return null;
      // Never make room by deleting a previously confirmed log. A dependency
      // group that already owns its prepare barrier may continue past the nominal
      // cap so a workout transaction is never split; every new independent item
      // is rejected honestly once capacity is reached.
      if (items.length >= max && !prerequisite && !group) return null;
      items.push(item);
      const result = write(items);
      return result.persisted && result.items.some((candidate) => candidate.id === item.id) ? item : null;
    }
    function list(): OutboxItem[] {
      return read();
    }
    function count(): number {
      return read().length;
    }
    function review(): OutboxReviewEntry[] {
      const items = read();
      const attentionPrepareIds = new Set(
        items
          .filter((item) => item.kind === "daily_session_prepare" && item.state === "needs_attention")
          .map((item) => item.id)
      );
      const attentionGroupIds = new Set(
        items.filter((item) => item.state === "needs_attention" && item.group_id).map((item) => item.group_id as string)
      );
      const rows: OutboxReviewEntry[] = [];
      for (const item of items) {
        // A currently owned generation is in delivery, never a review decision.
        // In particular, do not expose discard/retry affordances for it merely
        // because another member of the workout group needs attention.
        if (item.state === "sending") continue;
        if (item.state === "needs_attention") rows.push({ item, role: "attention" });
        else if (item.depends_on && attentionPrepareIds.has(item.depends_on)) {
          rows.push({ item, role: "blocked_dependent" });
        } else if (item.group_id && attentionGroupIds.has(item.group_id)) {
          rows.push({ item, role: "blocked_dependent" });
        }
      }
      return rows;
    }
    function retry(id: string): boolean {
      const items = read();
      const index = items.findIndex((item) => item.id === id);
      if (index < 0) return false;
      const current = items[index];
      if (current.state !== "needs_attention") return false;
      const freshId = allocateId();
      if (current.kind === "daily_session_prepare") {
        const body =
          current.retry_body ||
          (current.body && typeof current.body === "object"
            ? { ...(current.body as Record<string, unknown>), replace: true }
            : current.body);
        const {
          state: _state,
          failure_status: _failureStatus,
          in_flight_until: _inFlightUntil,
          claim_token: _claimToken,
          ...pending
        } = current;
        items[index] = {
          ...pending,
          id: freshId,
          ts: now(),
          body,
          ...(current.retry_intent ? { prepare_intent: current.retry_intent } : {}),
        };
        for (let i = 0; i < items.length; i++) {
          if (items[i].depends_on === id) items[i] = { ...items[i], depends_on: freshId };
        }
        const result = write(items);
        return result.persisted && result.items.some((item) => item.id === freshId);
      }
      const {
        state: _state,
        failure_status: _failureStatus,
        in_flight_until: _inFlightUntil,
        claim_token: _claimToken,
        ...pending
      } = current;
      items[index] = { ...pending, id: freshId, ts: now() };
      for (let i = 0; i < items.length; i++) {
        if (items[i].depends_on === id) items[i] = { ...items[i], depends_on: freshId };
      }
      const result = write(items);
      return result.persisted && result.items.some((item) => item.id === freshId);
    }
    function hasDependents(id: string): boolean {
      return read().some((item) => item.depends_on === id);
    }
    function claimNext(): OutboxClaimResult {
      const items = read();
      const attentionGroupIds = new Set(
        items.filter((item) => item.state === "needs_attention" && item.group_id).map((item) => item.group_id as string)
      );
      const blockedGroupIds = new Set(attentionGroupIds);
      let blockedUntil: number | undefined;
      let dirty = false;
      for (let index = 0; index < items.length; index++) {
        const item = items[index];
        if (item.state === "prepared") {
          if (!items.some((candidate) => candidate.depends_on === item.id)) {
            items.splice(index, 1);
            index--;
            dirty = true;
          }
          continue;
        }
        if (item.state === "needs_attention") {
          if (item.group_id) blockedGroupIds.add(item.group_id);
          continue;
        }
        const liveClaim =
          item.state === "sending" && validOutboxId(item.claim_token) && Number(item.in_flight_until) > now();
        if (liveClaim) {
          const until = Number(item.in_flight_until);
          blockedUntil = blockedUntil == null ? until : Math.min(blockedUntil, until);
          if (item.group_id) blockedGroupIds.add(item.group_id);
          continue;
        }
        if (item.group_id && blockedGroupIds.has(item.group_id)) continue;
        if (item.depends_on) {
          const prerequisite = items.find((candidate) => candidate.id === item.depends_on);
          if (!prerequisite || prerequisite.kind !== "daily_session_prepare") {
            const { in_flight_until: _inFlightUntil, claim_token: _claimToken, ...pending } = item;
            items[index] = { ...pending, state: "needs_attention" };
            if (item.group_id) blockedGroupIds.add(item.group_id);
            dirty = true;
            continue;
          }
          if (prerequisite.state !== "prepared") continue;
        }
        const claimed: ClaimedOutboxItem = {
          ...item,
          state: "sending" as const,
          in_flight_until: now() + OUTBOX_SEND_CLAIM_MS,
          claim_token: allocateClaimToken(),
        };
        items[index] = claimed;
        const result = write(items);
        return result.persisted
          ? { item: claimed, ...(blockedUntil != null ? { blockedUntil } : {}) }
          : { item: null, storageError: true, ...(blockedUntil != null ? { blockedUntil } : {}) };
      }
      if (dirty && !write(items).persisted)
        return { item: null, storageError: true, ...(blockedUntil != null ? { blockedUntil } : {}) };
      return { item: null, ...(blockedUntil != null ? { blockedUntil } : {}) };
    }
    function settle(
      id: string,
      claimToken: string,
      outcome: "delivered" | "attention" | "pending",
      failureStatus?: number
    ): boolean {
      const items = read();
      const index = items.findIndex((item) => item.id === id);
      if (index < 0) return false;
      const item = items[index];
      if (item.state !== "sending" || !validOutboxId(claimToken) || item.claim_token !== claimToken) return false;
      if (outcome === "attention") {
        const { in_flight_until: _inFlightUntil, claim_token: _claimToken, ...pending } = item;
        items[index] = {
          ...pending,
          state: "needs_attention",
          ...(failureStatus != null ? { failure_status: failureStatus } : {}),
        };
        return write(items).persisted;
      }
      if (outcome === "pending") {
        const {
          state: _state,
          in_flight_until: _InFlightUntil,
          failure_status: _failureStatus,
          claim_token: _claimToken,
          ...pending
        } = item;
        items[index] = pending;
        return write(items).persisted;
      }
      if (item.kind === "daily_session_prepare" && items.some((candidate) => candidate.depends_on === item.id)) {
        const { in_flight_until: _inFlightUntil, claim_token: _claimToken, ...prepared } = item;
        items[index] = { ...prepared, state: "prepared" };
      } else {
        items.splice(index, 1);
      }
      if (item.depends_on && !items.some((candidate) => candidate.depends_on === item.depends_on)) {
        const prerequisiteIndex = items.findIndex(
          (candidate) => candidate.id === item.depends_on && candidate.state === "prepared"
        );
        if (prerequisiteIndex >= 0) items.splice(prerequisiteIndex, 1);
      }
      return write(items).persisted;
    }
    function removeDelivered(id: string): boolean {
      return write(read().filter((item) => item.id !== id)).persisted;
    }
    function remove(id: string): boolean {
      const items = read();
      const item = items.find((candidate) => candidate.id === id);
      if (!item || (item.kind === "daily_session_prepare" && items.some((candidate) => candidate.depends_on === id))) {
        return false;
      }
      let next = items.filter((candidate) => candidate.id !== id);
      if (item.depends_on) {
        const prerequisite = next.find((candidate) => candidate.id === item.depends_on);
        if (prerequisite?.state === "prepared" && !next.some((candidate) => candidate.depends_on === item.depends_on)) {
          next = next.filter((candidate) => candidate.id !== item.depends_on);
        }
      }
      return write(next).persisted;
    }
    function clear(): void {
      write([]);
    }

    // Replay queued POSTs oldest-first. `send` RESOLVES on delivery (the item is
    // dropped) and REJECTS on a transient failure (we STOP and keep this item and
    // every one after it for the next flush). Items enqueued DURING a drain (the
    // network dropped again mid-replay) land at the tail and survive, because
    // remove() always re-reads the freshly-stored queue.
    async function drain(send: (item: OutboxItem) => Promise<OutboxSendResult>): Promise<OutboxDrainResult> {
      let sent = 0;
      let needsAttention = 0;
      const queue = read();
      const attentionGroupIds = new Set(
        queue.filter((item) => item.state === "needs_attention" && item.group_id).map((item) => item.group_id as string)
      );
      const blockedGroupIds = new Set(attentionGroupIds);
      for (const item of queue) {
        if (item.state === "prepared") {
          if (!hasDependents(item.id) && !removeDelivered(item.id)) break;
          continue;
        }
        if (item.state === "needs_attention") {
          needsAttention++;
          if (item.group_id) blockedGroupIds.add(item.group_id);
          // A staged workout has no server identity yet. Its exact prepare POST is
          // a FIFO barrier: dependent set/finish writes must not leapfrog a
          // permanent preparation rejection and attach to a different session.
          continue;
        }
        // Generation-aware sending rows are owned by runtime claim/settle. The
        // legacy pure drain never takes them over without a fresh claim token.
        if (item.state === "sending") {
          if (item.group_id) blockedGroupIds.add(item.group_id);
          continue;
        }
        if (item.group_id && blockedGroupIds.has(item.group_id)) continue;
        if (item.depends_on) {
          const prerequisite = read().find((candidate) => candidate.id === item.depends_on);
          if (!prerequisite || prerequisite.kind !== "daily_session_prepare") {
            const current = read();
            const index = current.findIndex((candidate) => candidate.id === item.id);
            if (index >= 0) {
              current[index] = { ...current[index], state: "needs_attention" };
              if (!write(current).persisted) break;
            }
            needsAttention++;
            if (item.group_id) blockedGroupIds.add(item.group_id);
            continue;
          }
          if (prerequisite.state !== "prepared") continue;
        }
        let result: OutboxSendResult;
        try {
          result = await send(item);
        } catch {
          break;
        }
        if (result === "needs_attention") {
          const current = read();
          const index = current.findIndex((row) => row.id === item.id);
          if (index >= 0) {
            const { in_flight_until: _inFlightUntil, claim_token: _claimToken, ...pending } = current[index];
            current[index] = { ...pending, state: "needs_attention", failure_status: item.failure_status };
            if (!write(current).persisted) break;
          }
          needsAttention++;
          if (item.group_id) blockedGroupIds.add(item.group_id);
          continue;
        }
        if (item.kind === "daily_session_prepare" && hasDependents(item.id)) {
          const current = read();
          const index = current.findIndex((candidate) => candidate.id === item.id);
          if (index >= 0) {
            current[index] = { ...current[index], state: "prepared" };
            if (!write(current).persisted) break;
          }
        } else {
          if (!removeDelivered(item.id)) break;
        }
        if (item.depends_on) {
          const current = read();
          const prerequisite = current.find((candidate) => candidate.id === item.depends_on);
          if (
            prerequisite?.state === "prepared" &&
            !current.some((candidate) => candidate.depends_on === item.depends_on)
          ) {
            if (!removeDelivered(item.depends_on)) break;
          }
        }
        sent++;
      }
      return { sent, remaining: count(), needsAttention };
    }

    return {
      enqueue,
      allocateId,
      allocateClaimToken,
      list,
      review,
      count,
      retry,
      claimNext,
      settle,
      remove,
      hasDependents,
      clear,
      drain,
    };
  }

  const CAIRN_OUTBOX_QUEUE: OutboxQueueApi = {
    createOutbox,
    KEY: OUTBOX_KEY,
    SEND_CLAIM_MS: OUTBOX_SEND_CLAIM_MS,
  };

  Object.assign(globalThis, { CairnOutboxQueue: CAIRN_OUTBOX_QUEUE });
}
