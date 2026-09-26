// @ts-check
// Fuel — the "Log food" control (docs/V2-PLAN.md wave 2). The view: a quiet field
// that reads like the place you write ("What did you eat?"), which opens the shared
// food composer (food-composer-*.ts) in its place, pre-set to food; open, the same
// control folds it away again. The composer's own markup is the composer's; this
// view only holds its slot.
{
  // The toggle's name is its visible words (the field's prompt, or "Close" when open),
  // so a voice-control user can say what they see (label-in-name, WCAG 2.5.3).
  function fuelLogHtml(): string {
    return `<div class="fuel-log">
      <div class="fuel-log-head">
        <h2 class="lbl fuel-log-title">Log what you ate</h2>
        <button class="fuel-log-toggle" type="button" data-fuel-log-toggle
          aria-expanded="false" aria-controls="fuelLogPanel"><span class="fuel-log-faux">What did you eat? A line per food, or a photo of the plate.</span><span class="fuel-log-fold">Close</span></button>
      </div>
      <div class="fuel-log-panel" id="fuelLogPanel" role="region" aria-label="Log food">
        <div class="fuel-log-panel-in">
          <div class="fuel-log-composer" data-fuel-log-composer></div>
          <p class="fuel-log-hint">One line per food, as many as you like. A time is kept only if you write one. Nothing is logged until you send it.</p>
        </div>
      </div>
    </div>`;
  }

  const CAIRN_FUEL_LOG = {
    html: fuelLogHtml,
  };

  Object.assign(globalThis, { CairnFuelLog: CAIRN_FUEL_LOG });
}
