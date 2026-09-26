// @ts-check
// records-search, the model (docs/V2-PLAN.md wave 3). Pure shaping from the marker
// catalog (GET /api/markers/priority: markers + the canonical `groups`, which the
// server lists in MARKER_GROUPS order) into the sections one grouping mode shows:
//   - "outrange": what the LAB flagged leads, then what sits outside its optimal band
//     (its own section, never folded into the flag), then every other marker by panel;
//   - "panel":    clinical panels in the server's MARKER_GROUPS order;
//   - "newest":   one section per draw date, newest first, panel order inside a date.
// Search narrows markers by name or panel. The server search (GET /api/records/search,
// Wave 3 stream A) reaches the records the catalog doesn't hold — documents, visit
// notes and body readings — through `searchPath`/`otherItems`, a small adapter that
// accepts either a flat `results[]` (each with a `kind`) or per-kind arrays, and
// returns null for anything else (a body that isn't a search result shows nothing).
{
  type Mode = ClientRecordsMode;
  type Marker = ClientRecordsMarker;
  type Group = { key: string; label: string };
  type Section = ClientRecordsSection;
  type Other = ClientRecordsOtherItem;

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

  const flagged = (m: Marker): boolean => !!CairnHealthMarkers.labFlagWord(m);
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
        ...(lab.length ? [section("lab-flagged", "Flagged by the lab", "flagged", null, lab)] : []),
        ...(opt.length ? [section("off-optimal", "Outside optimal", "optimal", null, opt)] : []),
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

  const KIND: Record<string, Other["kind"]> = {
    document: "document",
    documents: "document",
    doc: "document",
    note: "note",
    notes: "note",
    visit_note: "note",
    body: "body",
    body_reading: "body",
    reading: "body",
  };

  function otherItem(row: unknown, kindHint: string): Other | null {
    if (!row || typeof row !== "object") return null;
    const r = row as Record<string, unknown>;
    const kind = KIND[String(r.kind || kindHint || "")];
    if (!kind) return null; // markers (and anything unknown) stay with the local catalog
    const title = String(r.title || r.label || r.name || "").trim();
    if (!title) return null;
    const value = r.value != null && r.value !== "" ? `${String(r.value)}${r.unit ? ` ${String(r.unit)}` : ""}` : "";
    const detail = String(r.snippet || r.detail || r.summary || value || "").trim();
    const date = String(r.date || r.doc_date || "").slice(0, 10);
    const id = r.id ?? r.doc_id ?? r.record_id ?? "";
    return { kind, id: String(id), title, date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "", detail };
  }

  /** The non-marker hits, newest first; null when the response isn't a search result. */
  function otherItems(response: unknown): Other[] | null {
    if (!response || typeof response !== "object" || Array.isArray(response)) return null;
    const r = response as Record<string, unknown>;
    const rows: Array<Other | null> = [];
    let recognized = false;
    if (Array.isArray(r.results)) {
      recognized = true;
      for (const row of r.results) rows.push(otherItem(row, ""));
    }
    for (const key of ["documents", "notes", "body"]) {
      if (!Array.isArray(r[key])) continue;
      recognized = true;
      for (const row of r[key] as unknown[]) rows.push(otherItem(row, key));
    }
    if (!recognized) return null;
    return rows
      .filter((row): row is Other => !!row)
      .sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1))
      .slice(0, 30);
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
