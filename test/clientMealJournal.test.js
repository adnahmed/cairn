// The meal-plan journal's one reading of the plan list (meal-journal-client.ts, the lazy
// meals bundle): the week menu offers a fresh week only when it is an adequate draft asked
// for AFTER the kept week; an older or inadequate draft is history, never "fresh".
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadClientModule } from "./_dom.mjs";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function week({ id, status = "accepted", adequate = true, extra = {} }) {
  return {
    id,
    status,
    week_of: "2026-09-28",
    parsed: {
      daily_kcal: 2000,
      daily_protein_g: 150,
      days: (adequate ? DAYS : DAYS.slice(0, 2)).map((day) => ({
        day,
        meals: [
          { name: "Bowl", items: ["yogurt"], kcal: 1000, protein_g: 75 },
          { name: "Plate", items: ["salmon"], kcal: 1000, protein_g: 75 },
        ],
      })),
    },
    ...extra,
  };
}

function weeks(plans) {
  const win = loadClientModule(
    ["html-utils", "ui-components", "meal-row-client", "meal-plan-upcoming-client", "meal-plan-client", "meal-journal-client"],
    {
      globals: {
        art: () => "",
        artImg: () => "",
        stagger: () => "",
        skelLines: () => "",
        statusBadge: () => "",
        verifiedBadgeHtml: () => "",
      },
    }
  );
  const read = win.CairnMealJournal.weeks(plans);
  return {
    current: read.current?.id ?? null,
    upcoming: read.upcoming?.id ?? null,
    drafts: read.drafts.map((row) => row.id),
    past: read.past.map((row) => row.id),
  };
}

test("a draft asked for after the kept week is the fresh week to look over", () => {
  assert.deepEqual(weeks([week({ id: 3, status: "draft" }), week({ id: 2 }), week({ id: 1, status: "superseded" })]), {
    current: 2,
    upcoming: null,
    drafts: [3],
    past: [1],
  });
});

test("an older or inadequate draft beside the kept week is history, never fresh", () => {
  const read = weeks([
    week({ id: 5, status: "draft", adequate: false }),
    week({ id: 4 }),
    week({ id: 3, status: "draft" }),
  ]);
  assert.deepEqual(read.drafts, []);
  assert.deepEqual(read.past, [5, 3]);
});

test("with no kept week, the newest draft is current and the older draft waits in history", () => {
  assert.deepEqual(weeks([week({ id: 2, status: "draft" }), week({ id: 1, status: "draft" })]), {
    current: 2,
    upcoming: null,
    drafts: [],
    past: [1],
  });
});

test("a scheduled week is neither a fresh draft nor history", () => {
  const read = weeks([week({ id: 3, status: "draft", extra: { autonomy: { status: "announced" } } }), week({ id: 2 })]);
  assert.equal(read.upcoming, 3);
  assert.deepEqual(read.drafts, []);
  assert.deepEqual(read.past, []);
});
