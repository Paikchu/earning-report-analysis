import assert from "node:assert/strict";
import test from "node:test";

test("upserts one history point per Shanghai calendar day", async () => {
  const { upsertPortfolioHistory } = await import("../lib/portfolio-history.ts");
  const existing = [{
    date: "2026-07-21",
    generatedAt: "2026-07-20T23:30:00.000Z",
    netLiquidation: 64_000,
    netDeposits: 71_563.39,
  }];

  const result = upsertPortfolioHistory(existing, {
    generatedAt: "2026-07-21T01:30:00.000Z",
    netLiquidation: 65_000,
    netDeposits: 71_563.39,
  });

  assert.deepEqual(result, [{
    date: "2026-07-21",
    generatedAt: "2026-07-21T01:30:00.000Z",
    netLiquidation: 65_000,
    netDeposits: 71_563.39,
  }]);
});

test("sorts history and appends the next Shanghai calendar day", async () => {
  const { upsertPortfolioHistory } = await import("../lib/portfolio-history.ts");
  const result = upsertPortfolioHistory([{
    date: "2026-07-20",
    generatedAt: "2026-07-20T07:30:00.000Z",
    netLiquidation: 64_000,
    netDeposits: 71_563.39,
  }], {
    generatedAt: "2026-07-20T23:30:00.000Z",
    netLiquidation: 65_000,
    netDeposits: 71_563.39,
  });

  assert.deepEqual(result.map((point) => point.date), ["2026-07-20", "2026-07-21"]);
});

test("filters 1M, 3M, YTD, and ALL relative to the latest point", async () => {
  const { filterPortfolioHistory } = await import("../lib/portfolio-history.ts");
  const points = [
    ["2025-12-31", 50_000],
    ["2026-01-01", 51_000],
    ["2026-04-22", 52_000],
    ["2026-06-22", 53_000],
    ["2026-07-22", 54_000],
  ].map(([date, netLiquidation]) => ({
    date: String(date),
    generatedAt: `${date}T00:00:00.000Z`,
    netLiquidation: Number(netLiquidation),
    netDeposits: 50_000,
  }));

  assert.deepEqual(filterPortfolioHistory(points, "1M").map((point) => point.date), ["2026-06-22", "2026-07-22"]);
  assert.deepEqual(filterPortfolioHistory(points, "3M").map((point) => point.date), ["2026-04-22", "2026-06-22", "2026-07-22"]);
  assert.deepEqual(filterPortfolioHistory(points, "YTD").map((point) => point.date), ["2026-01-01", "2026-04-22", "2026-06-22", "2026-07-22"]);
  assert.equal(filterPortfolioHistory(points, "ALL").length, 5);
});
