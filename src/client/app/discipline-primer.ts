// @ts-check
{
  function primeDiscipline(): void {
    const warm = peekCached<{ primary_discipline?: unknown; endurance_goal_json?: unknown }>("profile");
    if (warm && warm.data) {
      setDiscipline(warm.data.primary_discipline);
      setEnduranceGoalSet(!!warm.data.endurance_goal_json);
      return;
    }

    api("/profile").then((profile) => {
      if (!profile) return;
      // Held for the next open, which then primes from it synchronously instead of
      // repainting the screen it already drew once this answer lands.
      swrSet("profile", profile);
      const before = defaultProgressSeg();
      const beforeEnduranceVisible = showEnduranceTab();
      setDiscipline(profile.primary_discipline);
      setEnduranceGoalSet(!!profile.endurance_goal_json);
      // Only re-render if we're still sitting on the Progress tab and nothing was
      // navigated since boot, and the endurance default actually changed the seg.
      if (state.tab === "progress" && !state.progressSeg && defaultProgressSeg() !== before) renderTab("progress");
      // Likewise: a cold-boot landing straight on Plan painted the 3-tab sub-nav
      // before the profile resolved. Repaint so Endurance appears once known. The race
      // view itself carries no sub-nav, so it is never painted (and read) twice.
      if (state.tab === "plan" && state.planSeg !== "endurance" && showEnduranceTab() !== beforeEnduranceVisible) {
        renderTab("plan");
      }
    }).catch(() => {});
  }

  Object.assign(globalThis, { primeDiscipline });

  if (typeof window !== "undefined") {
    window.primeDiscipline = primeDiscipline;
  }
}
