import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  FUNDAMENTAL_CORE_METRICS,
  FundamentalDataQualityError,
  normalizeYahooFundamentals,
} from "../lib/fundamental-normalization.ts";
import { getFundamentalMetricDefinition } from "../lib/fundamental-metrics.ts";
import { parseYahooFundamentalsPayload } from "../lib/yahoo-fundamentals-schema.ts";

const fixture = JSON.parse(await readFile(
  new URL("./fixtures/yahoo-fundamentals-timeseries.json", import.meta.url),
  "utf8",
)) as unknown;

test("normalizes reported values, preserves source sign, and derives quarterly margins", () => {
  const snapshot = normalizeYahooFundamentals(parseYahooFundamentalsPayload(fixture, "ACME"));

  assert.equal(snapshot.qualityStatus, "partial");
  assert.equal(snapshot.periods.length, 2);
  assert.equal(snapshot.observations.length, 10);
  assert.equal(
    snapshot.observations.find((item) => item.metricKey === "capital_expenditure")?.valueDecimal,
    "-180000000",
  );
  assert.deepEqual(
    snapshot.observations
      .filter((item) => item.metricKey === "gross_margin")
      .map((item) => [item.periodEnd, item.valueDecimal, item.basis]),
    [
      ["2025-12-31", "34", "derived"],
      ["2026-03-31", "32", "derived"],
    ],
  );
});

test("parses all eleven core fields across five structural quarters as complete", () => {
  const periodEnds = ["2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31", "2026-03-31"];
  const baseValues = {
    total_revenue: 1_000_000_000,
    gross_profit: 400_000_000,
    operating_income: 200_000_000,
    net_income: 150_000_000,
    diluted_eps: 1.25,
    operating_cash_flow: 250_000_000,
    capital_expenditure: -100_000_000,
    free_cash_flow: 150_000_000,
    cash_and_cash_equivalents: 900_000_000,
    long_term_debt: 300_000_000,
    ordinary_shares: 120_000_000,
  } satisfies Record<(typeof FUNDAMENTAL_CORE_METRICS)[number], number>;
  const payload = {
    timeseries: {
      error: null,
      result: FUNDAMENTAL_CORE_METRICS.map((metricKey) => {
        const definition = getFundamentalMetricDefinition(metricKey);
        assert.equal(definition.basis, "reported");
        const sourceField = definition.yahooField;
        return {
          meta: { symbol: ["ACME"], type: [sourceField] },
          [sourceField]: periodEnds.map((periodEnd, index) => ({
            asOfDate: periodEnd,
            periodType: "3M",
            currencyCode: "USD",
            reportedValue: { raw: baseValues[metricKey] + index },
          })),
        };
      }),
    },
  };

  const parsed = parseYahooFundamentalsPayload(payload, "ACME");
  const snapshot = normalizeYahooFundamentals(parsed);

  assert.equal(parsed.receivedFields.length, 11);
  assert.equal(parsed.observations.length, 55);
  assert.equal(snapshot.qualityStatus, "complete");
  assert.equal(snapshot.periods.length, 5);
  assert.equal(snapshot.observations.length, 65);
  assert.equal(snapshot.issueCount, 0);
});

test("rejects a payload with fewer than two usable quarters", () => {
  const parsed = parseYahooFundamentalsPayload(fixture, "ACME");
  parsed.observations = parsed.observations.filter((item) => item.periodEnd === "2026-03-31");

  assert.throws(
    () => normalizeYahooFundamentals(parsed),
    (error: unknown) => error instanceof FundamentalDataQualityError
      && error.code === "INSUFFICIENT_QUARTERS",
  );
});

test("rejects a payload without any quarterly revenue", () => {
  const parsed = parseYahooFundamentalsPayload(fixture, "ACME");
  parsed.observations = parsed.observations.filter((item) => item.metricKey !== "total_revenue");

  assert.throws(
    () => normalizeYahooFundamentals(parsed),
    (error: unknown) => error instanceof FundamentalDataQualityError
      && error.code === "MISSING_LATEST_REVENUE",
  );
});

test("excludes a trailing partial quarter instead of rejecting prior complete quarters", () => {
  const parsed = parseYahooFundamentalsPayload(fixture, "ACME");
  const latestEps = parsed.observations.find((item) =>
    item.periodEnd === "2026-03-31" && item.metricKey === "diluted_eps");
  assert.ok(latestEps);
  parsed.observations.push({ ...latestEps, periodEnd: "2026-06-30" });

  const snapshot = normalizeYahooFundamentals(parsed);

  assert.deepEqual(snapshot.periods.map((period) => period.periodEnd), ["2025-12-31", "2026-03-31"]);
  assert.equal(snapshot.observations.some((item) => item.periodEnd === "2026-06-30"), false);
  assert.ok(snapshot.warnings.includes("2026-06-30:incomplete_quarter_excluded"));
  assert.equal(snapshot.qualityStatus, "partial");
});
