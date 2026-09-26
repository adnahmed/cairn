// @ts-check
// Fuel — the "Log food" control (docs/V2-PLAN.md wave 2). The view: one button that
// opens the shared food composer (food-composer-*.ts) under it, pre-set to food.
// The composer's own markup is the composer's; this view only holds its slot.
{
  function fuelLogHtml(): string {
    return `<div class="fuel-log">
      <button class="pillbtn pill-accent fuel-log-toggle" type="button" data-fuel-log-toggle
        aria-expanded="false" aria-controls="fuelLogPanel">Log food</button>
      <div class="fuel-log-panel" id="fuelLogPanel" role="region" aria-label="Log food">
        <div class="fuel-log-panel-in">
          <div class="fuel-log-composer" data-fuel-log-composer></div>
          <p class="fuel-log-hint">A line per food, or a photo of the plate. Nothing is logged until you send it.</p>
        </div>
      </div>
    </div>`;
  }

  const CAIRN_FUEL_LOG = {
    html: fuelLogHtml,
  };

  Object.assign(globalThis, { CairnFuelLog: CAIRN_FUEL_LOG });
}
