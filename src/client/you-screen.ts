// @ts-check
// The You home's landing (/app/you, and /app/you/stone?id=<key>): the whole cairn,
// then Health, About you and Settings.
//
// PLACEHOLDER (v2 wave 5, stream A). The shell pre-registered this file so the
// You home works the moment the tab bar ships: it lists the surfaces that moved
// here and opens each one where it already lives. Stream B replaces it with the
// cairn-stack (cairn-stack-*.ts) and stone detail (stone-detail-*.ts) above these
// groups. This file is in an EAGER bundle, so You paints without the lazy
// me-health bundle; Health and About you load it on the tap that needs it
// (render-dispatch awaits ensureBundle for the stand and me views).

type YouLandingView = "stand" | "me" | "settings";
type YouLandingRow = {
  view: YouLandingView;
  section: string | null;
  title: string;
  sub: string;
};
type YouLandingGroup = { key: string; title: string; rows: readonly YouLandingRow[] };

{
  const YOU_LANDING_GROUPS: readonly YouLandingGroup[] = [
    {
      key: "health",
      title: "Health",
      rows: [
        {
          view: "stand",
          section: null,
          title: "Health: where you stand",
          sub: "Your markers, what they connect to, and what to do next",
        },
        { view: "stand", section: "records", title: "Records", sub: "Labs, scans and documents" },
        { view: "stand", section: "checkup", title: "Checkup", sub: "What is worth re-checking, and when" },
      ],
    },
    {
      key: "about",
      title: "About you",
      rows: [
        { view: "me", section: "profile", title: "Profile", sub: "About you, goals, discipline & bodyweight" },
        { view: "me", section: "life", title: "Life", sub: "Trips, injuries & events on your timeline" },
        { view: "me", section: "family", title: "Family", sub: "The people your coach plans around" },
        { view: "me", section: "memory", title: "Memory", sub: "What Cairn remembers about you" },
      ],
    },
    {
      key: "settings",
      title: "Settings",
      rows: [
        { view: "settings", section: "sources", title: "Sources", sub: "Garmin and Apple Health" },
        { view: "settings", section: "automation", title: "Automation", sub: "How much the team does on its own" },
        { view: "settings", section: "data", title: "Data", sub: "Export, backup and this app" },
        { view: "settings", section: "agents", title: "Agents", sub: "The coaching agents and their order" },
        { view: "settings", section: "system", title: "System", sub: "Updates and diagnostics" },
      ],
    },
  ];

  function youLandingHtml(groups: readonly YouLandingGroup[] = YOU_LANDING_GROUPS): string {
    return groups
      .map(
        (group) =>
          `<section class="you-group reveal" aria-labelledby="youGroup-${escAttr(group.key)}">
        <h2 class="lbl you-group-h" id="youGroup-${escAttr(group.key)}">${escHtml(group.title)}</h2>
        <div class="set-you">${group.rows
          .map(
            (row) =>
              `<button class="set-you-card" type="button" data-you-view="${escAttr(row.view)}" data-you-section="${escAttr(row.section || "")}">
            <span class="set-you-t">${escHtml(row.title)}</span><span class="set-you-s">${escHtml(row.sub)}</span>
            <span class="set-you-arw" aria-hidden="true">›</span>
          </button>`
          )
          .join("")}</div>
      </section>`
      )
      .join("");
  }

  function openYouRow(viewName: string, section: string): void {
    if (viewName === "stand") {
      state.standSeg = (section || null) as ClientStandSection | null;
      state.standDomain = null;
      activateTab("stand");
    } else if (viewName === "me") {
      state.meSeg = (section || "profile") as ClientMeSection;
      activateTab("me");
    } else if (viewName === "settings") {
      if (section) state.setSeg = section as ClientSettingsSection;
      activateTab("settings");
    }
  }

  function renderYou(): void {
    headerTitle.textContent = "You";
    view.innerHTML = `<div class="you-landing">${youLandingHtml()}</div>`;
    view
      .querySelectorAll<HTMLElement>("[data-you-view]")
      .forEach((button) =>
        button.addEventListener("click", () =>
          openYouRow(button.dataset.youView || "", button.dataset.youSection || "")
        )
      );
  }

  Object.assign(globalThis, { renderYou, CairnYouLanding: { html: youLandingHtml, groups: YOU_LANDING_GROUPS } });
}
