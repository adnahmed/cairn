import { z } from "zod";
import {
  acknowledgeTodayAgendaCandidate,
  learnedTimeline,
  listVisibleInsights,
  teamWeekRead,
  todayAgenda,
  updateInsight,
} from "../../domain/brain/index.js";
import { allGuidelines, guidelineFor } from "../../domain/health/index.js";
import { addMemory } from "../../domain/person/index.js";
import { dayRecord, dayRecordDate, overnightDigest, todayStones } from "../../domain/today/index.js";
import { todayPath } from "../../repo/today-path.js";
import { deriveInsightIntentKey, splitInsightIntentKey } from "../../repo/insight-intent.js";
import { recordDismissal } from "../../repo/surface-dismissals.js";
import { asText, type McpToolRegistrar } from "./shared.js";
import { queueMcpAgentJob } from "./background.js";

export function registerDailyDriverTools(server: McpToolRegistrar) {
  server.tool(
    "get_today_agenda",
    "The Today salience arbiter (Era 2): ONE deterministic ranking + budget pass over the whole Today surface → { hero, primary[], more[], total }, so only the 1-2 things that matter most today surface inline and the rest collapse behind 'more'. Internal priorities never cross to the user. Pass `date` (YYYY-MM-DD; defaults to today).",
    { date: z.string().optional() },
    // Read-only w.r.t. the surprise budget: an agent's tool call must never spend
    // the day's introduction allowance on a card no human saw.
    async ({ date }) => asText(todayAgenda(date, { markIntroduced: false }))
  );

  server.tool(
    "get_today_stones",
    "The six stones on Today (Strength, Endurance, Fuel, Recovery, Body, Heart) → { date, stones:[{key,label,word,tone,line,target:{tab,section}}] }, always six in that order. Each `word` is one or two plain words the server projects from the five signal dimensions and the domain reads (today's lift, the race build, today's intake, the weight trend, the lab read); `tone` is ok | watch | quiet; `line` is one athlete-facing sentence or null. A stone with no fresh signal reads \"quiet\" — never low; a partial intake day reads \"in progress\". No scores. Pure read, mirrors GET /api/today/stones. Pass `date` (YYYY-MM-DD; defaults to today).",
    { date: z.string().optional() },
    async ({ date }) => asText(todayStones(date))
  );

  server.tool(
    "get_today_path",
    "The path under Today's Brief → { as_of, trail_start, race:{event,distance_label,date,days_to_race,estimate_sec,target_sec,target_raw,trend_delta_sec,since,fit}|null, weight:{mode,current_lb,current_date,goal_lb,goal_date,trend_lb_wk,needed_lb_wk,points[]}|null, anchor:{exercise,est_1rm,target_est_1rm,lb_per_week,projection_weeks}|null, milestones:[{date,end_date,label,kind,detail}], lever:{text,kind}|null, focus, board:[{key,id,label,start_text,now_text,goal_text,progress,reached,note,direction}], week:{km_planned,km_logged,long_km,phase}|null }. Composed from the race build, goal pace, the strength journeys, the next-checkup read and the attention schedule; re-derives none of them. The race estimate against its target is a fit word (fits/stretch/beyond_horizon); every number is a real measure in its unit, never a score. Pure read, mirrors GET /api/today-path. Pass `date` (YYYY-MM-DD; defaults to today).",
    { date: z.string().optional() },
    async ({ date }) => asText(todayPath(date))
  );

  server.tool(
    "get_today_digest",
    "What the team changed lately, one lift per row → { as_of, when, headline, changes:[{id,state,title,status_line,moves:[{exercise,direction,from_text,to_text,reason}],undo:{available,label},new}] }. A projection over the Changes feed: titles, timing words and Undo are the feed's own; each move reads the change's recorded before → after (an announced change reads the live plan as its before). Held drafts the team set aside are not here; get_brain_changes lists them under `set_aside`. Undo posts the change `id` to revert_brain_decision. Pure read, mirrors GET /api/today-digest. Pass `date` (YYYY-MM-DD; defaults to today).",
    { date: z.string().optional() },
    async ({ date }) => asText(overnightDigest(date))
  );

  server.tool(
    "get_day_record",
    "Any day that is not today, read-only → { date, relation: past|today|future, today, run_units, session, activities[], intake, read, weight_lb, lift, run, rest, caveats[], line }. A PAST day is its record: the logged strength session (title, sets, each movement's top set, skips, notes), the runs/rides, a food summary whose nutrient sums appear only when every entry carried them (`coverage` none|partial|complete — absent is absent, never low), a weigh-in, and the day read that stood. A FUTURE day is its preview: the planned lift (plan-day name/focus), the planned run (kind, label, the engine's km), `rest` when neither, and the life-context events active that day as `caveats`. Distances are km; `run_units` is the athlete's display unit. No scores. Pure read, mirrors GET /api/day-record. `date` is required (YYYY-MM-DD).",
    { date: z.string() },
    async ({ date }) => {
      const day = dayRecordDate(date);
      return asText(day ? dayRecord(day) : { error: "date (YYYY-MM-DD) required" });
    }
  );

  server.tool(
    "ack_today_agenda",
    "Presentation acknowledgement for a Today-agenda attention item: 'health-focus' retires the current semantic revision WITHOUT resolving or dismissing its underlying health directives; 'fast-loss-attention' retires the current cut-quality episode for 14 days, then allows it to resurface if still active. Materially new evidence may create a new revision sooner. Mirrors POST /api/today-agenda/ack.",
    {
      id: z
        .enum(["health-focus", "fast-loss-attention"])
        .describe("acknowledgement-aware agenda id: 'health-focus' or 'fast-loss-attention'"),
      revision: z
        .string()
        .optional()
        .describe(
          "the revision shown to the user, e.g. a health evidence hash or cut-quality episode hash; omitted = acknowledge whatever is current"
        ),
    },
    async ({ id, revision }) => asText(acknowledgeTodayAgendaCandidate(id, revision ?? null))
  );

  server.tool(
    "get_team_week",
    "The team's-week digest: a calm, deterministic read over the last 7 days of what your expert team DID (applied/announced ledger decisions, with the specialist voice when stored), what it FLAGGED for you, what it's WATCHING, how earlier calls LANDED (in words), and the connections it surfaced. Read-only here — it never drains the insight backlog (the app's weekly card does that).",
    {},
    async () => asText(teamWeekRead({ drainBacklog: false }))
  );

  server.tool(
    "get_learned_timeline",
    "A calm read of what Cairn has understood about you and the changes it's made — load-bearing memories, outcome learnings, connected-brain directives, and applied plan changes. Newest-first, bounded.",
    { limit: z.number().int().positive().max(200).optional() },
    async ({ limit }) => asText(learnedTimeline({ limit }))
  );

  server.tool(
    "get_guidelines",
    "Trusted clinical-guideline statements (offline, recognized bodies — AHA/ACC, Endocrine Society, KDIGO…) for a marker/topic, or the whole pack. Grounds the connected brain's directive notes with a citation even with research disabled.",
    { marker: z.string().optional() },
    async ({ marker }) =>
      asText(marker && marker.trim() ? { marker, guideline: guidelineFor(marker) } : { guidelines: allGuidelines() })
  );

  server.tool(
    "list_insights",
    "List the live stream of quiet cross-domain insights (new + seen, most recent first). The Brief surfaces ONE at a time when the app is opened; dismissed insights are hidden here but remain in the DB/exports.",
    { limit: z.number().int().optional() },
    async ({ limit }) => asText(listVisibleInsights(limit ?? 20))
  );

  server.tool(
    "generate_insight",
    "Queue one durable whole-picture pass for a genuine connection or weekly read. Returns a job immediately; poll get_agent_job. A valid insight is deduped and waits in-app without a notification.",
    {
      kind: z
        .enum(["connection", "weekly_read"])
        .optional()
        .describe(
          "'connection' (default) = one cross-domain link; 'weekly_read' = the standing how-the-week-went read"
        ),
      agent: z.string().optional().describe("omit or 'auto' to use the configured rotation"),
    },
    async ({ kind, agent }) => asText(queueMcpAgentJob(kind === "weekly_read" ? "weekly_read" : "insight", {}, agent))
  );

  server.tool(
    "update_insight",
    "Mark an insight seen/dismissed and/or record thumbs feedback (up|down) by id. On feedback:'up' the insight text is also written to memory so the relationship learns which connections land. A dismissal is weaker than a thumbs-down: it records repetition-gated evidence against that insight's intent, so similar connections resurface less often, but it does not mark the pattern wrong.",
    {
      id: z.number().int().describe("the insight's id"),
      status: z
        .enum(["new", "seen", "dismissed"])
        .optional()
        .describe(
          "'seen' just marks it read; 'dismissed' additionally records repetition-gated evidence against this insight's intent so similar connections resurface less often — weaker than feedback:'down', and it never marks the pattern wrong. Omit to leave status unchanged"
        ),
      feedback: z
        .enum(["up", "down"])
        .optional()
        .describe("thumbs up/down; 'up' also writes the insight text to memory so the relationship learns which connections land"),
    },
    async ({ id, status, feedback }) => {
      const updated = updateInsight(id, { status, feedback }) as any;
      if (!updated) return asText({ error: "not found", id });
      if (feedback === "up") {
        const text = String(updated.text ?? "").trim();
        if (text) addMemory(text, "insight", "insight-feedback");
      }
      // Mirrors PUT /api/insights/:id: a dismiss is weaker than a thumbs-down, so
      // it only enters the repetition-gated dismissal evidence stream, and only
      // when the insight has a resolvable intent key (stored, else derived).
      if (status === "dismissed") {
        const stored = splitInsightIntentKey(updated.intent_key) ? String(updated.intent_key).trim() : null;
        const key = stored ?? deriveInsightIntentKey(updated.text, updated.rationale);
        if (key) recordDismissal("insight", key);
      }
      return asText(updated);
    }
  );
}
