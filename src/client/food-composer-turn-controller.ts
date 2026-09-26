// @ts-check
// Food composer — following a food-mode send to its end. The instant capture lane
// answers inside the POST, the agent lane a little later; either way the food rows
// the turn wrote come back to the host through `onLogged`, so a surface like Fuel
// refreshes its own list without leaving the screen. Chat never uses this: its
// turn monitor follows chat turns.

const FOOD_COMPOSER_FOLLOW_MS = 1500;
// ~4 minutes of polling; past that the turn is still safe in Chat.
const FOOD_COMPOSER_FOLLOW_MAX = 160;

type FoodComposerTurnWatch = {
  trackTurn(turn: unknown, opts?: { owned?: boolean }): void;
  releaseTurn(turn: unknown): void;
  settleTurn(turn: unknown): string[];
};

// The write table (write-invalidation-client.ts, bundle-02) — absent only in a bare
// test context.
function foodComposerTurnWatch(): FoodComposerTurnWatch | null {
  const watch = (globalThis as { CairnWriteInvalidation?: FoodComposerTurnWatch }).CairnWriteInvalidation;
  return watch && typeof watch.settleTurn === "function" ? watch : null;
}

function foodComposerWait(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function followFoodComposerTurn(
  turn: unknown,
  deps: Pick<FoodComposerDeps, "api" | "toast" | "onLogged" | "wait">,
  ctx: { signal: AbortSignal; setStatus(text: string): void }
): Promise<void> {
  const wait = deps.wait || foodComposerWait;
  const id = CairnFoodComposerModel.turnId(turn);
  let current = turn;
  // This surface follows the turn while it is on screen; whatever it applies retires
  // every cache it made stale (Today, the Brief, other days' Fuel), not only the
  // host's own widgets.
  const watch = foodComposerTurnWatch();
  if (id != null) watch?.trackTurn(id, { owned: true });
  for (let i = 0; id != null && !CairnFoodComposerModel.turnTerminal(current) && i < FOOD_COMPOSER_FOLLOW_MAX; i++) {
    await wait(FOOD_COMPOSER_FOLLOW_MS);
    if (ctx.signal.aborted) break;
    try {
      const next = await deps.api(`/chat/turns/${id}`);
      if (next === null) break;
      if (next) current = next;
    } catch {
      /* a dropped poll waits for the next one */
    }
    if (ctx.signal.aborted) break;
  }
  // The host was torn down (the athlete left the surface) while the POST or a poll
  // was in flight: the turn is safe in Chat, and the write table's background follow
  // settles its writes; nothing here writes into a detached host or toasts over
  // another screen.
  // A turn that ended is settled here; one still running (the host left, or it ran
  // past our patience) is handed to that background follow.
  if (CairnFoodComposerModel.turnTerminal(current)) watch?.settleTurn(current);
  else if (id != null) watch?.releaseTurn(id);
  if (ctx.signal.aborted) return;
  ctx.setStatus("");
  const outcome = CairnFoodComposerModel.outcome(current);
  if (outcome?.kind === "logged") {
    const meal = outcome.logged.notes[0]?.meal;
    deps.toast(meal ? `Logged your ${meal}` : "Logged");
    deps.onLogged?.(outcome.logged);
    return;
  }
  deps.toast(
    outcome?.kind === "replied"
      ? "Nothing was logged — the coach's reply is in Chat."
      : "That didn't finish here — it's saved in Chat."
  );
}

const CAIRN_FOOD_COMPOSER_TURN = {
  follow: followFoodComposerTurn,
};

Object.assign(globalThis, { CairnFoodComposerTurn: CAIRN_FOOD_COMPOSER_TURN });
