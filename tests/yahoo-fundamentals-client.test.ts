import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { YAHOO_QUARTERLY_FUNDAMENTAL_FIELDS } from "../lib/fundamental-metrics.ts";
import {
  YahooFundamentalsRequestError,
  buildYahooFundamentalsRequest,
  fetchYahooFundamentals,
} from "../lib/yahoo-fundamentals-client.ts";

const fixtureText = await readFile(
  new URL("./fixtures/yahoo-fundamentals-timeseries.json", import.meta.url),
  "utf8",
);

test("builds a deterministic Yahoo request containing the full quarterly catalog", async () => {
  const request = await buildYahooFundamentalsRequest("test.a", new Date("2026-08-28T00:00:00.000Z"));

  assert.equal(request.ticker, "TEST.A");
  assert.equal(request.url.pathname.endsWith("/TEST-A"), true);
  assert.equal(request.url.searchParams.get("symbol"), "TEST-A");
  assert.deepEqual(request.url.searchParams.get("type")?.split(","), YAHOO_QUARTERLY_FUNDAMENTAL_FIELDS);
  assert.match(request.requestHash, /^[a-f0-9]{64}$/);
});

test("retries a throttled request with bounded backoff and returns validated data", async () => {
  let calls = 0;
  const delays: number[] = [];
  const fetcher = (async () => {
    calls += 1;
    return calls === 1
      ? new Response("throttled", { status: 429 })
      : new Response(fixtureText, { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const request = await buildYahooFundamentalsRequest("ACME", new Date("2026-08-28T00:00:00.000Z"));

  const result = await fetchYahooFundamentals(request, {
    fetcher,
    clock: () => new Date("2026-08-28T00:00:03.000Z"),
    sleep: async (milliseconds) => { delays.push(milliseconds); },
    random: () => 0.5,
  });

  assert.equal(calls, 2);
  assert.deepEqual(delays, [250]);
  assert.equal(result.attempts, 2);
  assert.equal(result.fetchedAt, "2026-08-28T00:00:03.000Z");
  assert.equal(result.parsed.ticker, "ACME");
  assert.match(result.payloadHash, /^[a-f0-9]{64}$/);
});

test("does not retry a non-retryable Yahoo HTTP response", async () => {
  let calls = 0;
  const request = await buildYahooFundamentalsRequest("ACME", new Date("2026-08-28T00:00:00.000Z"));

  await assert.rejects(
    fetchYahooFundamentals(request, {
      fetcher: (async () => {
        calls += 1;
        return new Response("missing", { status: 404 });
      }) as typeof fetch,
      sleep: async () => { throw new Error("unexpected retry"); },
    }),
    (error: unknown) => error instanceof YahooFundamentalsRequestError
      && error.code === "HTTP_ERROR"
      && error.status === 404
      && error.retryable === false,
  );
  assert.equal(calls, 1);
});
