// @ts-check
// records-search, the model (docs/V2-PLAN.md wave 3). Pure shaping from the marker
// catalog (GET /api/markers/priority: markers + the canonical `groups`, which the
// server lists in MARKER_GROUPS order) into the sections one grouping mode shows:
//   - "outrange": what is outside the LAB's range leads, then what sits outside its
//     optimal band (its own section, never folded into the lab's), then every other
//     marker by panel. "Outside the lab's range" is the server's own read on each row
//     (`lab_out_of_range`, src/repo/lab-range.ts — the lab flagged it, or its value sits
//     outside the range the lab printed), the same rule and the same section keys and
//     labels the server search (`group=out_of_range`) leads with. It is never re-derived
//     here. The panels after them make no range claim: a reading no lab ranged is never
//     filed as "within the lab's range";
//   - "panel":    clinical panels in the server's MARKER_GROUPS order;
//   - "newest":   one section per draw date, newest first, panel order inside a date.
// Search narrows markers by name or panel. The server search (GET /api/records/search,
// ClientRecordsSearchRead in src/contracts/health-records.ts) reaches the records the
// catalog doesn't hold — documents, visit notes and body readings — through
// `searchPath`/`otherItems`, which read the non-marker hits out of its `sections` and
// return null for anything else (a body that isn't a search result shows nothing).
{
  type Mode = ClientRecordsMode;
  type Marker = ClientRecordsMarker;
  type Group = { key: string; label: string };
  type Section = ClientRecordsSection;
  type Other = ClientRecordsOtherItem;
  type SearchRead = import("../contracts/health-records.js").ClientRecordsSearchRead;
  type SearchHit = import("../contracts/health-records.js").ClientRecordsHit;

  // Labels stay short: the sliding bar's thumb assumes three equal pills, and an
  // uppercase tracked label wider than a third of a 360px screen would stretch its
  // pill out from under the thumb. The mode leads with what is out of range.
  const MODES: ReadonlyArray<readonly [Mode, string]> = [
    ["outrange", "Out of range"],
    ["panel", "By panel"],
    ["newest", "Newest"],
  ];
  // The `group=` value the server search takes for each mode. One table, so the
  // integrator reconciles a spelling in one place.
  const SERVER_GROUP: Record<Mode, string> = { outrange: "out_of_range", panel: "panel", newest: "newest" };

  function isMode(value: unknown): value is Mode {
    return value === "outrange" || value === "panel" || value === "newest";
  }

  function normalizeQuery(value: unknown): string {
    return String(value ?? "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function matchesQuery(marker: Marker, q: string): boolean {
    const needle = normalizeQuery(q);
    if (!needle) return true;
    return normalizeQuery(`${String(marker.name || marker.key || "")} ${String(marker.group_label || "")}`).includes(
      needle
    );
  }

  function groupKey(marker: Marker): string {
    return typeof marker.group === "string" && marker.group ? marker.group : "other";
  }

  // The server's ordered group list; any group a marker names that the list lacks is
  // appended after it, in first-seen order, so no marker is ever dropped.
  function groupsFor(groups: unknown, markers: readonly Marker[]): Group[] {
    const out: Group[] = [];
    const seen = new Set<string>();
    for (const g of Array.isArray(groups) ? groups : []) {
      const key = g && typeof g === "object" && typeof g.key === "string" ? g.key : "";
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({ key, label: typeof g.label === "string" && g.label ? g.label : key });
    }
    for (const m of markers) {
      const key = groupKey(m);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ key, label: typeof m.group_label === "string" && m.group_label ? m.group_label : "Other" });
    }
    return out;
  }

  // The two lead sections: keys and labels shared with the server search's
  // `out_of_range` grouping (RANGE_SECTIONS, src/domain/health/records-search.ts).
  const LAB_OUT = { key: "lab_out_of_range", label: "Outside the lab's range" } as const;
  const OFF_OPTIMAL = { key: "outside_optimal", label: "Outside optimal" } as const;

  const flagged = (m: Marker): boolean => m.lab_out_of_range === true;
  const offOptimal = (m: Marker): boolean => !!CairnHealthMarkers.offOptimalWord(m);
  const count = (list: readonly Marker[]): number => list.filter(flagged).length;

  function section(key: string, label: string, kind: Section["kind"], group: string | null, list: Marker[]): Section {
    return { key, label, kind, group, markers: list, flagged: count(list) };
  }

  function dateOf(m: Marker): string {
    const d = String(m.latest?.date || "");
    return /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : "";
  }

  function sectionsModel(input: {
    markers: unknown;
    groups: unknown;
    mode: Mode;
    q?: string;
    scope?: readonly string[] | null;
  }): ClientRecordsModel {
    const all = (Array.isArray(input.markers) ? input.markers : []).filter(
      (m): m is Marker => !!m && typeof m === "object"
    );
    const scoped = input.scope ? all.filter((m) => input.scope!.includes(groupKey(m))) : all;
    const shown = scoped.filter((m) => matchesQuery(m, input.q || ""));
    // Panels first, in MARKER_GROUPS order, each in its clinician scan order.
    const panels: Section[] = [];
    for (const g of groupsFor(input.groups, shown)) {
      const list = shown.filter((m) => groupKey(m) === g.key);
      if (!list.length) continue;
      panels.push(section(g.key, g.label, "panel", g.key, CairnHealthClient.orderMarkersForDisplay(g.key, list)));
    }
    let sections: Section[] = panels;
    if (input.mode === "outrange") {
      const inOrder = panels.flatMap((s) => s.markers);
      const lab = inOrder.filter(flagged);
      const opt = inOrder.filter((m) => !flagged(m) && offOptimal(m));
      const lead = new Set([...lab, ...opt]);
      sections = [
        ...(lab.length ? [section(LAB_OUT.key, LAB_OUT.label, "flagged", null, lab)] : []),
        ...(opt.length ? [section(OFF_OPTIMAL.key, OFF_OPTIMAL.label, "optimal", null, opt)] : []),
        ...panels
          .map((s) =>
            section(
              s.key,
              s.label,
              "panel",
              s.group,
              s.markers.filter((m) => !lead.has(m))
            )
          )
          .filter((s) => s.markers.length),
      ];
    } else if (input.mode === "newest") {
      const inOrder = panels.flatMap((s) => s.markers);
      const dates = [...new Set(inOrder.map(dateOf))].sort((a, b) => (a === b ? 0 : !a ? 1 : !b ? -1 : a < b ? 1 : -1));
      sections = dates.map((d) =>
        section(
          d ? `date-${d}` : "undated",
          d,
          "date",
          null,
          inOrder.filter((m) => dateOf(m) === d)
        )
      );
    }
    return { sections, total: scoped.length, shown: shown.length };
  }

  function searchPath(q: string, mode: Mode): string {
    return `/records/search?q=${encodeURIComponent(q.trim())}&group=${encodeURIComponent(SERVER_GROUP[mode])}`;
  }

  // The server search's non-marker hits (ClientRecordsSearchRead, src/contracts/health-records.ts):
  // every section's `hits`, keeping documents, visit notes and body readings. Markers stay
  // with the local catalog, which already narrows them on every keystroke.
  function otherItem(hit: SearchHit): Other | null {
    if (!hit || typeof hit !== "object") return null;
    if (hit.type === "document" || hit.type === "visit_note") {
      const title = String(hit.title || hit.kind_label || "").trim();
      if (!title) return null;
      const detail = String(hit.snippet || hit.summary || "").trim();
      const date = String(hit.date || "").slice(0, 10);
      return {
        kind: hit.type === "visit_note" ? "note" : "document",
        id: String(hit.doc_id ?? hit.id ?? ""),
        title,
        date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "",
        detail,
      };
    }
    if (hit.type === "body") {
      const title = String(hit.label || "").trim();
      if (!title) return null;
      const detail = hit.value != null ? `${String(hit.value)}${hit.unit ? ` ${String(hit.unit)}` : ""}` : "";
      const date = String(hit.date || "").slice(0, 10);
      return {
        kind: "body",
        id: String(hit.id ?? ""),
        title,
        date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "",
        detail,
      };
    }
    return null;
  }

  /** The non-marker hits, newest first; null when the response isn't a search result. */
  function otherItems(response: unknown): Other[] | null {
    if (!response || typeof response !== "object" || Array.isArray(response)) return null;
    const sections = (response as Partial<SearchRead>).sections;
    if (!Array.isArray(sections)) return null;
    const rows: Other[] = [];
    const seen = new Set<string>();
    for (const s of sections) {
      for (const hit of Array.isArray(s?.hits) ? s.hits : []) {
        const item = otherItem(hit);
        if (!item || seen.has(`${item.kind}:${item.id}`)) continue;
        seen.add(`${item.kind}:${item.id}`);
        rows.push(item);
      }
    }
    return rows.sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1)).slice(0, 30);
  }

  const CAIRN_RECORDS_SEARCH_MODEL = {
    MODES,
    SERVER_GROUP,
    isMode,
    normalizeQuery,
    matchesQuery,
    groupsFor,
    sectionsModel,
    searchPath,
    otherItems,
  };

  Object.assign(globalThis, { CairnRecordsSearchModel: CAIRN_RECORDS_SEARCH_MODEL });
}
