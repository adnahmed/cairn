// @ts-check
// Food composer — the "usual around now" prefill chips, a piece of the composer
// (food-composer-controller.ts wires it with the mount's signal).

function foodComposerChipsDefaultAutosize(input: HTMLTextAreaElement | HTMLInputElement): void {
  const layout = (globalThis as unknown as { CairnChatLayout?: Partial<ChatLayoutApi> }).CairnChatLayout;
  layout?.autosizeInput?.(input);
}

// "Usual around now" prefill chips above the composer. Shown only while the
// composer is EMPTY and focused; a tap drafts the food for the athlete to edit and
// send. Never auto-sends — meals vary, so the frequent is a starting sentence and
// the estimate is re-derived from the text actually sent. Fetched once per mount,
// quiet on failure.
function wireFoodComposerFrequents(
  slot: HTMLElement,
  input: HTMLTextAreaElement,
  deps: FoodComposerDeps,
  signal: AbortSignal
): { hide(): void } {
  const mode = CairnFoodComposerModel.mode(deps.mode);
  let requested = false;
  const hide = () => {
    slot.hidden = true;
  };
  const showIfReady = () => {
    if (slot.firstElementChild) slot.hidden = false;
  };
  const maybeShow = async (): Promise<void> => {
    if (input.value.trim()) {
      hide();
      return;
    }
    if (!requested) {
      requested = true;
      const hour = deps.hour ? deps.hour() : new Date().getHours();
      let foods: unknown = [];
      try {
        foods = await deps.api(`/frequent-foods?hour=${hour}`);
      } catch {
        foods = [];
      }
      if (signal.aborted || !slot.isConnected) return;
      slot.innerHTML = CairnFoodComposerClient.frequentChipsHtml(foods);
      if (input.value.trim() || document.activeElement !== input) return;
    }
    showIfReady();
  };
  CairnUiActions.delegate(
    slot,
    "click",
    {
      freq: (chip) => {
        input.value = CairnFoodComposerModel.chipText(chip.dataset.freq, mode);
        (deps.autosizeInput || foodComposerChipsDefaultAutosize)(input);
        hide();
        input.focus();
      },
    },
    { signal }
  );
  input.addEventListener("focus", () => void maybeShow(), { signal });
  input.addEventListener(
    "input",
    () => {
      if (input.value.trim()) hide();
      else showIfReady();
    },
    { signal }
  );
  return { hide };
}

const CAIRN_FOOD_COMPOSER_CHIPS = {
  wire: wireFoodComposerFrequents,
};

Object.assign(globalThis, { CairnFoodComposerChips: CAIRN_FOOD_COMPOSER_CHIPS });
