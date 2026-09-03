import assert from "node:assert/strict";
import test from "node:test";

import {
  FUNDAMENTAL_METRIC_CATALOG,
  FUNDAMENTAL_METRIC_CATALOG_VERSION,
  YAHOO_QUARTERLY_FUNDAMENTAL_FIELDS,
  getMetricKeyForYahooField,
  isFundamentalMetricKey,
} from "../lib/fundamental-metrics.ts";

test("registers each Yahoo field exactly once under a versioned metric catalog", () => {
  assert.equal(FUNDAMENTAL_METRIC_CATALOG_VERSION, "fundamental-metrics.v2");
  assert.equal(new Set(YAHOO_QUARTERLY_FUNDAMENTAL_FIELDS).size, YAHOO_QUARTERLY_FUNDAMENTAL_FIELDS.length);
  assert.ok(YAHOO_QUARTERLY_FUNDAMENTAL_FIELDS.length >= 19);
  assert.ok(YAHOO_QUARTERLY_FUNDAMENTAL_FIELDS.every((field) => field.startsWith("quarterly")));
  assert.equal(getMetricKeyForYahooField("quarterlyOperatingIncome"), "operating_income");
});

test("keeps derived ratios inside the catalog and references registered source metrics", () => {
  for (const definition of Object.values(FUNDAMENTAL_METRIC_CATALOG)) {
    if (definition.basis !== "derived") continue;
    assert.equal(definition.yahooField, null);
    assert.ok(isFundamentalMetricKey(definition.derivation.numerator));
    assert.ok(isFundamentalMetricKey(definition.derivation.denominator));
    assert.equal(definition.unitFamily, "percent");
    assert.equal(definition.defaultMark, "line");
  }
});

test("distinguishes stored source sign from capital-expenditure presentation", () => {
  assert.equal(FUNDAMENTAL_METRIC_CATALOG.capital_expenditure.displaySign, "outflow_magnitude");
  assert.equal(FUNDAMENTAL_METRIC_CATALOG.free_cash_flow.displaySign, "as_reported");
  assert.deepEqual(FUNDAMENTAL_METRIC_CATALOG.operating_income.allowedTransforms, [
    "value",
    "qoq_growth",
    "yoy_growth",
  ]);
  assert.deepEqual(FUNDAMENTAL_METRIC_CATALOG.gross_margin.allowedTransforms, [
    "value",
    "qoq_change",
    "yoy_change",
  ]);
});
