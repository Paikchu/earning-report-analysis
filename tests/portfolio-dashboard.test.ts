import assert from "node:assert/strict";
import test from "node:test";

import type { PositionGroupView } from "../lib/portfolio-view-model.ts";

const group = (symbol: string, weight: number, value = weight * 100): PositionGroupView => ({
  symbol,
  name: symbol,
  options: [],
  value,
  cost: value,
  unrealized: 0,
  realized: 0,
  netPnl: 0,
  weight,
  grossValue: Math.abs(value),
});

test("assigns a stable non-semantic holding color from the ticker", async () => {
  const { holdingColor } = await import("../lib/portfolio-dashboard.ts");

  assert.equal(holdingColor("NVDA"), holdingColor("nvda"));
  assert.notEqual(holdingColor("NVDA"), holdingColor("MSFT"));
  assert.doesNotMatch(holdingColor("NVDA"), /#c94b31|#667763/i);
});

test("builds four leading allocations and a residual other segment", async () => {
  const { buildAllocation } = await import("../lib/portfolio-dashboard.ts");
  const allocation = buildAllocation([
    group("BOXX", 31.79),
    group("MSFT", 23.84),
    group("NVDA", 9.18),
    group("TSLA", 8.56),
    group("DRAM", 6.31),
    group("INTC", -0.82),
  ]);

  assert.deepEqual(allocation.leading.map((item) => item.symbol), ["BOXX", "MSFT", "NVDA", "TSLA"]);
  assert.equal(allocation.leadingWeight, 73.37);
  assert.equal(allocation.otherWeight, 26.63);
  assert.deepEqual(allocation.other.map((item) => item.symbol), ["DRAM", "INTC"]);
});

test("sorts ledger rows by net weight descending by default", async () => {
  const { sortPositionGroups } = await import("../lib/portfolio-dashboard.ts");
  const groups = [group("LOW", -1), group("MID", 5), group("HIGH", 12)];

  assert.deepEqual(sortPositionGroups(groups).map((item) => item.symbol), ["HIGH", "MID", "LOW"]);
  assert.deepEqual(sortPositionGroups(groups, "symbol", "asc").map((item) => item.symbol), ["HIGH", "LOW", "MID"]);
  assert.deepEqual(sortPositionGroups(groups, "value", "asc").map((item) => item.symbol), ["LOW", "MID", "HIGH"]);
});

test("detects groups that contain a short option leg", async () => {
  const { hasShortOption } = await import("../lib/portfolio-dashboard.ts");
  const position = group("NVDA", 10);
  position.options = [{
    symbol: "NVDA",
    contract: "NVDA 20260821 220 C",
    quantity: -1,
    averageCost: 4,
    price: 3,
    cost: -400,
    marketValue: -300,
    weight: -3,
    unrealized: 100,
  }];

  assert.equal(hasShortOption(position), true);
  assert.equal(hasShortOption(group("MSFT", 20)), false);
});
