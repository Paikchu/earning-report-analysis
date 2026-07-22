import assert from "node:assert/strict";
import test from "node:test";

import { saveHoldingPlan } from "../lib/holding-plan-store.ts";

test("saves a plan and its replacement levels in one D1 batch", async () => {
  const batches: Array<Array<{ sql: string; values: unknown[] }>> = [];
  const database = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) { return { sql, values }; },
      };
    },
    async batch(statements: Array<{ sql: string; values: unknown[] }>) {
      batches.push(statements);
      return [];
    },
  };

  const plan = await saveHoldingPlan(database, "max@example.com", "Apple Inc.", {
    ticker: "AAPL",
    holdingReason: "Services mix keeps expanding.",
    levels: [{ id: "level-1", action: "add", priceCents: 19000, sizeNote: "20 股", triggerNote: "估值回落", sortOrder: 0 }],
  });

  assert.equal(batches.length, 1);
  assert.equal(batches[0].length, 3);
  assert.match(batches[0][0].sql, /ON CONFLICT\(owner_email, ticker\)/);
  assert.match(batches[0][1].sql, /DELETE FROM plan_levels/);
  assert.equal(plan.ticker, "AAPL");
  assert.equal(plan.levels[0].id, "level-1");
});

