// @ts-check
// "Worth a look" — Today's ONE quiet group at the foot of the column (Atelier v2,
// show-when-needed). Housekeeping and one-off reads never stack as cards under the
// Brief: the agenda's ranked reads, the "n more" disclosure and the install note sit
// here as hairline rows under a single key (CairnTodayAgenda.mastHtml). Two jobs:
//
//   railAgenda  — the agenda without what the column above already says: the fuel
//                 card when the fuel glance stands under NOW, and a health card whose
//                 subject the block thread names (CairnTodayAgenda.threadEchoIds). Each
//                 read stays one tap away where it lives (Fuel, You › Health).
//   mountInstallRow — the calm, dismissible install note as the group's first row;
//                 with no rail on the page it closes the main column instead. Settings
//                 keeps its own copy of the note.
{
  type Agenda = import("../contracts/client.js").ClientTodayAgenda;
  type Thread = { title?: unknown; summary?: unknown } | null | undefined;

  // What the redesigned column already carries (the Today redesign): the team's
  // changes and the one genuine ask live in the overnight digest, the week ahead and
  // the next long run in Coming up, the week's sessions in This week, the connection
  // insight as the one new-connection line. Those cards leave the rail; each read stays
  // one tap away where it lives (Plan, Horizon, Ask › Changes).
  const COLUMN_CARDS = ["program-adjustments", "week-ahead", "lately", "connection-insight"] as const;
  const COLUMN_ACTIONS = new Set(["plan-endurance"]);

  function columnIds(agenda: Partial<Agenda> | null | undefined): string[] {
    const ids: string[] = [];
    for (const card of [...(agenda?.primary || []), ...(agenda?.more || [])]) {
      const id = String(card?.id || "");
      if (!id) continue;
      if (id === "draft-proposals" || id.startsWith("announced-decision-") || COLUMN_ACTIONS.has(String(card?.action?.kind || "")))
        ids.push(id);
    }
    return ids;
  }

  function railAgenda<T extends Partial<Agenda> | null | undefined>(
    agenda: T,
    opts: { fuelGlance: boolean; thread?: Thread }
  ): T {
    const text = opts.thread ? `${String(opts.thread.title ?? "")} ${String(opts.thread.summary ?? "")}` : "";
    const echoes = text.trim() ? CairnTodayAgenda.threadEchoIds(agenda, text) : [];
    const cards: string[] = [...COLUMN_CARDS, ...(opts.fuelGlance ? ["fuel"] : [])];
    return CairnTodayAgenda.withoutCards(agenda, cards, [...echoes, ...columnIds(agenda)]);
  }

  // The ONE genuine ask the agenda holds (a goal or clinical draft that waits on the
  // athlete), for the digest's question card; null when there is none.
  function askCandidate(agenda: Partial<Agenda> | null | undefined): Agenda["primary"][number] | null {
    for (const card of [...(agenda?.primary || []), ...(agenda?.more || [])]) {
      if (card?.id === "draft-proposals") return card;
    }
    return null;
  }

  // Mounted after the rail's outerHTML write, which would otherwise wipe it.
  function mountInstallRow(root: ParentNode): void {
    try {
      if (typeof renderPhoneCoachBanner !== "function") return;
      const rail = root.querySelector(".today-rail");
      const host = rail || root.querySelector(".today-main");
      if (!host) return;
      renderPhoneCoachBanner(host);
      const note = host.querySelector(".phone-coach, .app-readd");
      if (!rail || !note) return;
      let mast = rail.querySelector(".rail-mast");
      if (!mast) {
        const box = document.createElement("div");
        box.innerHTML = CairnTodayAgenda.mastHtml();
        mast = box.firstElementChild;
        if (!mast) return;
        rail.prepend(mast);
      }
      if (mast.nextElementSibling !== note) mast.after(note);
    } catch {}
  }

  const CAIRN_TODAY_WORTH = { railAgenda, askCandidate, mountInstallRow };

  Object.assign(globalThis, { CairnTodayWorth: CAIRN_TODAY_WORTH });
}
