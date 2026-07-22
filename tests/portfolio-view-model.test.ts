import assert from "node:assert/strict";
import test from "node:test";

import { buildPortfolioViewModel } from "../lib/portfolio-view-model.ts";
import type { PortfolioSnapshotV1 } from "../lib/portfolio-snapshot.ts";

const snapshot: PortfolioSnapshotV1 = {
  schemaVersion: 1,
  generatedAt: "2026-07-22T00:00:00.000Z",
  account: { currency: "USD", netLiquidation: 10_000, cashBalance: 1_000, netDeposits: 9_000 },
  positions: [
    {
      positionKey: "STK:1", symbol: "AAPL", contractDescription: "Apple Inc.", assetClass: "STK",
      quantity: 10, averagePrice: 180, marketPrice: 200, marketValue: 2_000, costBasis: 1_800, unrealizedPnl: 200,
    },
    {
      positionKey: "OPT:2", symbol: "AAPL", contractDescription: "AAPL 20260821 220 C", assetClass: "OPT",
      quantity: -1, averagePrice: 4, marketPrice: 3, marketValue: -300, costBasis: -400, unrealizedPnl: 100,
    },
  ],
  trades: [
    {
      tradeId: "t1", tradeTime: "2026-06-01T00:00:00.000Z", symbol: "AAPL", contractDescription: "Apple Inc.",
      securityType: "STK", side: "SELL", size: 1, price: 190, commission: 0, netAmount: 190,
      realizedPnl: 25, exchange: "NASDAQ", orderId: "1",
    },
  ],
  tradeSync: { status: "current", queryPeriod: "YEAR_TO_DATE", lastSuccessfulTradeAt: null, message: null },
};

test("groups stock and option legs into one ticker view model", () => {
  const model = buildPortfolioViewModel(snapshot);

  assert.equal(model.positionGroups.length, 1);
  assert.equal(model.positionGroups[0].symbol, "AAPL");
  assert.equal(model.positionGroups[0].value, 1_700);
  assert.equal(model.positionGroups[0].unrealized, 300);
  assert.equal(model.positionGroups[0].realized, 25);
  assert.equal(model.positionGroups[0].stock?.actualCost, 177.5);
  assert.equal(model.stockMarketValue, 2_000);
  assert.equal(model.optionMarketValue, -300);
});

