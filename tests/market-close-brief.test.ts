import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { validateMarketCloseBrief, validateMarketCloseBriefArchive, type MarketCloseBriefArchiveV1, type MarketCloseBriefV1, type MarketQuote } from "../lib/market-close-brief.ts";

const projectRoot = new URL("../", import.meta.url);

async function fixture(): Promise<MarketCloseBriefV1> {
  return JSON.parse(await readFile(new URL("data/market-close-briefs/2026-08-21.json", projectRoot), "utf8"));
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function asPreviousQuote(quote: MarketQuote): MarketQuote {
  return { ...quote, close: quote.close - quote.change, change: 0, percent: 0 };
}

test("validates the checked-in market close archive", async () => {
  const archive = JSON.parse(await readFile(new URL("data/market-close-briefs.json", projectRoot), "utf8"));
  assert.deepEqual(validateMarketCloseBriefArchive(archive), []);
});

test("rejects quote triples that are not arithmetically self-consistent", async () => {
  const brief = await fixture();
  brief.sectors[0].percent = 1.99;
  assert.ok(validateMarketCloseBrief(brief).some((error) => error.includes("不自洽")));
});

test("requires two sources for extreme single-day movers", async () => {
  const brief = await fixture();
  brief.movers[0].percent = 60;
  brief.movers[0].change = Number((brief.movers[0].close * 60 / 160).toFixed(2));
  brief.movers[0].sourceIds = [brief.movers[0].sourceId];
  assert.ok(validateMarketCloseBrief(brief).some((error) => error.includes("至少两个来源")));
});

test("checks overlapping symbols against the previous session close", async () => {
  const current = await fixture();
  const previous = clone(current);
  previous.sessionDate = "2026-08-20";
  previous.methodology.marketDataTimestamp = "2026-08-20T16:00:00-04:00";
  previous.methodology.previousSessionDate = null;
  previous.methodology.crossDayValidated = false;
  previous.indices = current.indices.map(asPreviousQuote);
  previous.etfs = current.etfs.map(asPreviousQuote);
  previous.sectors = current.sectors.map(asPreviousQuote);
  previous.movers = current.movers.map((quote) => ({ ...quote, ...asPreviousQuote(quote) }));
  current.methodology.previousSessionDate = previous.sessionDate;
  current.methodology.crossDayValidated = true;

  const archive: MarketCloseBriefArchiveV1 = { version: 1, items: [current, previous] };
  assert.deepEqual(validateMarketCloseBriefArchive(archive), []);
  previous.etfs[0].close += 1;
  assert.ok(validateMarketCloseBriefArchive(archive).some((error) => error.includes("SPY 前收")));
});
