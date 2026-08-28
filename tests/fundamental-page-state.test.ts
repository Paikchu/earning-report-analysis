import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_FUNDAMENTAL_PAGE_STATE,
  limitFundamentalMetricAxes,
  normalizeFundamentalPageState,
  parseFundamentalPageState,
  reconcileFundamentalMetricSelection,
  stockPageSearchParamsToUrlSearchParams,
  writeFundamentalPageState,
} from "../lib/fundamental-page-state.ts";
import { makeChartSeries } from "./fixtures/fundamental-chart.ts";

test("page state parser keeps valid ordered metrics and clamps malformed values to defaults", () => {
  const parsed = parseFundamentalPageState(new URLSearchParams(
    "metrics=free_cash_flow,total_revenue,total_revenue,not_real,gross_margin,operating_income,net_income&chart=line&periods=8",
  ));
  assert.deepEqual(parsed, {
    metricKeys: ["free_cash_flow", "total_revenue", "gross_margin", "operating_income"],
    chart: "line",
    periodCount: 8,
  });

  assert.deepEqual(
    parseFundamentalPageState(new URLSearchParams("metrics=unknown&chart=pie&periods=7")),
    DEFAULT_FUNDAMENTAL_PAGE_STATE,
  );
});

test("page state writer preserves unrelated query parameters and produces a stable explicit codec", () => {
  const original = new URLSearchParams("view=compact&metrics=old&chart=line&periods=12");
  const written = writeFundamentalPageState(original, {
    metricKeys: ["gross_margin", "total_revenue"],
    chart: "bar",
    periodCount: 5,
  });

  assert.equal(written.get("view"), "compact");
  assert.equal(written.get("metrics"), "gross_margin,total_revenue");
  assert.equal(written.get("chart"), "bar");
  assert.equal(written.get("periods"), "5");
  assert.deepEqual(parseFundamentalPageState(written), {
    metricKeys: ["gross_margin", "total_revenue"],
    chart: "bar",
    periodCount: 5,
  });
});

test("server search params adapter retains repeated and scalar values", () => {
  const params = stockPageSearchParamsToUrlSearchParams({
    metrics: "total_revenue,gross_margin",
    tag: ["one", "two"],
    missing: undefined,
  });
  assert.equal(params.get("metrics"), "total_revenue,gross_margin");
  assert.deepEqual(params.getAll("tag"), ["one", "two"]);
  assert.equal(params.has("missing"), false);
});

test("selection reconciliation retains available choices then falls back to priority metrics", () => {
  assert.deepEqual(
    reconcileFundamentalMetricSelection(
      ["diluted_eps", "total_revenue", "gross_margin"],
      ["gross_margin", "operating_income"],
    ),
    ["gross_margin"],
  );
  assert.deepEqual(
    reconcileFundamentalMetricSelection(
      ["diluted_eps"],
      ["free_cash_flow", "operating_income", "gross_margin"],
    ),
    ["gross_margin", "operating_income"],
  );
  assert.deepEqual(reconcileFundamentalMetricSelection(["diluted_eps"], []), []);
});

test("normalization rejects empty selections and invalid period counts", () => {
  assert.deepEqual(normalizeFundamentalPageState({ metricKeys: [], chart: "combo", periodCount: 1 }), {
    metricKeys: ["total_revenue", "gross_margin"],
    chart: "combo",
    periodCount: 5,
  });
});

test("axis limiter preserves metric order while rejecting a third incompatible unit", () => {
  const series = [
    makeChartSeries("total_revenue"),
    makeChartSeries("gross_margin"),
    makeChartSeries("operating_income"),
    makeChartSeries("diluted_eps"),
  ];
  assert.deepEqual(
    limitFundamentalMetricAxes(
      ["total_revenue", "gross_margin", "diluted_eps", "operating_income"],
      series,
    ),
    ["total_revenue", "gross_margin", "operating_income"],
  );
});
