import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSecWatchlist,
  handleSecFeedRequest,
  hasInternalSecAccess,
  requestSecAnalysis,
} from "../lib/sec-api.ts";
import type { SecRepository } from "../lib/sec-service.ts";

const emptyRepository: SecRepository = {
  async getCache() { return null; },
  async setCache() {},
  async getSummary() { return null; },
  async setSummary() {},
};

test("requires the exact internal refresh key", async () => {
  assert.equal(await hasInternalSecAccess(new Request("https://site.test"), "secret"), false);
  assert.equal(await hasInternalSecAccess(new Request("https://site.test", { headers: { "x-sec-refresh-key": "wrong" } }), "secret"), false);
  assert.equal(await hasInternalSecAccess(new Request("https://site.test", { headers: { "x-sec-refresh-key": "secret" } }), "secret"), true);
  assert.equal(await hasInternalSecAccess(new Request("https://site.test", { headers: { "x-sec-refresh-key": "secret" } }), ""), false);
});

test("deduplicates stock underlyings and excludes ETFs from the watchlist", () => {
  const securityTypes = new Map([
    ["MSFT", "stock"],
    ["NOK", "stock"],
    ["BOXX", "etf"],
  ]);
  const watchlist = buildSecWatchlist(
    ["MSFT", "MSFT", "BOXX"],
    ["NOK", "BOXX"],
    (ticker) => securityTypes.get(ticker) ?? null,
  );

  assert.deepEqual(watchlist, ["MSFT", "NOK"]);
});

test("queues analysis through the independent worker and returns immediately", async () => {
  let captured: Request | null = null;
  const response = await requestSecAnalysis({
    ticker: "MSFT",
    pipelineOrigin: "https://sec-worker.example/",
    refreshKey: "secret",
    fetcher: async (input, init) => {
      captured = new Request(input, init);
      return Response.json({ status: "queued", jobId: "manual-MSFT-1" }, { status: 202 });
    },
  });

  assert.equal(response.status, 202);
  assert.equal(captured?.url, "https://sec-worker.example/jobs/MSFT");
  assert.equal(captured?.method, "POST");
  assert.equal(captured?.headers.get("x-sec-refresh-key"), "secret");
});

test("protects filing feeds and returns a specific ETF state", async () => {
  const unauthorized = await handleSecFeedRequest({
    user: null,
    ticker: "MSFT",
    security: { symbol: "MSFT", type: "stock" },
    repository: emptyRepository,
  });
  const etf = await handleSecFeedRequest({
    user: { email: "max@example.com" },
    ticker: "BOXX",
    security: { symbol: "BOXX", type: "etf" },
    repository: emptyRepository,
  });
  const pending = await handleSecFeedRequest({
    user: { email: "max@example.com" },
    ticker: "MSFT",
    security: { symbol: "MSFT", type: "stock" },
    repository: emptyRepository,
  });

  assert.equal(unauthorized.status, 401);
  assert.equal((await etf.json()).status, "not_applicable");
  assert.equal((await pending.json()).status, "pending");
});
