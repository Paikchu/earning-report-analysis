import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { PortfolioSnapshotV1 } from "../lib/portfolio-snapshot.ts";

const snapshot = JSON.parse(
  await readFile(new URL("../data/portfolio-snapshot.json", import.meta.url), "utf8"),
) as PortfolioSnapshotV1;

const acceptanceSnapshot: PortfolioSnapshotV1 = {
  schemaVersion: 1,
  generatedAt: "2026-07-22T00:00:00.000Z",
  account: { currency: "USD", netLiquidation: 10_000, cashBalance: 0, netDeposits: 10_000 },
  positions: [
    ["BOXX", 3_179, "STK"], ["MSFT", 2_384, "STK"], ["NVDA", 1_087, "STK"],
    ["TSLA", 856, "STK"], ["DRAM", 631, "STK"], ["ORCL", 577, "STK"],
    ["AVGO", 405, "STK"], ["RKLB", 168, "STK"], ["NOK", 332, "STK"],
    ["NOW", 305, "STK"], ["MRVL", 160, "STK"], ["MSTR", 107, "STK"],
    ["SPCX", 94, "STK"], ["INTC", -82, "OPT"],
  ].map(([symbol, marketValue, assetClass], index) => ({
    positionKey: `${assetClass}:${symbol}`,
    symbol: String(symbol),
    contractDescription: String(symbol),
    assetClass: assetClass as "STK" | "OPT",
    quantity: assetClass === "OPT" ? -1 : 1,
    averagePrice: Math.abs(Number(marketValue)),
    marketPrice: Math.abs(Number(marketValue)),
    marketValue: Number(marketValue),
    costBasis: Number(marketValue),
    unrealizedPnl: index % 2 === 0 ? 10 : -10,
  })),
  trades: [{
    tradeId: "nvda-stock",
    tradeTime: "2026-07-22T00:00:00.000Z",
    symbol: "NVDA",
    contractDescription: "NVIDIA CORP",
    securityType: "STK",
    side: "BUY",
    size: 1,
    price: 1_087,
    commission: 0,
    netAmount: -1_087,
    realizedPnl: 0,
    exchange: "SMART",
    orderId: "1",
  }],
  tradeSync: { status: "current", queryPeriod: "DAYS_7", lastSuccessfulTradeAt: "2026-07-22T00:00:00.000Z", message: null },
};

test("builds the heatmap from stock and ETF positions only", async () => {
  let heatmapModule: typeof import("../lib/portfolio-heatmap.ts");
  try {
    heatmapModule = await import("../lib/portfolio-heatmap.ts");
  } catch {
    assert.fail("portfolio heatmap module is required");
  }

  const holdings = heatmapModule.buildHeatmapHoldings(snapshot);
  const nvda = holdings.find((holding) => holding.symbol === "NVDA");
  const rklb = holdings.find((holding) => holding.symbol === "RKLB");

  assert.ok(nvda);
  assert.ok(rklb);
  assert.equal(nvda.company, "NVIDIA CORP");
  assert.equal(nvda.portfolioWeight, snapshot.positions.find((position) => position.symbol === "NVDA" && position.assetClass === "STK")!.marketValue / snapshot.account.netLiquidation * 100);
  assert.equal(rklb.portfolioWeight, snapshot.positions.find((position) => position.symbol === "RKLB" && position.assetClass === "STK")!.marketValue / snapshot.account.netLiquidation * 100);
  assert.equal(holdings.some((holding) => holding.symbol === "INTC"), false);
  assert.equal(holdings.length, snapshot.positions.filter((position) => position.assetClass === "STK").length);
});

test("matches the approved heatmap acceptance weights", async () => {
  const { buildHeatmapHoldings } = await import("../lib/portfolio-heatmap.ts");
  const holdings = buildHeatmapHoldings(acceptanceSnapshot);

  assert.equal(Number(holdings.find((holding) => holding.symbol === "NVDA")?.portfolioWeight.toFixed(2)), 10.87);
  assert.equal(Number(holdings.find((holding) => holding.symbol === "RKLB")?.portfolioWeight.toFixed(2)), 1.68);
  assert.equal(holdings.some((holding) => holding.symbol === "INTC"), false);
  assert.equal(Number(holdings.reduce((sum, holding) => sum + holding.portfolioWeight, 0).toFixed(2)), 102.85);
});

test("groups holdings into the approved investment themes", async () => {
  const { buildHeatmapHoldings, groupHeatmapHoldings } = await import("../lib/portfolio-heatmap.ts");
  const groups = groupHeatmapHoldings(buildHeatmapHoldings(acceptanceSnapshot));
  const totals = Object.fromEntries(groups.map((group) => [group.domain, Number(group.portfolioWeight.toFixed(2))]));

  assert.deepEqual(totals, {
    "AI / 企业软件": 32.66,
    "现金管理": 31.79,
    "半导体": 22.83,
    "智能汽车": 8.56,
    "太空与通信": 5.94,
    "数字资产": 1.07,
  });
});

test("uses other for unknown symbols and neutral performance for zero cost", async () => {
  const { buildHeatmapHoldings } = await import("../lib/portfolio-heatmap.ts");
  const fixture: PortfolioSnapshotV1 = {
    ...snapshot,
    positions: [{
      positionKey: "STK:NEW",
      symbol: "NEW",
      contractDescription: "NEW COMPANY",
      assetClass: "STK",
      quantity: 1,
      averagePrice: 0,
      marketPrice: 10,
      marketValue: 10,
      costBasis: 0,
      unrealizedPnl: 10,
    }],
  };

  assert.deepEqual(buildHeatmapHoldings(fixture)[0], {
    symbol: "NEW",
    company: "NEW COMPANY",
    domain: "其他",
    marketValue: 10,
    portfolioWeight: 10 / snapshot.account.netLiquidation * 100,
    costBasis: 0,
    unrealizedPnl: 10,
    unrealizedRate: 0,
  });
});

test("lays out weighted rectangles inside their parent without overlap", async () => {
  const { layoutTreemap } = await import("../lib/portfolio-heatmap.ts");
  const rectangles = layoutTreemap([
    { id: "a", weight: 6 },
    { id: "b", weight: 3 },
    { id: "c", weight: 1 },
  ]);

  assert.equal(rectangles.length, 3);
  assert.ok(rectangles.every((rect) => rect.x >= 0 && rect.y >= 0 && rect.width > 0 && rect.height > 0));
  assert.ok(rectangles.every((rect) => rect.x + rect.width <= 100.000001 && rect.y + rect.height <= 100.000001));
  assert.deepEqual(rectangles.map((rect) => Number((rect.width * rect.height).toFixed(2))), [6000, 3000, 1000]);

  for (let index = 0; index < rectangles.length; index += 1) {
    for (let other = index + 1; other < rectangles.length; other += 1) {
      const left = rectangles[index];
      const right = rectangles[other];
      const overlapWidth = Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x);
      const overlapHeight = Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y);
      assert.ok(overlapWidth <= 0 || overlapHeight <= 0);
    }
  }
});

test("uses the rendered aspect ratio when laying out narrow screens", async () => {
  const { buildHeatmapHoldings, groupHeatmapHoldings, layoutTreemap } = await import("../lib/portfolio-heatmap.ts");
  const groups = groupHeatmapHoldings(buildHeatmapHoldings(acceptanceSnapshot));
  const rectangles = layoutTreemap(groups.map((group) => ({ id: group.domain, weight: group.portfolioWeight })), 296, 380);
  const digitalAssets = rectangles.find((rectangle) => rectangle.id === "数字资产");

  assert.ok(digitalAssets);
  assert.ok(Math.min(digitalAssets.width, digitalAssets.height) >= 24);
  assert.equal(Number(rectangles.reduce((sum, rectangle) => sum + rectangle.width * rectangle.height, 0).toFixed(2)), 112_480);
});
