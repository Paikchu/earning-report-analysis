import assert from "node:assert/strict";
import test from "node:test";

import {
  handleSecAnalysisRequest,
  runCompanyAnalysisSweep,
  runSecRefresh,
  type SecCronEnv,
  type SecWorkflowBinding,
} from "../workers/pipeline/core.ts";

const env: SecCronEnv = {
  WEB_APP_ORIGIN: "https://web.example",
  SEC_REFRESH_KEY: "refresh-key",
  SEC_ANALYSIS_WORKFLOW: workflowBinding(),
};

/** The whitelist is served by the Web Worker, so every entry point here has to go and read it. */
const watchlist: typeof fetch = async () => Response.json({ tickers: ["MSFT", "NOK"] });

function workflowBinding(started: string[] = []): SecWorkflowBinding {
  return {
    async create(options) {
      started.push(options.params.ticker);
      return { id: options.id };
    },
  };
}

test("loads the watchlist and starts one independent workflow per ticker", async () => {
  const started: string[] = [];
  const result = await runSecRefresh({ ...env, SEC_ANALYSIS_WORKFLOW: workflowBinding(started) }, watchlist, 1_786_000_000_000);

  assert.deepEqual(result, { started: ["MSFT", "NOK"], failed: [] });
  assert.deepEqual(started, ["MSFT", "NOK"]);
});

test("starts one idempotent company analysis workflow for each backfill candidate", async () => {
  const started: Array<{ id: string; ticker: string; triggerRef: string }> = [];
  const candidates: typeof fetch = async () => Response.json({ candidates: [{
    ticker: "MSFT",
    memoryJobId: "memory-job-1",
    memoryVersion: 4,
    periodId: "MSFT:2026-06-30:quarter",
    reportDate: "2026-06-30",
    triggerRef: "memory-job-1:4",
  }] });
  const result = await runCompanyAnalysisSweep({
    ...env,
    COMPANY_ANALYSIS_WORKFLOW: {
      async create(options) {
        started.push({ id: options.id, ticker: options.params.ticker, triggerRef: options.params.triggerRef });
        return { id: options.id };
      },
    },
  }, candidates);

  assert.deepEqual(result, { candidates: 1, started: ["MSFT"], failed: [] });
  assert.equal(started[0]?.ticker, "MSFT");
  assert.equal(started[0]?.triggerRef, "memory-job-1:4");
  assert.match(started[0]?.id ?? "", /^company-/);
});

test("force backfill requests incomplete candidates and creates a fresh workflow instance", async () => {
  const ids: string[] = [];
  const triggerRefs: string[] = [];
  const analysisIds: Array<string | undefined> = [];
  const requestBodies: string[] = [];
  const candidates: typeof fetch = async (_input, init) => {
    requestBodies.push(String(init?.body));
    return Response.json({ candidates: [{
      ticker: "MSFT",
      analysisId: "company:MSFT:existing",
      memoryJobId: "memory-job-1",
      memoryVersion: 4,
      periodId: "MSFT:2026-06-30:quarter",
      reportDate: "2026-06-30",
      triggerRef: "memory-job-1:4",
    }] });
  };
  const sweepEnv = {
    ...env,
    COMPANY_ANALYSIS_WORKFLOW: {
      async create(options) {
        ids.push(options.id);
        triggerRefs.push(options.params.triggerRef);
        analysisIds.push(options.params.analysisId);
        return { id: options.id };
      },
    },
  } as SecCronEnv;

  await runCompanyAnalysisSweep(sweepEnv, candidates, { forceIncomplete: true });
  await runCompanyAnalysisSweep(sweepEnv, candidates, { forceIncomplete: true });

  assert.equal(new Set(ids).size, 2);
  assert.deepEqual(triggerRefs, ["memory-job-1:4", "memory-job-1:4"]);
  assert.deepEqual(analysisIds, ["company:MSFT:existing", "company:MSFT:existing"]);
  assert.deepEqual(requestBodies.map((body) => JSON.parse(body)), [
    { limit: 100, includeIncomplete: true },
    { limit: 100, includeIncomplete: true },
  ]);
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
  assert.deepEqual(await runSecRefresh({ ...env, SEC_ANALYSIS_WORKFLOW: binding }, watchlist, 1_786_000_000_000), { started: ["NOK"], failed: ["MSFT"] });
  assert.deepEqual(started, ["NOK"]);
});

test("accepts authenticated manual jobs without running analysis in the request", async () => {
  const started: string[] = [];
  const response = await handleSecAnalysisRequest(
    new Request("https://worker.example/jobs/MSFT", { method: "POST", headers: { "x-sec-refresh-key": "refresh-key" } }),
    { ...env, SEC_ANALYSIS_WORKFLOW: workflowBinding(started) },
    1_786_000_000_000,
    watchlist,
  );

  assert.equal(response.status, 202);
  assert.deepEqual(started, ["MSFT"]);
  assert.equal((await response.json() as { status: string }).status, "queued");
  assert.equal((await handleSecAnalysisRequest(new Request("https://worker.example/jobs/MSFT", { method: "POST" }), env, 1_786_000_000_000, watchlist)).status, 401);
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

  await handleSecAnalysisRequest(request(), { ...env, SEC_ANALYSIS_WORKFLOW: binding }, 1_786_000_000_000, watchlist);
  await handleSecAnalysisRequest(request(), { ...env, SEC_ANALYSIS_WORKFLOW: binding }, 1_786_000_000_000, watchlist);

  assert.equal(new Set(ids).size, 2);
});

test("fails the refresh when no workflow could be started at all", async () => {
  const binding: SecWorkflowBinding = {
    async create() {
      throw new Error("workflow unavailable");
    },
  };

  await assert.rejects(
    runSecRefresh({ ...env, SEC_ANALYSIS_WORKFLOW: binding }, watchlist, 1_786_000_000_000),
    /started no workflows \(watchlist: 2, failed: 2\)/,
  );
});

test("routes the watchlist through the Service Binding rather than the Web Worker's hostname", async () => {
  const seen: string[] = [];
  const web: NonNullable<SecCronEnv["WEB"]> = {
    fetch: async (input) => {
      seen.push(String(input));
      return Response.json({ tickers: ["MSFT"] });
    },
  };
  const started: string[] = [];

  // Called the way the Cron handler calls it, with no fetcher: the binding has to come off the env,
  // because a plain fetch to that hostname is answered by the edge with a 404 that never lands.
  assert.deepEqual(
    await runSecRefresh({ ...env, WEB: web, SEC_ANALYSIS_WORKFLOW: workflowBinding(started) }),
    { started: ["MSFT"], failed: [] },
  );
  assert.deepEqual(seen, ["https://web.example/api/internal/sec/watchlist"]);
  assert.deepEqual(started, ["MSFT"]);
});
