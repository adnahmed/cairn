// @ts-check
// packet-builder, the model (docs/V2-PLAN.md wave 3, "a packet you can hand over").
// Pure shaping from the server's packet JSON (GET /api/health-report.json,
// ClientHealthReportJson) to what the builder paints, plus the one query string every
// packet format shares (`?sections=` and `?questions=`, src/routes/exports.ts):
//   - the section catalog, its labels and the default selection come from the server;
//   - a toggled-off section is simply not named in `sections=` (none on = `none`);
//   - the athlete's edited question list travels as repeated `questions=` (an empty
//     list is a single empty `questions=`, which the server reads as "no questions");
//     null means "the server's proposals", so nothing is sent.
// The lab's own HIGH/LOW flag and "outside optimal" stay two separate fields here and
// two separate marks on the page. No scores: the packet JSON carries none.
{
  type Marker = import("../contracts/health-records.js").ClientReportMarkerJson;
  type Option = ClientPacketSectionOption;
  type Row = ClientPacketPreviewRow;
  type Section = ClientPacketPreviewSection;

  /** Rows a preview section shows before "and N more". */
  const LIST_CAP = 8;
  /** Shown until the server's own line arrives, so the line is never missing. */
  const DISCLAIMER = "Informational, not medical advice.";

  const EMPTY: Record<string, string> = {
    findings: "Nothing flagged to discuss.",
    visit_questions: "No questions for this visit.",
    body_composition: "No body composition scan on file.",
    panels: "No results on file.",
    supplements: "No supplements listed.",
    sources: "No source documents.",
  };

  const obj = (v: unknown): Record<string, unknown> =>
    v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  const str = (v: unknown): string => (v == null ? "" : String(v).trim());

  /** The server's section catalog, validated; [] when the read carried none. */
  function catalog(report: unknown): Option[] {
    return arr(obj(report).section_catalog)
      .map((raw) => {
        const o = obj(raw);
        return { id: str(o.id), label: str(o.label) || str(o.id), included: o.included === true };
      })
      .filter((o) => o.id);
  }

  /** The ids a read printed, in catalog order. */
  function sectionsOf(report: unknown): string[] {
    return catalog(report)
      .filter((o) => o.included)
      .map((o) => o.id);
  }

  /** `current` with `id` switched on or off, kept in the catalog's order. */
  function toggle(options: readonly Option[], current: readonly string[], id: string, on: boolean): string[] {
    const set = new Set(current);
    if (on) set.add(id);
    else set.delete(id);
    return options.map((o) => o.id).filter((key) => set.has(key));
  }

  /** "?sections=…&questions=…", or "" when both are the server's defaults. */
  function query(sel: ClientPacketSelection): string {
    const parts: string[] = [];
    if (sel.sections)
      parts.push(`sections=${sel.sections.length ? encodeURIComponent(sel.sections.join(",")) : "none"}`);
    if (sel.questions) {
      if (!sel.questions.length) parts.push("questions=");
      for (const q of sel.questions) parts.push(`questions=${encodeURIComponent(q)}`);
    }
    return parts.length ? `?${parts.join("&")}` : "";
  }

  /**
   * Whether there is anything to hand over: true/false when the read printed panels,
   * null when it could not tell (panels toggled off).
   */
  function hasRecords(report: unknown): boolean | null {
    const r = obj(report);
    if (!Array.isArray(r.groups)) return null;
    return r.groups.length > 0 || r.bodyComp != null;
  }

  function value(m: Marker): string {
    const v = str(m.value);
    const unit = str(m.unit);
    return v && unit ? `${v} ${unit}` : v;
  }

  // The two facts come from the packet's own named fields (`lab_flagged`,
  // `outside_optimal`), never read off `abnormal`, which merges them.
  function findingRow(raw: unknown): Row {
    const m = obj(raw) as unknown as Marker;
    const side = m.flag === "high" || m.flag === "low" ? m.flag : null;
    const labFlagged = typeof m.lab_flagged === "boolean" ? m.lab_flagged : side != null;
    return {
      title: str(m.name),
      detail: value(m),
      date: str(m.latestDate) || null,
      flag: labFlagged ? side : null,
      outsideOptimal: typeof m.outside_optimal === "boolean" ? m.outside_optimal : m.inOptimal === false,
    };
  }

  function plainRow(title: unknown, detail: unknown = "", date: unknown = null): Row {
    return { title: str(title), detail: str(detail), date: str(date) || null, flag: null, outsideOptimal: false };
  }

  function panelRow(raw: unknown): Row {
    const g = obj(raw);
    const names = arr(g.markers)
      .map((m) => str(obj(m).name))
      .filter(Boolean);
    const shown = names.slice(0, 4).join(", ");
    const more = names.length > 4 ? ` and ${names.length - 4} more` : "";
    return plainRow(g.label, `${shown}${more}`);
  }

  function rowsFor(id: string, r: Record<string, unknown>): Row[] {
    switch (id) {
      case "findings":
        return arr(r.findings).map(findingRow);
      case "visit_questions":
        return arr(r.visit_questions).map((q) => plainRow(obj(q).text));
      case "body_composition": {
        const b = obj(r.bodyComp);
        return r.bodyComp ? [plainRow(b.label, b.summary, b.asOf)] : [];
      }
      case "panels":
        return arr(r.groups).map(panelRow);
      case "supplements":
        return arr(r.supplements).map((s) => {
          const o = obj(s);
          return plainRow(o.name, [str(o.dose), str(o.frequency)].filter(Boolean).join(" · "));
        });
      case "sources":
        return arr(r.sources).map((s) => plainRow(obj(s).name, obj(s).kind, obj(s).date));
      default:
        return [];
    }
  }

  /** The live preview: every printed section in the packet's own order, capped. */
  function previewModel(report: unknown): ClientPacketPreview {
    const r = obj(report);
    const labels = new Map(catalog(report).map((o) => [o.id, o.label]));
    const printed = arr(r.sections).map(str).filter(Boolean);
    const sections: Section[] = printed.map((id) => {
      const rows = rowsFor(id, r).filter((row) => row.title);
      return {
        id,
        label: labels.get(id) || id,
        ordered: id === "visit_questions",
        rows: rows.slice(0, LIST_CAP),
        more: Math.max(0, rows.length - LIST_CAP),
        empty: rows.length ? null : EMPTY[id] || "Nothing here yet.",
      };
    });
    const range = obj(r.dateRange);
    return {
      generated: str(r.generated) || null,
      range: str(range.from) && str(range.to) ? { from: str(range.from), to: str(range.to) } : null,
      sections,
      disclaimer: str(r.disclaimer) || DISCLAIMER,
    };
  }

  const CAIRN_PACKET_BUILDER_MODEL = {
    LIST_CAP,
    DISCLAIMER,
    catalog,
    sectionsOf,
    toggle,
    query,
    hasRecords,
    previewModel,
  };

  Object.assign(globalThis, { CairnPacketBuilderModel: CAIRN_PACKET_BUILDER_MODEL });
}
