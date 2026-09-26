// @ts-check
// The Horizon home (/app/horizon, /app/horizon/goal): what is ahead, on one
// timeline: the race lane, the goal line, and labs and scans.
//
// PLACEHOLDER (v2 wave 5, stream A). The shell pre-registered this file so the
// Horizon home works the moment the tab bar ships: it shows the race view that
// already exists (plan-endurance-client.ts, /app/horizon/race), under Horizon's
// own title. Stream C replaces it with the timeline and its lanes (horizon-*.ts).

{
  function renderHorizon(): unknown {
    // renderPlanEndurance paints its shell (and its own title) synchronously
    // before its first await, so the Horizon title set after it is the one shown.
    const painted = renderPlanEndurance();
    headerTitle.textContent = "Horizon";
    return painted;
  }

  Object.assign(globalThis, { renderHorizon });
}
