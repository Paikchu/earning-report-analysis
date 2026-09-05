import assert from "node:assert/strict";
import test from "node:test";
import { D1CompanyAnalysisRepository, type CompanyAnalysisRunUpdate } from "../lib/company-analysis/repository.ts";
import { companyAnalysisNotice, shouldPollCompanyAnalysis } from "../lib/company-analysis/display-state.ts";
import { executeCompanyAnalysisWorkflow, type CompanyWorkflowStep } from "../workers/pipeline/company-analysis-workflow.ts";
import { runCompanyAnalysisSweep, type SecCronEnv, type CompanyAnalysisWorkflowParams } from "../workers/pipeline/core.ts";
import type { SecPipelineEnv } from "../workers/pipeline/operations.ts";
import { createAnalysisDatabase } from "./helpers/analysis-backend.ts";
import { seedFundamentals, seedCompanyAnalysisPublication } from "./helpers/analysis-fixtures.ts";
import type { SqliteD1Database } from "./helpers/sqlite-d1.ts";

const params: CompanyAnalysisWorkflowParams = {
  ticker: "MSFT", memoryJobId: "memory-1", memoryVersion: 1,
  periodId: "MSFT:2026-06-30:quarter", reportDate: "2026-06-30", triggerRef: "memory-1:1",
};
const oldTime = "2026-09-01T00:00:00.000Z";
const update: CompanyAnalysisRunUpdate = {
  ...params, analysisId: "company:MSFT:recovery", status: "failed",
  modelVersion: "test", promptVersion: "test", updatedAt: oldTime,
};

async function databaseWithMemory() {
  const db = await createAnalysisDatabase();
  db.raw.prepare("INSERT INTO sec_periods (period_id, ticker, period_scope, end_date) VALUES (?, 'MSFT', 'quarter', '2026-06-30')").run(params.periodId);
  db.raw.prepare("INSERT INTO sec_company_memory_threads (ticker, version) VALUES ('MSFT', 1)").run();
  db.raw.prepare(`INSERT INTO sec_memory_jobs (job_id,ticker,filing_id,period_id,status,source_r2_key,completed_at)
    VALUES ('memory-1','MSFT','filing-1',?,'complete','test',?)`).run(params.periodId, oldTime);
  return db;
}

function envFor(db: SqliteD1Database, created: Array<{ id: string; params: CompanyAnalysisWorkflowParams }> = []): SecCronEnv {
  return {
    DB: db as unknown as D1Database, SEC_TRACKED_TICKERS: "MSFT", SEC_REFRESH_KEY: "test",
    SEC_ANALYSIS_WORKFLOW: { async create({ id }) { return { id }; } },
    COMPANY_ANALYSIS_WORKFLOW: { async create(options) { created.push(options); return { id: options.id }; } },
  };
}

test("a workflow starting days late uses positive relative sleeps and missing Yahoo never calls AI", async () => {
  const db = await databaseWithMemory();
  const sleeps: number[] = [];
  const checkpoints = new Map<string, unknown>();
  const step: CompanyWorkflowStep = {
    async do<T>(name: string, configOrCallback: object | (() => Promise<T>), callback?: () => Promise<T>): Promise<T> {
      if (checkpoints.has(name)) return checkpoints.get(name) as T;
      // Only the upstream network refresh is stubbed. All packet, readiness and status SQL is real.
      const action = (typeof configOrCallback === "function" ? configOrCallback : callback!) as () => Promise<T>;
      const value = name.startsWith("yahoo-refresh-") ? {} : await action();
      checkpoints.set(name, value);
      return value as T;
    },
    async sleep(name, duration) {
      assert.ok(duration > 0);
      if (!checkpoints.has(name)) { sleeps.push(duration); checkpoints.set(name, true); }
    },
  };
  const env = envFor(db) as SecPipelineEnv;
  const neverFetch: typeof fetch = async () => { throw new Error("AI must not run before Yahoo is ready"); };
  const run = () => executeCompanyAnalysisWorkflow(params, "late-workflow", new Date("2026-08-01"), step, env, neverFetch);
  assert.equal((await run()).status, "insufficient_data");
  assert.deepEqual(sleeps, [15, 105, 360, 960, 1440].map((minutes) => minutes * 60_000));
  assert.equal((await run()).status, "insufficient_data", "durable replay follows the same path");
  assert.equal(sleeps.length, 5, "cached sleeps do not restart on replay");
  const row = db.raw.prepare("SELECT status, error_code FROM company_analysis_runs").get();
  assert.equal(row?.status, "insufficient_data");
  assert.equal(row?.error_code, "yahoo_target_period_missing");
  db.close();
});

test("failed runs use bounded backoff and retain the original identity", async () => {
  const db = await databaseWithMemory();
  const repository = new D1CompanyAnalysisRepository(db);
  await repository.upsertRun(update);
  const now = Date.parse(oldTime);
  assert.equal((await repository.listBackfillCandidates(["MSFT"], 100, false, now + 14 * 60_000)).length, 0);
  const [candidate] = await repository.listBackfillCandidates(["MSFT"], 100, false, now + 15 * 60_000);
  assert.equal(candidate?.analysisId, update.analysisId);
  assert.equal(candidate?.recoveryAttempt, 1);
  assert.equal(candidate?.expectedUpdatedAt, oldTime);
  for (const [count, minutes] of [[1, 120], [2, 480]]) {
    db.raw.prepare("UPDATE company_analysis_runs SET recovery_count = ?").run(count!);
    assert.equal((await repository.listBackfillCandidates(["MSFT"], 100, false, now + (minutes! - 1) * 60_000)).length, 0);
    assert.equal((await repository.listBackfillCandidates(["MSFT"], 100, false, now + minutes! * 60_000)).length, 1);
  }
  db.raw.exec("UPDATE company_analysis_runs SET recovery_count = 3");
  assert.equal((await repository.listBackfillCandidates(["MSFT"], 100, false, now + 100 * 86400_000)).length, 0);
  assert.equal((await repository.getLatestRunSummary("MSFT")).errorCode, "RECOVERY_EXHAUSTED");
  db.close();
});

test("Yahoo refresh errors retain last-good data but never bypass target-period readiness", async () => {
  for (const hasTargetData of [false, true]) {
    const db = await databaseWithMemory();
    if (hasTargetData) seedFundamentals(db);
    let reachedAgent = false;
    const step: CompanyWorkflowStep = {
      async do<T>(name: string, configOrCallback: object | (() => Promise<T>), callback?: () => Promise<T>): Promise<T> {
        if (name.startsWith("yahoo-refresh-")) throw new Error("Yahoo unavailable after step retries");
        if (name === "company-agent-current-quarter") {
          reachedAgent = true;
          throw new Error("test stops at AI boundary");
        }
        const action = (typeof configOrCallback === "function" ? configOrCallback : callback!) as () => Promise<T>;
        return action();
      },
      async sleep() { assert.equal(hasTargetData, false, "accepted target snapshot needs no extra wait"); },
    };
    const run = () => executeCompanyAnalysisWorkflow(params, "refresh-failure", new Date(oldTime), step, envFor(db) as SecPipelineEnv);
    if (hasTargetData) await assert.rejects(run, /test stops at AI boundary/);
    else assert.equal((await run()).status, "insufficient_data");
    assert.equal(reachedAgent, hasTargetData);
    db.close();
  }
});

test("duplicate Cron ticks and lost create responses produce one recovery instance id", async () => {
  const db = await databaseWithMemory();
  await new D1CompanyAnalysisRepository(db).upsertRun(update);
  const created: Array<{ id: string; params: CompanyAnalysisWorkflowParams }> = [];
  const env = envFor(db, created);
  await Promise.all([runCompanyAnalysisSweep(env), runCompanyAnalysisSweep(env)]);
  assert.equal(created.length, 2);
  assert.equal(new Set(created.map((item) => item.id)).size, 1);
  assert.equal(created[0]!.params.analysisId, update.analysisId);
  env.COMPANY_ANALYSIS_WORKFLOW!.create = async (options) => { created.push(options); throw new Error("Network response lost"); };
  assert.deepEqual((await runCompanyAnalysisSweep(env)).failed, ["MSFT"]);
  assert.equal(created[2]!.id, created[0]!.id);
  db.close();
});

test("atomic begin is replayable but rejects competing, stale and active recovery attempts", async () => {
  const db = await databaseWithMemory();
  const repository = new D1CompanyAnalysisRepository(db);
  await repository.upsertRun(update);
  const starting = { ...update, workflowInstanceId: "recovery-1", updatedAt: "2026-09-02T00:00:00.000Z" };
  assert.equal(await repository.beginRun(starting, 1, oldTime), true);
  assert.equal(await repository.beginRun(starting, 1, oldTime), true, "lost step response does not consume an extra attempt");
  assert.equal(await repository.beginRun({ ...starting, workflowInstanceId: "competing" }, 1, oldTime), false);
  assert.equal((await repository.listBackfillCandidates(["MSFT"], 100, true)).length, 0);
  assert.equal(db.raw.prepare("SELECT recovery_count FROM company_analysis_runs").get()?.recovery_count, 1);
  await repository.upsertRun({ ...update, workflowInstanceId: "old-owner" });
  assert.equal((await repository.getLatestRunSummary("MSFT")).state, "queued", "old owner cannot overwrite live state");
  await repository.upsertRun({ ...starting, status: "failed", updatedAt: "2026-09-03T00:00:00.000Z" });
  assert.equal(await repository.beginRun({ ...starting, workflowInstanceId: "stale" }, 1, oldTime), false);
  db.close();
});

test("missing target data stays dormant until a Yahoo revenue quarter actually aligns", async () => {
  const db = await databaseWithMemory();
  const repository = new D1CompanyAnalysisRepository(db);
  await repository.upsertRun({ ...update, status: "insufficient_data", errorCode: "yahoo_target_period_missing" });
  const created: Array<{ id: string; params: CompanyAnalysisWorkflowParams }> = [];
  const env = envFor(db, created);
  assert.deepEqual((await runCompanyAnalysisSweep(env)).started, []);
  seedFundamentals(db);
  db.raw.exec("UPDATE fundamental_observations SET period_end = '2026-03-31'");
  assert.deepEqual((await runCompanyAnalysisSweep(env)).started, [], "an old snapshot is not readiness");
  db.raw.exec("UPDATE fundamental_observations SET period_end = '2026-06-30'");
  assert.deepEqual((await runCompanyAnalysisSweep(env)).started, ["MSFT"]);
  assert.equal(created[0]!.params.recoveryAttempt, 0, "data waiting does not spend the failure budget");
  db.close();
});

test("reconciles confirmed platform death but never duplicates a sleeping or unknown workflow", async () => {
  for (const state of ["waiting", "running", "queued", "errored", "complete", "unknown"]) {
    const db = await databaseWithMemory();
    const repository = new D1CompanyAnalysisRepository(db);
    await repository.beginRun({ ...update, workflowInstanceId: "instance" }, 0);
    const env = envFor(db);
    env.COMPANY_ANALYSIS_WORKFLOW!.get = async () => ({ async status() {
      if (state === "unknown") throw new Error("status unavailable");
      return { status: state };
    } });
    await runCompanyAnalysisSweep(env);
    assert.equal((await repository.getLatestRunSummary("MSFT")).state,
      ["errored", "complete"].includes(state) ? "failed" : "queued", state);
    db.close();
  }
});

test("late status writes and stopped-execution checks never erase published content", async () => {
  const db = await databaseWithMemory();
  seedCompanyAnalysisPublication(db, { analysis_id: update.analysisId, trigger_ref: update.triggerRef, memory_version: 1 });
  const repository = new D1CompanyAnalysisRepository(db);
  const before = await repository.getLatestPublication("MSFT");
  await repository.upsertRun(update);
  await repository.markStoppedExecution(update.analysisId, "old", new Date().toISOString());
  assert.deepEqual(await repository.getLatestPublication("MSFT"), before);
  assert.equal(await repository.beginRun({ ...update, workflowInstanceId: "new" }, 1, oldTime), false);
  db.close();
});

test("public notices distinguish waiting, running, failure, exhaustion and last-good content", () => {
  const run = { state: "failed" as const, updatedAt: oldTime, errorCode: "Error" };
  assert.match(companyAnalysisNotice(run), /生成失败/);
  assert.match(companyAnalysisNotice({ ...run, errorCode: "yahoo_target_period_missing" }), /等待 Yahoo/);
  assert.match(companyAnalysisNotice({ ...run, state: "running" }), /正在生成/);
  assert.match(companyAnalysisNotice({ ...run, errorCode: "RECOVERY_EXHAUSTED" }), /重试已暂停/);
  assert.match(companyAnalysisNotice(run, true), /保留上一版/);
  assert.equal(shouldPollCompanyAnalysis(run), true);
  assert.equal(shouldPollCompanyAnalysis({ ...run, errorCode: "RECOVERY_EXHAUSTED" }), false);
  assert.equal(shouldPollCompanyAnalysis({ ...run, state: "succeeded" }), false);
});
