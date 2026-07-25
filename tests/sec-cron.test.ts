import assert from "node:assert/strict";
import test from "node:test";

import worker, { runSecRefresh, type SecCronEnv } from "../workers/sec-cron/index.ts";

const env: SecCronEnv = {
  MAX_SITE_ORIGIN: "https://max-investment-record.example",
  MAX_SITE_BYPASS_TOKEN: "sites-token",
  SEC_REFRESH_KEY: "refresh-key",
};

test("loads the watchlist and refreshes every ticker with service credentials", async () => {
  const requests: Request[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    requests.push(request);
    if (request.url.endsWith("/watchlist")) return Response.json({ tickers: ["MSFT", "NOK"] });
    return Response.json({ status: "ready" });
  };

  const result = await runSecRefresh(env, fetcher);

  assert.deepEqual(result, { succeeded: ["MSFT", "NOK"], failed: [] });
  assert.equal(requests.length, 3);
  assert.equal(requests[0].headers.get("oai-sites-authorization"), "Bearer sites-token");
  assert.equal(requests[0].headers.get("authorization"), null);
  assert.equal(requests[1].headers.get("x-sec-refresh-key"), "refresh-key");
  assert.equal(requests[1].method, "POST");
  assert.match(requests[2].url, /\/refresh\/NOK$/);
});

test("continues refreshing remaining tickers after one failure", async () => {
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    if (request.url.endsWith("/watchlist")) return Response.json({ tickers: ["MSFT", "NOK"] });
    if (request.url.endsWith("/MSFT")) return Response.json({ error: "failed" }, { status: 502 });
    return Response.json({ status: "ready" });
  };

  assert.deepEqual(await runSecRefresh(env, fetcher), { succeeded: ["NOK"], failed: ["MSFT"] });
});

test("exposes only a small health endpoint outside scheduled runs", async () => {
  const response = await worker.fetch(new Request("https://worker.example/health"));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "ok");
  assert.equal((await worker.fetch(new Request("https://worker.example/"))).status, 404);
});
