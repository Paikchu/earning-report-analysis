import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPortfolioSnapshot,
  mergeTrades,
  normalizeIbkrPosition,
  normalizeIbkrTrade,
  realizedPnlByUnderlying,
  selectTradeQueryPeriod,
  type PortfolioSnapshotV1,
  type PortfolioTrade,
} from "../lib/portfolio-snapshot.ts";

const trade = (overrides: Partial<PortfolioTrade> = {}): PortfolioTrade => ({
  tradeId: "trade-1",
  tradeTime: "2026-07-13T20:30:00.000Z",
  symbol: "NOK",
  contractDescription: "NOK Jul 24 '26 16 Call",
  securityType: "OPT",
  side: "BUY",
  size: 1,
  price: 0.12,
  commission: -0.65,
  netAmount: -12.65,
  realizedPnl: 83.91,
  exchange: "SMART",
  orderId: "order-1",
  ...overrides,
});

const previous: PortfolioSnapshotV1 = {
  schemaVersion: 1,
  generatedAt: "2026-07-19T23:30:00.000Z",
  account: {
    currency: "USD",
    netLiquidation: 67_119.06,
    cashBalance: 1_291.46,
    netDeposits: 71_563.39,
  },
  positions: [
    {
      positionKey: "STK:NOK",
      symbol: "NOK",
      contractDescription: "NOK",
      assetClass: "STK",
      quantity: 200,
      averagePrice: 14.7,
      marketPrice: 10.12,
      marketValue: 2_024,
      costBasis: 2_940,
      unrealizedPnl: -916,
    },
  ],
  trades: [trade()],
  tradeSync: {
    status: "current",
    queryPeriod: "DAYS_7",
    lastSuccessfulTradeAt: "2026-07-13T20:30:00.000Z",
    message: null,
  },
};

test("selects the smallest trade window that covers the sync gap", () => {
  const now = "2026-07-20T00:00:00.000Z";
  assert.equal(selectTradeQueryPeriod("2026-07-14T00:00:00.000Z", now), "DAYS_7");
  assert.equal(selectTradeQueryPeriod("2026-06-25T00:00:00.000Z", now), "DAYS_30");
  assert.equal(selectTradeQueryPeriod("2026-05-25T00:00:00.000Z", now), "DAYS_60");
  assert.equal(selectTradeQueryPeriod("2026-04-25T00:00:00.000Z", now), "DAYS_90");
  assert.equal(selectTradeQueryPeriod("2026-01-01T00:00:00.000Z", now), "YEAR_TO_DATE");
  assert.equal(selectTradeQueryPeriod(null, now), "YEAR_TO_DATE");
});

test("upserts overlapping trades by tradeId and keeps the corrected value", () => {
  const merged = mergeTrades(
    [trade({ realizedPnl: 80 })],
    [trade({ realizedPnl: 83.91 }), trade({ tradeId: "trade-2", tradeTime: "2026-07-14T20:00:00.000Z" })],
    2026,
  );

  assert.equal(merged.length, 2);
  assert.equal(merged.find((item) => item.tradeId === "trade-1")?.realizedPnl, 83.91);
  assert.equal(merged[0].tradeId, "trade-2");
});

test("aggregates stock and option realized PnL by canonical underlying", () => {
  const totals = realizedPnlByUnderlying([
    trade(),
    trade({ tradeId: "trade-2", securityType: "STK", symbol: "NASDAQ:NOK", realizedPnl: 18.38 }),
    trade({ tradeId: "trade-3", securityType: "FX", symbol: "USD.CNH", realizedPnl: 500 }),
    trade({ tradeId: "trade-4", tradeTime: "2025-12-31T23:59:00.000Z", realizedPnl: 999 }),
  ], 2026);

  assert.deepEqual(totals, { NOK: 102.29 });
});

test("normalizes IBKR stock and short option positions", () => {
  const stock = normalizeIbkrPosition({
    asset_class: "STK",
    contract_id: 661513,
    contract_description: "NOK",
    currency: "USD",
    position: 200,
    average_price: 14.7011045,
    market_price: 10.17,
    market_value: 2034,
    unrealized_pnl: -906.22,
  });
  const option = normalizeIbkrPosition({
    asset_class: "OPT",
    contract_id: 845712739,
    contract_description: "INTC Nov20'26 70 PUT @AMEX",
    currency: "USD",
    position: -1,
    average_price: 5.489521,
    market_price: 7.15063,
    market_value: -715.063,
    unrealized_pnl: -166.1109,
  });

  assert.equal(stock.positionKey, "STK:661513");
  assert.equal(stock.costBasis, 2940.2209);
  assert.equal(option.symbol, "INTC");
  assert.equal(option.positionKey, "OPT:845712739");
  assert.equal(option.costBasis, -548.9521);
});

test("normalizes IBKR trades without treating order descriptions as contracts", () => {
  const normalized = normalizeIbkrTrade({
    trade_id: "00017b88.6a58e165.01.01",
    symbol: "ORCL",
    company_name: "ORACLE CORP",
    sec_type: "STK",
    side: "BUY",
    size: 1,
    price: 126.86,
    commission: 0.000203,
    net_amount: 126.86,
    realized_pnl: 0,
    trade_time: "2026-07-16T15:30:39Z",
    exchange: "IBKRATS",
    order_id: 1923609147,
    description: "126.86 Limit, Day",
  });

  assert.equal(normalized.tradeId, "00017b88.6a58e165.01.01");
  assert.equal(normalized.contractDescription, "ORACLE CORP");
  assert.equal(normalized.tradeTime, "2026-07-16T15:30:39.000Z");
  assert.equal(normalized.orderId, "1923609147");
});

test("keeps prior trades and watermark when the trade endpoint is delayed", () => {
  const next = buildPortfolioSnapshot(previous, {
    generatedAt: "2026-07-20T23:30:00.000Z",
    account: { netLiquidation: 68_000, cashBalance: 1_500 },
    positions: previous.positions,
    tradeSync: { status: "delayed", queryPeriod: "DAYS_7", message: "IBKR trades unavailable" },
  });

  assert.equal(next.account.netLiquidation, 68_000);
  assert.deepEqual(next.trades, previous.trades);
  assert.equal(next.tradeSync.lastSuccessfulTradeAt, previous.tradeSync.lastSuccessfulTradeAt);
  assert.equal(next.tradeSync.status, "delayed");
});

test("rejects an invalid account snapshot before publication", () => {
  assert.throws(() => buildPortfolioSnapshot(previous, {
    generatedAt: "2026-07-20T23:30:00.000Z",
    account: { netLiquidation: 0, cashBalance: 0 },
    positions: previous.positions,
    tradeSync: { status: "current", queryPeriod: "DAYS_7", trades: [] },
  }), /net liquidation/i);

  assert.throws(() => buildPortfolioSnapshot(previous, {
    generatedAt: "2026-07-20T23:30:00.000Z",
    account: { netLiquidation: 68_000, cashBalance: 1_500 },
    positions: [],
    tradeSync: { status: "current", queryPeriod: "DAYS_7", trades: [] },
  }), /positions/i);

  assert.throws(() => buildPortfolioSnapshot(previous, {
    generatedAt: "2026-07-20T23:30:00.000Z",
    account: { netLiquidation: 68_000, cashBalance: Number.NaN },
    positions: previous.positions,
    tradeSync: { status: "current", queryPeriod: "DAYS_7", trades: [] },
  }), /cash balance/i);

  assert.throws(() => buildPortfolioSnapshot(previous, {
    generatedAt: "2026-07-20T23:30:00.000Z",
    account: { netLiquidation: 68_000, cashBalance: 1_500 },
    positions: [{ ...previous.positions[0], quantity: 0 }],
    tradeSync: { status: "current", queryPeriod: "DAYS_7", trades: [] },
  }), /position values/i);
});
