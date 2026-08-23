import assert from "node:assert/strict";
import test from "node:test";

import type { PortfolioSnapshotV1 } from "../lib/portfolio-snapshot.ts";

const structuralSnapshot: PortfolioSnapshotV1 = {
  schemaVersion: 1,
  generatedAt: "2026-07-22T00:00:00.000Z",
  account: { currency: "USD", netLiquidation: 1_000, cashBalance: 400, netDeposits: 1_000 },
  positions: [
    {
      positionKey: "STK:TEST_A",
      symbol: "TEST_A",
      contractDescription: "Test A",
      assetClass: "STK",
      quantity: 4,
      averagePrice: 75,
      marketPrice: 100,
      marketValue: 400,
      costBasis: 300,
      unrealizedPnl: 100,
    },
    {
      positionKey: "STK:TEST_B",
      symbol: "TEST_B",
      contractDescription: "Test B ETF",
      assetClass: "STK",
      quantity: 5,
      averagePrice: 50,
      marketPrice: 50,
      marketValue: 250,
      costBasis: 250,
      unrealizedPnl: 0,
    },
    {
      positionKey: "OPT:TEST_OPTION",
      symbol: "TEST_OPTION",
      contractDescription: "Test option",
      assetClass: "OPT",
      quantity: -1,
      averagePrice: 50,
      marketPrice: 50,
      marketValue: -50,
      costBasis: -50,
      unrealizedPnl: 0,
    },
  ],
  trades: [{
    tradeId: "test-a-stock",
    tradeTime: "2026-07-22T00:00:00.000Z",
    symbol: "TEST_A",
    contractDescription: "Test A Company",
    securityType: "STK",
    side: "BUY",
    size: 1,
    price: 75,
    commission: 0,
    netAmount: -75,
    realizedPnl: 0,
    exchange: "TEST",
    orderId: "1",
  }],
  tradeSync: { status: "current", queryPeriod: "DAYS_7", lastSuccessfulTradeAt: "2026-07-22T00:00:00.000Z", message: null },
};

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

  const holdings = heatmapModule.buildHeatmapHoldings(structuralSnapshot);
  const includedPositions = structuralSnapshot.positions.filter(
    (position) => position.assetClass === "STK" && position.marketValue > 0,
  );

  assert.deepEqual(holdings.map((holding) => holding.symbol), includedPositions.map((position) => position.symbol));
  assert.equal(holdings[0].company, structuralSnapshot.trades[0].contractDescription);
  for (const [index, position] of includedPositions.entries()) {
    assert.equal(holdings[index].portfolioWeight, position.marketValue / structuralSnapshot.account.netLiquidation * 100);
  }
  assert.equal(holdings.some((holding) => holding.symbol === structuralSnapshot.positions[2].symbol), false);
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

test("assigns one vivid terminal color to every investment theme", async () => {
  const { heatmapDomainColor, heatmapThemeColor } = await import("../lib/portfolio-heatmap.ts");

  assert.equal(heatmapThemeColor("BOXX"), "#52718f");
  assert.equal(heatmapThemeColor("MSFT"), "#2e6fdb");
  assert.equal(heatmapThemeColor("NOW"), heatmapThemeColor("MSFT"));
  assert.equal(heatmapThemeColor("NVDA"), "#d27a1d");
  assert.equal(heatmapThemeColor("TSLA"), "#c45235");
  assert.equal(heatmapThemeColor("RKLB"), "#16888e");
  assert.equal(heatmapThemeColor("MSTR"), "#7654c6");
  assert.equal(heatmapThemeColor("UNKNOWN"), heatmapDomainColor("其他"));
});

test("uses other for unknown symbols and neutral performance for zero cost", async () => {
  const { buildHeatmapHoldings } = await import("../lib/portfolio-heatmap.ts");
  const fixture: PortfolioSnapshotV1 = {
    ...structuralSnapshot,
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
    portfolioWeight: 10 / structuralSnapshot.account.netLiquidation * 100,
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

test("prioritizes ticker symbols in the smallest heatmap tiles", async () => {
  const { heatmapTileDensity } = await import("../lib/portfolio-heatmap.ts");

  assert.equal(heatmapTileDensity(21.9, 45.2), "symbol-only");
  assert.equal(heatmapTileDensity(25.1, 45.2), "symbol-only");
  assert.equal(heatmapTileDensity(94.3, 27.9), "symbol-only");
  assert.equal(heatmapTileDensity(39.2, 45.2), "compact");
  assert.equal(heatmapTileDensity(119.2, 103.6), "full");
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

test("keeps a readable theme label for compact and narrow domains", async () => {
  const heatmapModule = await import("../lib/portfolio-heatmap.ts");
  const domainDensity = (heatmapModule as typeof heatmapModule & {
    heatmapDomainDensity?: (width: number, height: number) => "full" | "compact" | "narrow";
  }).heatmapDomainDensity;

  assert.equal(typeof domainDensity, "function");
  assert.equal(domainDensity!(120, 100), "full");
  assert.equal(domainDensity!(120, 48), "compact");
  assert.equal(domainDensity!(32, 100), "narrow");
  assert.equal(domainDensity!(32, 30), "narrow");
});

test("creates visible spacing between investment-theme rectangles", async () => {
  const heatmapModule = await import("../lib/portfolio-heatmap.ts");
  const insetRectangle = (heatmapModule as typeof heatmapModule & {
    insetTreemapRectangle?: <T extends { id: string; weight: number; x: number; y: number; width: number; height: number }>(
      rectangle: T,
      gap?: number,
    ) => T;
  }).insetTreemapRectangle;

  assert.equal(typeof insetRectangle, "function");
  assert.deepEqual(insetRectangle!({ id: "theme", weight: 1, x: 0, y: 0, width: 100, height: 50 }, 6), {
    id: "theme",
    weight: 1,
    x: 3,
    y: 3,
    width: 94,
    height: 44,
  });
});

test("uses a deeper perceptual heat scale with distinct loss levels", async () => {
  const heatmapModule = await import("../lib/portfolio-heatmap.ts");
  const colorStrength = (heatmapModule as typeof heatmapModule & {
    heatmapColorStrength?: (rate: number) => number;
  }).heatmapColorStrength;

  assert.equal(typeof colorStrength, "function");
  assert.equal(colorStrength!(0), 0);
  assert.ok(colorStrength!(-0.68) >= 18);
  assert.ok(colorStrength!(-16.68) - colorStrength!(-11.22) >= 14);
  assert.equal(colorStrength!(-25), 88);
  assert.equal(colorStrength!(-100), 88);
});

test("keeps every stock in exactly one investment theme, including sub-1% holdings", async () => {
  const { buildHeatmapHoldings, groupHeatmapHoldings } = await import("../lib/portfolio-heatmap.ts");
  const holdings = buildHeatmapHoldings(acceptanceSnapshot);
  const groupedHoldings = groupHeatmapHoldings(holdings).flatMap((group) => group.holdings);

  assert.equal(groupedHoldings.length, holdings.length);
  assert.deepEqual(
    groupedHoldings.map((holding) => holding.symbol).sort(),
    holdings.map((holding) => holding.symbol).sort(),
  );
  assert.ok(groupedHoldings.some((holding) => holding.symbol === "SPCX" && holding.portfolioWeight < 1));
  assert.ok(groupedHoldings.every((holding) => holding.domain.length > 0));
});

test("keeps the floating detail window inside the plot after resize", async () => {
  const heatmapModule = await import("../lib/portfolio-heatmap.ts");
  const calculatePosition = (heatmapModule as typeof heatmapModule & {
    calculatePopoverPosition?: (
      plot: { left: number; top: number; width: number; height: number },
      tile: { left: number; top: number; width: number; height: number },
    ) => { left: number; top: number };
  }).calculatePopoverPosition;

  assert.equal(typeof calculatePosition, "function");
  const position = calculatePosition!(
    { left: 0, top: 0, width: 296, height: 380 },
    { left: 270, top: 340, width: 24, height: 38 },
  );

  assert.ok(position.left >= 8 && position.left + 236 <= 288);
  assert.ok(position.top >= 8 && position.top + 132 <= 372);

  const adjacent = calculatePosition!(
    { left: 0, top: 0, width: 800, height: 470 },
    { left: 50, top: 80, width: 60, height: 100 },
  );
  assert.equal(adjacent.left, 110);
});
