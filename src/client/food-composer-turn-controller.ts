// @ts-check
// Food composer — following a food-mode send to its end. The instant capture lane
// answers inside the POST, the agent lane a little later; either way the food rows
// the turn wrote come back to the host through `onLogged`, so a surface like Fuel
// refreshes its own list without leaving the screen. Chat never uses this: its
// turn monitor follows chat turns.

const FOOD_COMPOSER_FOLLOW_MS = 1500;
// ~4 minutes of polling; past that the turn is still safe in Chat.
const FOOD_COMPOSER_FOLLOW_MAX = 160;

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
  for (let i = 0; id != null && !CairnFoodComposerModel.turnTerminal(current) && i < FOOD_COMPOSER_FOLLOW_MAX; i++) {
    await wait(FOOD_COMPOSER_FOLLOW_MS);
    if (ctx.signal.aborted) return;
    try {
      const next = await deps.api(`/chat/turns/${id}`);
      if (next === null) break;
      if (next) current = next;
    } catch {
      /* a dropped poll waits for the next one */
    }
    if (ctx.signal.aborted) return;
  }
  // The host was torn down (the athlete left the surface) while the POST or a poll
  // was in flight: the turn is safe in Chat and the next render reads the rows
  // fresh, so nothing here writes into a detached host or toasts over another screen.
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
