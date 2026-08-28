import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  YahooFundamentalsPayloadError,
  parseYahooFundamentalsPayload,
} from "../lib/yahoo-fundamentals-schema.ts";

const fixture = JSON.parse(await readFile(
  new URL("./fixtures/yahoo-fundamentals-timeseries.json", import.meta.url),
  "utf8",
)) as unknown;

test("parses a structural Yahoo fixture into normalized quarterly observations", () => {
  const parsed = parseYahooFundamentalsPayload(fixture, "ACME");

  assert.equal(parsed.source, "yahoo_finance");
  assert.equal(parsed.ticker, "ACME");
  assert.equal(parsed.observations.length, 8);
  assert.deepEqual(parsed.issues, []);
  assert.deepEqual(parsed.receivedFields, [
    "quarterlyCapitalExpenditure",
    "quarterlyDilutedEPS",
    "quarterlyGrossProfit",
    "quarterlyTotalRevenue",
  ]);
  assert.deepEqual(parsed.observations[0], {
    ticker: "ACME",
    metricKey: "capital_expenditure",
    sourceField: "quarterlyCapitalExpenditure",
    periodType: "3M",
    periodEnd: "2025-12-31",
    valueDecimal: "-180000000",
    currencyCode: "USD",
  });
});

test("isolates malformed series entries instead of accepting bad values", () => {
  const payload = structuredClone(fixture) as {
    timeseries: { result: Array<Record<string, unknown>>; error: unknown };
  };
  const revenue = payload.timeseries.result.find((result) =>
    (result.meta as { type: string[] }).type[0] === "quarterlyTotalRevenue")!;
  const observations = revenue.quarterlyTotalRevenue as Array<Record<string, unknown>>;
  observations[0] = {
    ...observations[0],
    reportedValue: { raw: "not-a-number", fmt: "bad" },
  };

  const parsed = parseYahooFundamentalsPayload(payload, "ACME");

  assert.equal(parsed.observations.length, 7);
  assert.deepEqual(parsed.issues.map((issue) => issue.code), ["invalid_observation"]);
  assert.equal(parsed.issues[0]?.sourceField, "quarterlyTotalRevenue");
});

test("rejects an invalid top-level payload or mismatched ticker", () => {
  assert.throws(
    () => parseYahooFundamentalsPayload({ timeseries: { result: [], error: { code: "Bad Request" } } }, "ACME"),
    YahooFundamentalsPayloadError,
  );
  assert.throws(
    () => parseYahooFundamentalsPayload(fixture, "OTHER"),
    /no usable ticker/i,
  );
});
