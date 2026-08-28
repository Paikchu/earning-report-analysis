import assert from "node:assert/strict";
import test from "node:test";

import { getTableConfig } from "drizzle-orm/sqlite-core";

import {
  fundamentalChartSpecs,
  fundamentalCompanyProfiles,
  fundamentalFetchRuns,
  fundamentalObservationRevisions,
  fundamentalObservations,
  fundamentalPeriods,
} from "../db/fundamentals-schema.ts";

const tables = [
  fundamentalFetchRuns,
  fundamentalPeriods,
  fundamentalObservations,
  fundamentalObservationRevisions,
  fundamentalCompanyProfiles,
  fundamentalChartSpecs,
];

test("declares four current fundamentals tables and two inert AI-ready tables", () => {
  assert.deepEqual(tables.map((table) => getTableConfig(table).name), [
    "fundamental_fetch_runs",
    "fundamental_periods",
    "fundamental_observations",
    "fundamental_observation_revisions",
    "fundamental_company_profiles",
    "fundamental_chart_specs",
  ]);
});

test("indexes the chart read path and enforces current observation identity", () => {
  const observationConfig = getTableConfig(fundamentalObservations);
  const indexNames = observationConfig.indexes.map((item) => item.config.name);

  assert.ok(indexNames.includes("fundamental_observations_identity_idx"));
  assert.ok(indexNames.includes("fundamental_observations_chart_read_idx"));
  assert.equal(observationConfig.foreignKeys.length, 2);
});

test("serializes active fetch runs per ticker", () => {
  const config = getTableConfig(fundamentalFetchRuns);
  const activeIndex = config.indexes.find((item) =>
    item.config.name === "fundamental_fetch_runs_running_ticker_idx");

  assert.ok(activeIndex);
  assert.equal(activeIndex.config.unique, true);
  assert.ok(activeIndex.config.where);
});

test("keeps one active future chart plan per ticker", () => {
  const config = getTableConfig(fundamentalChartSpecs);
  const activeIndex = config.indexes.find((item) => item.config.name === "fundamental_chart_specs_active_ticker_idx");

  assert.ok(activeIndex);
  assert.equal(activeIndex.config.unique, true);
  assert.ok(activeIndex.config.where);
});
