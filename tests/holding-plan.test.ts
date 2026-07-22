import assert from "node:assert/strict";
import test from "node:test";

import { validateHoldingPlanInput } from "../lib/holding-plan.ts";

test("normalizes a valid holding plan", () => {
  const result = validateHoldingPlanInput(" aapl ", {
    holdingReason: "  Services mix keeps expanding.  ",
    levels: [
      { id: "level-1", action: "add", priceCents: 19000, sizeNote: "20 股", triggerNote: "估值回落", sortOrder: 9 },
    ],
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.ticker, "AAPL");
  assert.equal(result.value.holdingReason, "Services mix keeps expanding.");
  assert.equal(result.value.levels[0].sortOrder, 0);
});

test("rejects empty reasons, invalid prices, and oversized level lists", () => {
  assert.equal(validateHoldingPlanInput("AAPL", { holdingReason: " ", levels: [] }).ok, false);
  assert.equal(validateHoldingPlanInput("AAPL", {
    holdingReason: "Reason", levels: [{ action: "add", priceCents: 0, sizeNote: "", triggerNote: "", sortOrder: 0 }],
  }).ok, false);
  assert.equal(validateHoldingPlanInput("AAPL", {
    holdingReason: "Reason",
    levels: Array.from({ length: 21 }, (_, index) => ({ action: "target" as const, priceCents: 20_000 + index, sizeNote: "", triggerNote: "", sortOrder: index })),
  }).ok, false);
});

