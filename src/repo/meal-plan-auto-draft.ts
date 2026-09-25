// Meal plans are ideation, drafted when the athlete asks — unless they opt in.
//
// `settings.meal_plan_auto_draft` (default OFF) is the ONE switch over every
// automatic meal-plan draft: the scheduler's weekly refresh and the owned
// "protective" reshape channel (MEAL_REFRESH_REQUEST_KEY) that the fuel loop, a
// landed nutrition target and a new nutrition directive all write into. When it is
// off, those writers leave the channel empty and the scheduler retires anything
// already parked there, so nothing spins on a retry backoff for work that will
// never run. Explicit requests (chat, REST/MCP draft, the PWA button) never pass
// through here — they always draft.
//
// Directives and the accepted nutrition target still reach every plan the athlete
// asks for: the meal prompt reads them live at draft time, so turning the automatic
// refresh off loses no connected-brain input, only the unasked-for draft.
import { getAppState, setAppState } from "./app-state.js";
import {
  MEAL_REFRESH_ATTEMPT_KEY,
  MEAL_REFRESH_INSTRUCTION_KEY,
  MEAL_REFRESH_REQUEST_KEY,
} from "./meal-refresh-retry.js";
import { getSettings } from "./settings.js";

/** True only when the athlete opted into automatic meal-plan drafts. Fails closed. */
export function mealPlanAutoDraftEnabled(): boolean {
  try {
    return getSettings().meal_plan_auto_draft === true;
  } catch {
    return false;
  }
}

const PENDING_KEYS = [MEAL_REFRESH_REQUEST_KEY, MEAL_REFRESH_INSTRUCTION_KEY, MEAL_REFRESH_ATTEMPT_KEY] as const;

/**
 * Retire any parked automatic meal-refresh request (its instruction and retry
 * state with it). Writes only when something is actually parked, so the idle
 * scheduler minute stays read-only. Returns true when something was cleared.
 */
export function retirePendingMealRefresh(): boolean {
  let cleared = false;
  for (const key of PENDING_KEYS) {
    if (String(getAppState(key) ?? "").trim()) {
      setAppState(key, "");
      cleared = true;
    }
  }
  return cleared;
}
