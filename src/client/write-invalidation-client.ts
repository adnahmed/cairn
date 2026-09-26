// @ts-check
// ONE table from a write to the client caches it makes stale.
//
// A write that lands somewhere other than the surface the athlete is looking at —
// a chat turn applying `log_food` in the background, an Undo in Changes, a finished
// session — used to drop only the one key its own call site remembered (usually
// "plan"), so Fuel, Train and the Brief kept painting their last-known read of a
// day that had already changed. Freshness beats speed: every write here names every
// cache layer it touches, and the chat table is held complete by a test against the
// server's own CHAT_ACTION_TYPES (test/clientWriteInvalidation.test.js).
//
// A target is one of:
//   - an SWR key (`"plan"`, exact) or prefix (`"today:aggregate:"`, trailing ":"),
//     dropped through swrInvalidate (swr-cache.ts);
//   - `"@<name>"`, a named snapshot a surface keeps outside the SWR cache (the Train
//     overview's, the endurance view's, the Brief's in-memory read). A surface
//     registers how to clear its own with `register(name, clear)`; an unregistered
//     name (its bundle not loaded yet) has nothing to clear.
// Every invalidation also clears api()'s own micro/stale tier (apiInvalidate), since
// a chat turn's write happened on the server long after the POST that started it.

type WriteInvalidationRoot = typeof globalThis & {
  swrInvalidate?: (keyOrPrefix: string) => void;
  apiInvalidate?: () => void;
  state?: { brief?: unknown; plan?: unknown[] };
};

type WriteInvalidationApi = {
  CHAT_ACTION_TARGETS: Readonly<Record<string, readonly string[]>>;
  WRITE_TARGETS: Readonly<Record<string, readonly string[]>>;
  targetsForChatAction(type: unknown): readonly string[];
  targetsForWrite(name: string): readonly string[];
  invalidate(targets: readonly string[], opts?: { keep?: readonly string[] }): string[];
  invalidateChatApplied(applied: unknown): string[];
  invalidateWrite(name: string, opts?: { keep?: readonly string[] }): string[];
  register(name: string, clear: () => void): void;
};

{
  // Surfaces that read the whole day: the Today aggregate, the stones, Horizon's
  // last-known race reads (offline-state-client.ts), the Brief.
  const DAY = ["today:aggregate:", "today:stones:", "horizon:", "@brief"] as const;
  // Everything a logged training session feeds.
  const TRAINING = [
    "stats",
    "history:sessions",
    "progress:volume",
    "progress:calendar",
    "progress:exercises",
    "progress:program",
    "program:progression:",
    "last-set:",
    "@train",
  ] as const;
  // Everything a plan change feeds.
  const PLAN = [
    "plan",
    "plan:",
    "exercises",
    "exercises:names",
    "program:progression:",
    "progress:program",
    "today:daily-session:",
    "brain:changes",
    "health:asks",
    "@train",
    "@endurance",
  ] as const;
  const FOOD = ["food:day:", "fuel:band:", "fuel:ideas:", "progress:intake", "progress:energy", "stats"] as const;
  const BODY = ["progress:weight", "progress:energy", "stats", "profile", "me:goal", "fuel:band:"] as const;
  const GOAL = ["profile", "me:goal", "settings:screen", "@endurance", "@train"] as const;
  const HEALTH = ["health:", "markers:", "recovery:"] as const;
  const LIFE = ["me:life", "me:life:"] as const;

  const t = (...groups: ReadonlyArray<readonly string[]>): readonly string[] => Object.freeze([...new Set(groups.flat())]);

  // Every chat action type the server can apply (src/chatActions.ts
  // CHAT_ACTION_TYPES). A new action type without a row here fails the test.
  const CHAT_ACTION_TARGETS: Readonly<Record<string, readonly string[]>> = Object.freeze({
    log_activity: t(DAY, TRAINING, ["today:session:", "@endurance", "progress:energy", "fuel:band:"]),
    log_set: t(DAY, TRAINING, ["today:session:", "exercises", "exercises:names"]),
    set_profile: t(DAY, GOAL, BODY),
    set_training_intent: t(DAY, GOAL, PLAN),
    set_endurance_goal: t(DAY, GOAL, ["@endurance"]),
    set_endurance_schedule: t(DAY, GOAL, ["@endurance", "today:daily-session:"]),
    set_strength_schedule: t(DAY, GOAL, PLAN),
    set_movement_considerations: t(DAY, GOAL, ["plan:"]),
    set_strength_objective: t(DAY, GOAL, ["progress:program"]),
    add_memory: t(["me:memory", "health:learned"]),
    update_memory: t(["me:memory", "health:learned"]),
    supersede_memory: t(["me:memory", "health:learned"]),
    log_food: t(DAY, FOOD),
    update_food_note: t(DAY, FOOD),
    log_weight: t(DAY, BODY),
    log_blood_pressure: t(DAY, HEALTH),
    plan_update: t(DAY, PLAN),
    plan_restructure: t(DAY, PLAN),
    set_run: t(DAY, PLAN, ["@endurance"]),
    log_health: t(DAY, HEALTH, ["supplements"]),
    add_context_event: t(DAY, LIFE),
    resolve_context_event: t(DAY, LIFE),
    log_context_tag: t(DAY, LIFE),
    log_supplement: t(DAY, HEALTH, ["supplements"]),
    log_measurement: t(DAY, BODY, HEALTH),
    report_training_symptom: t(DAY, PLAN, ["today:session:"]),
    resolve_training_symptom: t(DAY, PLAN, ["today:session:"]),
    log_checkin: t(DAY, ["recovery:"]),
    flag_training_structure: t(DAY, PLAN),
    // A revert puts back whatever the decision changed: it can be any of the above.
    revert_decision: t(DAY, PLAN, TRAINING, FOOD, BODY, GOAL, LIFE, ["meals:plans"]),
  });

  // Writes the PWA makes itself, from surfaces that are not chat.
  const WRITE_TARGETS: Readonly<Record<string, readonly string[]>> = Object.freeze({
    // Undo / Hold on a brain decision (Changes, the rail, a toast).
    decision_revert: CHAT_ACTION_TARGETS.revert_decision,
    // POST /sessions/:id/finish.
    // The caller keeps the session key it just primed from the finish response.
    session_finish: t(DAY, TRAINING, ["today:daily-session:"]),
    // Applying a drafted proposal (Coach list, a chat draft card).
    proposal_apply: t(DAY, PLAN),
    // A meal plan edit / swap / status change.
    meal_edit: t(["meals:plans", "shop:", "fuel:ideas:", "@brief"]),
  });

  const snapshots = new Map<string, () => void>();

  function register(name: string, clear: () => void): void {
    if (name && typeof clear === "function") snapshots.set(name.replace(/^@/, ""), clear);
  }

  // The Brief's in-memory read is shared state every surface already clears this way.
  register("brief", () => {
    const root = globalThis as WriteInvalidationRoot;
    if (root.state && typeof root.state === "object") root.state.brief = null;
  });

  function targetsForChatAction(type: unknown): readonly string[] {
    return typeof type === "string" && Object.hasOwn(CHAT_ACTION_TARGETS, type)
      ? CHAT_ACTION_TARGETS[type]
      : [];
  }

  function targetsForWrite(name: string): readonly string[] {
    return Object.hasOwn(WRITE_TARGETS, name) ? WRITE_TARGETS[name] : [];
  }

  function invalidate(targets: readonly string[], opts: { keep?: readonly string[] } = {}): string[] {
    const root = globalThis as WriteInvalidationRoot;
    const keep = new Set(opts.keep || []);
    const done: string[] = [];
    for (const target of new Set(targets)) {
      if (!target || keep.has(target)) continue;
      if (target.startsWith("@")) {
        const clear = snapshots.get(target.slice(1));
        try {
          clear?.();
        } catch {}
      } else {
        try {
          root.swrInvalidate?.(target);
        } catch {}
      }
      done.push(target);
    }
    if (done.length) {
      try {
        root.apiInvalidate?.();
      } catch {}
    }
    return done;
  }

  // meta.applied of a finished chat turn: [{ type, result?, error? }]. Every entry
  // is honoured, a failed one included — an action can commit and still report an
  // error on its read-back, and a needless refetch costs one GET.
  function invalidateChatApplied(applied: unknown): string[] {
    if (!Array.isArray(applied)) return [];
    const targets: string[] = [];
    for (const entry of applied) {
      const type = entry && typeof entry === "object" ? (entry as { type?: unknown }).type : null;
      targets.push(...targetsForChatAction(type));
    }
    return targets.length ? invalidate(targets) : [];
  }

  function invalidateWrite(name: string, opts: { keep?: readonly string[] } = {}): string[] {
    return invalidate(targetsForWrite(name), opts);
  }

  const CAIRN_WRITE_INVALIDATION: WriteInvalidationApi = {
    CHAT_ACTION_TARGETS,
    WRITE_TARGETS,
    targetsForChatAction,
    targetsForWrite,
    invalidate,
    invalidateChatApplied,
    invalidateWrite,
    register,
  };

  Object.assign(globalThis, { CairnWriteInvalidation: CAIRN_WRITE_INVALIDATION });
}
