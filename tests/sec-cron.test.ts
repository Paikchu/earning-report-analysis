import assert from "node:assert/strict";
import test from "node:test";

import {
  handleSecAnalysisRequest,
  runCompanyAnalysisSweep,
  runSecRefresh,
  type SecCronEnv,
  type SecWorkflowBinding,
} from "../workers/pipeline/core.ts";

/** A fake D1 whose only job here is to answer `listBackfillCandidates`'s query. */
function companyAnalysisDb(candidates: Array<Record<string, unknown>>) {
  return {
    prepare() {
      return {
        bind() {
          return { async all() { return { results: candidates }; } };
        },
      };
    },
  } as unknown as D1Database;
}

const env: SecCronEnv = {
  SEC_TRACKED_TICKERS: "MSFT,NOK",
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

test("reads its own whitelist and starts one independent workflow per ticker", async () => {
  const started: string[] = [];
  const result = await runSecRefresh({ ...env, SEC_ANALYSIS_WORKFLOW: workflowBinding(started) }, 1_786_000_000_000);

  assert.deepEqual(result, { started: ["MSFT", "NOK"], failed: [] });
  assert.deepEqual(started, ["MSFT", "NOK"]);
});

test("starts one idempotent company analysis workflow for each backfill candidate", async () => {
  const started: Array<{ id: string; ticker: string; triggerRef: string }> = [];
  const result = await runCompanyAnalysisSweep({
    ...env,
    DB: companyAnalysisDb([{
      ticker: "MSFT",
      memoryJobId: "memory-job-1",
      memoryVersion: 4,
      periodId: "MSFT:2026-06-30:quarter",
      reportDate: "2026-06-30",
      triggerRef: "memory-job-1:4",
    }]),
    COMPANY_ANALYSIS_WORKFLOW: {
      async create(options) {
        started.push({ id: options.id, ticker: options.params.ticker, triggerRef: options.params.triggerRef });
        return { id: options.id };
      },
    },
  });

  assert.deepEqual(result, { candidates: 1, started: ["MSFT"], failed: [] });
  assert.equal(started[0]?.ticker, "MSFT");
  assert.equal(started[0]?.triggerRef, "memory-job-1:4");
  assert.match(started[0]?.id ?? "", /^company-/);
});

test("force backfill requests incomplete candidates and creates a fresh workflow instance", async () => {
  const ids: string[] = [];
  const triggerRefs: string[] = [];
  const analysisIds: Array<string | undefined> = [];
  const sweepEnv = {
    ...env,
    DB: companyAnalysisDb([{
      ticker: "MSFT",
      analysisId: "company:MSFT:existing",
      memoryJobId: "memory-job-1",
      memoryVersion: 4,
      periodId: "MSFT:2026-06-30:quarter",
      reportDate: "2026-06-30",
      triggerRef: "memory-job-1:4",
    }]),
    COMPANY_ANALYSIS_WORKFLOW: {
      async create(options) {
        ids.push(options.id);
        triggerRefs.push(options.params.triggerRef);
        analysisIds.push(options.params.analysisId);
        return { id: options.id };
      },
    },
  } as SecCronEnv;

  await runCompanyAnalysisSweep(sweepEnv, { forceIncomplete: true });
  await runCompanyAnalysisSweep(sweepEnv, { forceIncomplete: true });

  assert.equal(new Set(ids).size, 2);
  assert.deepEqual(triggerRefs, ["memory-job-1:4", "memory-job-1:4"]);
  assert.deepEqual(analysisIds, ["company:MSFT:existing", "company:MSFT:existing"]);
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
  assert.deepEqual(await runSecRefresh({ ...env, SEC_ANALYSIS_WORKFLOW: binding }, 1_786_000_000_000), { started: ["NOK"], failed: ["MSFT"] });
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
  assert.equal((await response.json() as { status: string }).status, "queued");
  assert.equal((await handleSecAnalysisRequest(new Request("https://worker.example/jobs/MSFT", { method: "POST" }), env, 1_786_000_000_000)).status, 401);
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

test("fails the refresh when no workflow could be started at all", async () => {
  const binding: SecWorkflowBinding = {
    async create() {
      throw new Error("workflow unavailable");
    },
  };

  await assert.rejects(
    runSecRefresh({ ...env, SEC_ANALYSIS_WORKFLOW: binding }, 1_786_000_000_000),
    /started no workflows \(watchlist: 2, failed: 2\)/,
  );
});
