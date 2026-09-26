// @ts-check
// Offline outbox, part 4 of 5: workout mutations. A set, skip or finish logged
// against a session that was staged offline waits behind that session's queued
// prepare; every member of one workout shares a group so none overtakes another;
// and runSessionMutation writes the mutation to the queue before the network, so
// a lost response replays instead of vanishing. The staged session lives in the
// SWR cache (today:session:<date> / today:daily-session:<date>).
type OutboxSessionMutationResult =
  | { status: "sent"; value: unknown; groupId: string }
  | { status: "queued"; item: OutboxItem; groupId: string }
  | {
      status: "blocked";
      reason: "attention" | "other_tab" | "phantom";
      prerequisiteId: string | null;
      groupId: string;
    }
  | { status: "storage_error"; groupId: string }
  | { status: "failed"; error: unknown; groupId: string };
type OutboxSessionMutationPlan =
  | OutboxSessionMutationResult
  | { status: "deliver"; item: ClaimedOutboxItem; groupId: string };
type OutboxSessionApi = {
  rekeyStagedCachePair(date: string, previousId: string, nextId: string): boolean;
  clearMatchingStagedCachePair(date: string, prepareId: string): boolean;
};
declare const CairnOutboxSession: OutboxSessionApi;

{
  const { queue: outbox, withLock: withOutboxRuntimeLock, enqueueUnlocked: enqueueOutboxUnlocked } = CairnOutboxRuntime;
  const { replayHasSemanticFailure } = CairnOutboxReplay;
  const { isTransientApiFailure } = CairnApiCache;
  const OUTBOX_SEND_CLAIM_MS = CairnOutboxQueue.SEND_CLAIM_MS;

  const outboxBlockedStagedDates = new Set<string>();

  function stagedCachePair(date: string): {
    session: Record<string, unknown>;
    daily: Record<string, unknown>;
    prepareId: string;
  } | null {
    if (!date || typeof peekCached !== "function") return null;
    const session = peekCached<Record<string, unknown>>(`today:session:${date}`)?.data;
    const standaloneDaily = peekCached<Record<string, unknown>>(`today:daily-session:${date}`)?.data;
    if (!session || typeof session !== "object") return null;
    const nested =
      session.daily_session && typeof session.daily_session === "object"
        ? (session.daily_session as Record<string, unknown>)
        : null;
    const daily = nested || standaloneDaily;
    if (!daily || session._staged_offline !== true || daily._staged_offline !== true) return null;
    const sessionPair = String(session._local_prepare_id || "");
    const dailyPair = String(daily._local_prepare_id || "");
    return sessionPair && sessionPair === dailyPair ? { session, daily, prepareId: sessionPair } : null;
  }

  function rekeyStagedCachePair(date: string, previousId: string, nextId: string): boolean {
    const pair = stagedCachePair(date);
    if (!pair || pair.prepareId !== previousId || !nextId || typeof swrSet !== "function") return false;
    const daily = { ...pair.daily, _local_prepare_id: nextId };
    const session = { ...pair.session, _local_prepare_id: nextId, daily_session: daily };
    swrSet(`today:session:${date}`, session);
    swrSet(`today:daily-session:${date}`, daily);
    return true;
  }

  function clearMatchingStagedCachePair(date: string, prepareId: string): boolean {
    const pair = stagedCachePair(date);
    if (!pair || pair.prepareId !== prepareId || typeof swrInvalidate !== "function") return false;
    swrInvalidate(`today:session:${date}`);
    swrInvalidate(`today:daily-session:${date}`);
    outboxBlockedStagedDates.add(date);
    return true;
  }

  function outboxSessionPrerequisite(date: string): {
    status: "none" | "ready" | "blocked";
    id: string | null;
    reason?: "attention" | "other_tab" | "phantom";
  } {
    const normalizedDate = String(date || "");
    const sharedPrepares = outbox()
      .list()
      .filter((item) => {
        return item.kind === "daily_session_prepare" && item.session_date === normalizedDate;
      });
    const pair = stagedCachePair(date);
    if (!pair) {
      if (sharedPrepares.length > 0) {
        return { status: "blocked", id: sharedPrepares[0].id, reason: "other_tab" };
      }
      return outboxBlockedStagedDates.has(date)
        ? { status: "blocked", id: null, reason: "phantom" }
        : { status: "none", id: null };
    }
    const prerequisite = sharedPrepares.find((item) => item.id === pair.prepareId);
    if (!prerequisite) {
      if (sharedPrepares.length > 0) {
        return { status: "blocked", id: sharedPrepares[0].id, reason: "other_tab" };
      }
      clearMatchingStagedCachePair(date, pair.prepareId);
      return { status: "blocked", id: null, reason: "phantom" };
    }
    if (sharedPrepares.length !== 1) {
      return { status: "blocked", id: prerequisite.id, reason: "other_tab" };
    }
    if (prerequisite.state === "needs_attention") {
      return { status: "blocked", id: prerequisite.id, reason: "attention" };
    }
    return { status: "ready", id: prerequisite.id };
  }

  function outboxResolveSessionPrerequisite(date: string): void {
    outboxBlockedStagedDates.delete(String(date || ""));
  }

  function outboxBlockSessionPrerequisite(date: string): void {
    const normalized = String(date || "");
    if (normalized) outboxBlockedStagedDates.add(normalized);
  }

  function outboxSessionDependency(date: string): string | null {
    const prerequisite = outboxSessionPrerequisite(date);
    return prerequisite.status === "ready" ? prerequisite.id : null;
  }

  function positiveOutboxIdentity(value: unknown): string | null {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? String(parsed) : null;
  }

  function firstPositiveOutboxIdentity(...values: unknown[]): string | null {
    for (const value of values) {
      const identity = positiveOutboxIdentity(value);
      if (identity) return identity;
    }
    return null;
  }

  function outboxSessionGroupId(
    date: string,
    identity: { dailySessionId?: unknown; sessionId?: unknown } = {}
  ): string {
    const normalizedDate = String(date || "").trim();
    const queued = outbox().list();
    const queuedGroup = queued.find((item) => {
      return !!item.group_id && item.session_date === normalizedDate;
    })?.group_id;
    // Once a date-fallback group exists it remains the durable identity through
    // staged -> canonical reconciliation and any attention/retry cycle.
    if (queuedGroup) return queuedGroup;
    let cachedSession: Record<string, unknown> | null = null;
    let cachedDaily: Record<string, unknown> | null = null;
    if (normalizedDate && typeof peekCached === "function") {
      cachedSession = peekCached<Record<string, unknown>>(`today:session:${normalizedDate}`)?.data || null;
      cachedDaily =
        cachedSession?.daily_session && typeof cachedSession.daily_session === "object"
          ? (cachedSession.daily_session as Record<string, unknown>)
          : peekCached<Record<string, unknown>>(`today:daily-session:${normalizedDate}`)?.data || null;
    }
    const stagedPair = normalizedDate ? stagedCachePair(normalizedDate) : null;
    if (stagedPair && queued.some((item) => item.id === stagedPair.prepareId)) {
      return `prepare:${stagedPair.prepareId}`;
    }
    // The server session is the canonical workout identity. A daily composition's
    // own id describes the prescription snapshot, not the workout receiving sets,
    // skips, and finish, so it is only a last-resort canonical fallback.
    const sessionId = firstPositiveOutboxIdentity(identity.sessionId, cachedSession?.id, cachedDaily?.session_id);
    if (sessionId) return `session:${sessionId}`;
    const dailyId = firstPositiveOutboxIdentity(identity.dailySessionId, cachedDaily?.id);
    if (dailyId) return `daily:${dailyId}`;
    return `date:${normalizedDate || "unknown"}`;
  }

  async function runSessionMutation(
    input: {
      date: string;
      kind: string;
      path: string;
      body: unknown;
      method?: "POST" | "DELETE";
      identity?: { dailySessionId?: unknown; sessionId?: unknown };
    },
    send: (idempotencyKey: string) => Promise<unknown>
  ): Promise<OutboxSessionMutationResult> {
    const plan = await withOutboxRuntimeLock((): OutboxSessionMutationPlan => {
      const date = String(input.date || "");
      const box = outbox();
      const groupId = outboxSessionGroupId(date, input.identity);
      // Allocate once, then write the complete mutation ahead of the network.
      // A lease-takeover tab therefore sees the in-flight workout member and can
      // only append behind it; a lost response never creates a detached fallback.
      const mutationId = box.allocateId();
      const blocked = (prerequisite: ReturnType<typeof outboxSessionPrerequisite>): OutboxSessionMutationResult => ({
        status: "blocked",
        reason: prerequisite.reason || "phantom",
        prerequisiteId: prerequisite.id,
        groupId,
      });
      const prerequisite = outboxSessionPrerequisite(date);
      if (prerequisite.status === "blocked") return blocked(prerequisite);
      const groupAlreadyQueued = box.list().some((item) => item.group_id === groupId);
      const deliver = prerequisite.status !== "ready" && !groupAlreadyQueued;
      const claimToken = deliver ? box.allocateClaimToken() : null;
      const item = enqueueOutboxUnlocked(input.kind, input.path, input.body, {
        itemId: mutationId,
        method: input.method,
        dependsOn: prerequisite.status === "ready" ? prerequisite.id : null,
        groupId,
        sessionDate: date,
        ...(deliver
          ? {
              state: "sending" as const,
              inFlightUntil: Date.now() + OUTBOX_SEND_CLAIM_MS,
              claimToken,
            }
          : {}),
      });
      if (!item) return { status: "storage_error", groupId } as const;
      if (!deliver) {
        return { status: "queued", item, groupId } as const;
      }
      return { status: "deliver", item: item as ClaimedOutboxItem, groupId } as const;
    });

    if (plan.status !== "deliver") {
      CairnOutbox.renderBar();
      if (plan.status === "queued") void flushOutbox();
      return plan;
    }

    const { item, groupId } = plan;
    try {
      const value = await send(item.id);
      if (replayHasSemanticFailure(item, value)) {
        // Keep the response contract for the caller's existing precise error
        // handling, while making the durable row explicitly reviewable.
        await withOutboxRuntimeLock(() => outbox().settle(item.id, item.claim_token, "attention"));
        CairnOutbox.renderBar();
        return { status: "sent", value, groupId };
      }
      // Completion reacquires current lock ownership after the network wait. That
      // prevents a resumed, expired lease holder from overwriting rows appended or
      // removed by the takeover tab while this response was in flight.
      await withOutboxRuntimeLock(() => outbox().settle(item.id, item.claim_token, "delivered"));
      CairnOutbox.renderBar();
      return { status: "sent", value, groupId };
    } catch (error) {
      if (isTransientApiFailure(error)) {
        await withOutboxRuntimeLock(() => outbox().settle(item.id, item.claim_token, "pending"));
        const queued =
          outbox()
            .list()
            .find((candidate) => candidate.id === item.id) || item;
        CairnOutbox.renderBar();
        void flushOutbox();
        return { status: "queued", item: queued, groupId };
      }
      const failureStatus = error instanceof CairnApiError && error.status != null ? error.status : undefined;
      await withOutboxRuntimeLock(() => outbox().settle(item.id, item.claim_token, "attention", failureStatus));
      CairnOutbox.renderBar();
      return { status: "failed", error, groupId };
    }
  }

  const CAIRN_OUTBOX_SESSION: OutboxSessionApi = { rekeyStagedCachePair, clearMatchingStagedCachePair };

  Object.assign(globalThis, {
    CairnOutboxSession: CAIRN_OUTBOX_SESSION,
    outboxSessionDependency,
    outboxSessionGroupId,
    outboxSessionPrerequisite,
    runSessionMutation,
    outboxResolveSessionPrerequisite,
    outboxBlockSessionPrerequisite,
  });
}
