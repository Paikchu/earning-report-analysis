import assert from "node:assert/strict";
import test from "node:test";

import * as yahooQuotes from "../lib/yahoo-quotes.ts";

const {
  fetchYahooQuotes,
  handleQuoteRequest,
  parseRequestedSymbols,
  parseYahooSparkQuotes,
} = yahooQuotes;

const wilderCloses = [
  44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42,
  45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.00,
];

const yahooPayload = {
  spark: {
    error: null,
    result: [
      {
        symbol: "NVDA",
        response: [{
          meta: {
            currency: "USD",
            symbol: "NVDA",
            exchangeName: "NMS",
            fullExchangeName: "NasdaqGS",
            instrumentType: "EQUITY",
            firstTradeDate: 917015400,
            regularMarketTime: 1_784_836_800,
            hasPrePostMarketData: true,
            gmtoffset: -14_400,
            timezone: "EDT",
            exchangeTimezoneName: "America/New_York",
            regularMarketPrice: 208.76,
            chartPreviousClose: 212.06,
            previousClose: 212.06,
          },
          timestamp: [1_784_836_800],
          indicators: { quote: [{ close: [...wilderCloses.slice(0, -2), 212.06, 208.76] }] },
        }],
      },
      {
        symbol: "MSFT",
        response: [{
          meta: {
            currency: "USD",
            symbol: "MSFT",
            exchangeName: "NMS",
            fullExchangeName: "NasdaqGS",
            instrumentType: "EQUITY",
            firstTradeDate: 511108200,
            regularMarketTime: 1_784_836_801,
            hasPrePostMarketData: true,
            gmtoffset: -14_400,
            timezone: "EDT",
            exchangeTimezoneName: "America/New_York",
            regularMarketPrice: 381.58,
            chartPreviousClose: 300,
          },
          timestamp: [1_784_836_801],
          indicators: { quote: [{ close: [...wilderCloses.slice(0, -2), 390.34, 381.58] }] },
        }],
      },
    ],
  },
};

test("parses Yahoo quotes by ticker when results arrive out of order", () => {
  const quotes = parseYahooSparkQuotes(yahooPayload, ["MSFT", "NVDA"]);

  assert.equal(quotes.MSFT.price, 381.58);
  assert.equal(quotes.MSFT.marketTime, "2026-07-23T20:00:01.000Z");
  assert.equal(Number(quotes.MSFT.changePercent.toFixed(4)), -2.2442);
  assert.ok(Number.isFinite(quotes.MSFT.rsi14));
  assert.equal(quotes.NVDA.price, 208.76);
});

test("calculates 14-day Wilder RSI from daily closes", () => {
  assert.equal(typeof yahooQuotes.calculateRsi, "function");
  assert.equal(Number(yahooQuotes.calculateRsi!(wilderCloses)?.toFixed(2)), 66.25);
  assert.equal(yahooQuotes.calculateRsi!([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]), 100);
  assert.equal(yahooQuotes.calculateRsi!([15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]), 0);
  assert.equal(yahooQuotes.calculateRsi!(Array.from({ length: 15 }, () => 10)), 50);
  assert.equal(yahooQuotes.calculateRsi!(wilderCloses.slice(0, 14)), null);
});

test("omits Yahoo results without a usable previous close", () => {
  const payload = structuredClone(yahooPayload);
  payload.spark.result[0].response[0].meta.chartPreviousClose = 0;
  payload.spark.result[0].response[0].meta.previousClose = 0;
  payload.spark.result[0].response[0].indicators.quote[0].close = [208.76];

  const quotes = parseYahooSparkQuotes(payload, ["MSFT", "NVDA", "MISSING"]);

  assert.deepEqual(Object.keys(quotes), ["MSFT"]);
});

test("normalizes, deduplicates, and validates requested tickers", () => {
  assert.deepEqual(parseRequestedSymbols(" msft,NVDA,msft,BRK.B,^GSPC,^IXIC "), {
    ok: true,
    symbols: ["MSFT", "NVDA", "BRK.B", "^GSPC", "^IXIC"],
  });
  assert.deepEqual(parseRequestedSymbols("MSFT,$BAD"), {
    ok: false,
    error: "Ticker 参数无效。",
  });
  assert.deepEqual(parseRequestedSymbols(Array.from({ length: 51 }, (_, index) => `T${index}`).join(",")), {
    ok: false,
    error: "一次最多查询 50 个 Ticker。",
  });
});

test("fetches all tickers through one Yahoo spark request", async () => {
  let requestedUrl = "";
  const quotes = await fetchYahooQuotes(["MSFT", "BRK.B", "^GSPC"], async (input, init) => {
    requestedUrl = String(input);
    assert.ok(init?.signal instanceof AbortSignal);
    return Response.json({
      spark: {
        error: null,
        result: [
          yahooPayload.spark.result[1],
          { ...yahooPayload.spark.result[0], symbol: "^GSPC", response: [{
            ...yahooPayload.spark.result[0].response[0],
            meta: { ...yahooPayload.spark.result[0].response[0].meta, symbol: "^GSPC" },
          }] },
          { ...yahooPayload.spark.result[0], symbol: "BRK-B", response: [{
            ...yahooPayload.spark.result[0].response[0],
            meta: { ...yahooPayload.spark.result[0].response[0].meta, symbol: "BRK-B" },
          }] },
        ],
      },
    });
  });

  const url = new URL(requestedUrl);
  assert.equal(url.pathname, "/v7/finance/spark");
  assert.equal(url.searchParams.get("symbols"), "MSFT,BRK-B,^GSPC");
  assert.equal(url.searchParams.get("range"), "3mo");
  assert.equal(url.searchParams.get("interval"), "1d");
  assert.equal(quotes["BRK.B"].price, 208.76);
  assert.equal(quotes["^GSPC"].price, 208.76);
});

test("rejects Yahoo non-success responses", async () => {
  await assert.rejects(
    fetchYahooQuotes(["MSFT"], async () => new Response("rate limited", { status: 429 })),
    /Yahoo Finance 请求失败/,
  );
});

test("rejects unauthenticated quote requests before calling Yahoo", async () => {
  let calls = 0;
  const response = await handleQuoteRequest(
    new Request("https://example.com/api/quotes?symbols=MSFT"),
    null,
    async () => { calls += 1; return Response.json(yahooPayload); },
  );

  assert.equal(response.status, 401);
  assert.equal(calls, 0);
});

test("rejects invalid quote request parameters", async () => {
  const response = await handleQuoteRequest(
    new Request("https://example.com/api/quotes?symbols=MSFT,$BAD"),
    { email: "owner@example.com" },
    async () => Response.json(yahooPayload),
  );

  assert.equal(response.status, 400);
});

test("returns a controlled error when Yahoo is unavailable", async () => {
  const response = await handleQuoteRequest(
    new Request("https://example.com/api/quotes?symbols=MSFT"),
    { email: "owner@example.com" },
    async () => { throw new DOMException("aborted", "AbortError"); },
  );

  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: "行情暂时无法获取。" });
});
