import assert from "node:assert/strict";
import test from "node:test";

import {
  handleSecAnalysisRequest,
  runSecRefresh,
  type SecCronEnv,
  type SecWorkflowBinding,
} from "../workers/sec-cron/core.ts";

const env: SecCronEnv = {
  MAX_SITE_ORIGIN: "https://max-investment-record.example",
  MAX_SITE_BYPASS_TOKEN: "sites-token",
  SEC_REFRESH_KEY: "refresh-key",
  SEC_ANALYSIS_WORKFLOW: workflowBinding(),
};

function workflowBinding(started: string[] = []): SecWorkflowBinding {
  return {
    async create(options) {
      started.push(options.params.ticker);
      return { id: options.id };
    },
  };
}

test("loads the watchlist and starts one independent workflow per ticker", async () => {
  const requests: Request[] = [];
  const started: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    requests.push(request);
    if (request.url.endsWith("/watchlist")) return Response.json({ tickers: ["MSFT", "NOK"] });
    throw new Error(`Unexpected request: ${request.url}`);
  };

  const result = await runSecRefresh({ ...env, SEC_ANALYSIS_WORKFLOW: workflowBinding(started) }, fetcher, 1_786_000_000_000);

  assert.deepEqual(result, { started: ["MSFT", "NOK"], failed: [] });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].headers.get("oai-sites-authorization"), "Bearer sites-token");
  assert.equal(requests[0].headers.get("authorization"), null);
  assert.deepEqual(started, ["MSFT", "NOK"]);
});

test("continues starting remaining workflows after one failure", async () => {
  const started: string[] = [];
  const binding: SecWorkflowBinding = {
    async create(options) {
      if (options.params.ticker === "MSFT") throw new Error("workflow unavailable");
      started.push(options.params.ticker);
      return { id: options.id };
    },
  };
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    if (request.url.endsWith("/watchlist")) return Response.json({ tickers: ["MSFT", "NOK"] });
    throw new Error(`Unexpected request: ${request.url}`);
  };

  assert.deepEqual(await runSecRefresh({ ...env, SEC_ANALYSIS_WORKFLOW: binding }, fetcher, 1_786_000_000_000), { started: ["NOK"], failed: ["MSFT"] });
  assert.deepEqual(started, ["NOK"]);
});

test("accepts authenticated manual jobs without running analysis in the request", async () => {
  const started: string[] = [];
  const response = await handleSecAnalysisRequest(
    new Request("https://worker.example/jobs/MSFT", { method: "POST", headers: { "x-sec-refresh-key": "refresh-key" } }),
    { ...env, SEC_ANALYSIS_WORKFLOW: workflowBinding(started) },
    1_786_000_000_000,
  );

  assert.equal(response.status, 202);
  assert.deepEqual(started, ["MSFT"]);
  assert.equal((await response.json()).status, "queued");
  assert.equal((await handleSecAnalysisRequest(new Request("https://worker.example/jobs/MSFT", { method: "POST" }), env)).status, 401);
});

test("creates a distinct workflow for each manual force refresh", async () => {
  const ids: string[] = [];
  const binding: SecWorkflowBinding = {
    async create(options) {
      ids.push(options.id);
      return { id: options.id };
    },
  };
  const request = () => new Request("https://worker.example/jobs/MSFT", {
    method: "POST",
    headers: { "x-sec-refresh-key": "refresh-key" },
  });

  await handleSecAnalysisRequest(request(), { ...env, SEC_ANALYSIS_WORKFLOW: binding }, 1_786_000_000_000);
  await handleSecAnalysisRequest(request(), { ...env, SEC_ANALYSIS_WORKFLOW: binding }, 1_786_000_000_000);

  assert.equal(new Set(ids).size, 2);
});
