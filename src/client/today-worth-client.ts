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

  function railAgenda<T extends Partial<Agenda> | null | undefined>(
    agenda: T,
    opts: { fuelGlance: boolean; thread?: Thread }
  ): T {
    const text = opts.thread ? `${String(opts.thread.title ?? "")} ${String(opts.thread.summary ?? "")}` : "";
    const echoes = text.trim() ? CairnTodayAgenda.threadEchoIds(agenda, text) : [];
    if (!opts.fuelGlance && !echoes.length) return agenda;
    return CairnTodayAgenda.withoutCards(agenda, opts.fuelGlance ? ["fuel"] : [], echoes);
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

  const CAIRN_TODAY_WORTH = { railAgenda, mountInstallRow };

  Object.assign(globalThis, { CairnTodayWorth: CAIRN_TODAY_WORTH });
}
