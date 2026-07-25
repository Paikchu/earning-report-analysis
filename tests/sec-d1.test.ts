import assert from "node:assert/strict";
import test from "node:test";

import { D1SecRepository, listHoldingPlanTickers } from "../lib/sec-d1.ts";
import type { SecFilingSummary } from "../lib/sec.ts";

test("reads and upserts SEC cache records through prepared D1 statements", async () => {
  const calls: Array<{ sql: string; values: unknown[]; action: string }> = [];
  const database = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async first<T>() {
              calls.push({ sql, values, action: "first" });
              return { payload: JSON.stringify({ ticker: "MSFT" }), fetchedAt: "2026-07-25T00:00:00.000Z" } as T;
            },
            async run() {
              calls.push({ sql, values, action: "run" });
              return {};
            },
          };
        },
      };
    },
  };
  const repository = new D1SecRepository(database);

  const cached = await repository.getCache<{ ticker: string }>("sec:filings:MSFT");
  await repository.setCache("sec:filings:MSFT", { ticker: "MSFT" }, "2026-07-25T00:00:00.000Z");

  assert.equal(cached?.payload.ticker, "MSFT");
  assert.match(calls[0].sql, /FROM sec_cache/);
  assert.match(calls[1].sql, /ON CONFLICT\(cache_key\)/);
});

test("persists and restores one summary per ticker and accession", async () => {
  const summary: SecFilingSummary = {
    ticker: "MSFT",
    form: "10-Q",
    filingDate: "2026-07-24",
    accessionNumber: "0000789019-26-000001",
    headline: "云业务推动增长",
    bullets: [],
    analystView: "盈利质量稳定。",
    source: "deepseek",
    generatedAt: "2026-07-25T00:00:00.000Z",
  };
  let storedPayload = "";
  const database = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async first<T>() {
              return storedPayload ? { payload: storedPayload } as T : null;
            },
            async run() {
              assert.match(sql, /ON CONFLICT\(ticker, accession_number\)/);
              storedPayload = String(values[3]);
              return {};
            },
          };
        },
      };
    },
  };
  const repository = new D1SecRepository(database);

  await repository.setSummary(summary);
  assert.equal((await repository.getSummary("MSFT", summary.accessionNumber))?.headline, "云业务推动增长");
});

test("returns distinct plan tickers for the background watchlist", async () => {
  const database = {
    prepare(sql: string) {
      assert.match(sql, /SELECT DISTINCT ticker FROM holding_plans/);
      return {
        bind() {
          return {
            async all<T>() {
              return { results: [{ ticker: "MSFT" }, { ticker: "NVDA" }] as T[] };
            },
          };
        },
      };
    },
  };

  assert.deepEqual(await listHoldingPlanTickers(database), ["MSFT", "NVDA"]);
});
