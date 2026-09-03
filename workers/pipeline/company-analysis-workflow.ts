import {
  COMPANY_ANALYSIS_PROMPT_VERSION,
  COMPANY_ANALYSIS_SCHEMA_VERSION,
  normalizeCompanyAnalysisPublication,
} from "../../lib/company-analysis/contracts.ts";
import { COMPANY_FEATURE_FORMULA_VERSION } from "../../lib/company-analysis/feature-engine.ts";
import type { CompanyAnalysisPacket } from "../../lib/company-analysis/packet.ts";
import { sha256 } from "../../lib/company-analysis/api.ts";
import { hashString } from "../../lib/sec-analysis.ts";
import { serviceFetcher } from "../../lib/service-binding.ts";
import type { CompanyAnalysisWorkflowParams } from "./core.ts";
import { runCompanyAnalysisAgent } from "./company-analysis-agent.ts";
import { sitePost, type SecPipelineEnv } from "./operations.ts";

const READINESS_DELAYS = [0, 15 * 60_000, 2 * 60 * 60_000, 8 * 60 * 60_000, 24 * 60 * 60_000, 48 * 60 * 60_000] as const;

export type CompanyWorkflowStep = {
  do<T>(name: string, callback: () => Promise<T>): Promise<T>;
  do<T>(name: string, config: CompanyWorkflowStepConfig, callback: () => Promise<T>): Promise<T>;
  sleepUntil(name: string, timestamp: Date | number): Promise<void>;
};

type CompanyWorkflowStepConfig = {
  retries: {
    limit: number;
    delay: string;
    backoff: "exponential";
  };
  timeout: string;
};

/**
 * One Agent run intentionally contains several sequential model turns: the isolated current-quarter
 * diagnostic, up to four evidence-inspection rounds, and the final editorial pass. Keep those turns
 * in one durable step so a retry restarts the coherent Agent session, but give the step enough wall
 * time for the provider's per-call timeout budget. Cloudflare caps an explicit step timeout at 30m.
 */
export const COMPANY_AGENT_STEP_CONFIG = {
  retries: {
    limit: 3,
    delay: "1 minute",
    backoff: "exponential",
  },
  timeout: "30 minutes",
} as const satisfies CompanyWorkflowStepConfig;

export async function executeCompanyAnalysisWorkflow(
  params: CompanyAnalysisWorkflowParams,
  workflowInstanceId: string,
  createdAt: Date,
  step: CompanyWorkflowStep,
  env: SecPipelineEnv,
  fetcher: typeof fetch = fetch,
  siteFetch: typeof fetch = serviceFetcher(env.WEB, fetcher),
) {
  const analysisId = params.analysisId || `company:${params.ticker}:${hashString(`${params.triggerRef}:${workflowInstanceId}`)}`;
  const modelVersion = env.SEC_REASONING_MODEL || env.SEC_ANALYSIS_MODEL || "glm-5.3-flash";
  const statusBase = {
    analysisId,
    ticker: params.ticker,
    triggerRef: params.triggerRef,
    periodId: params.periodId,
    memoryVersion: params.memoryVersion,
    modelVersion,
    promptVersion: COMPANY_ANALYSIS_PROMPT_VERSION,
  };
  try {
    await step.do("company-run-created", () => updateStatus(env, siteFetch, { ...statusBase, status: "waiting_fundamentals" }));
    let currentPacket: CompanyAnalysisPacket | null = null;
    for (let index = 0; index < READINESS_DELAYS.length; index += 1) {
      const delay = READINESS_DELAYS[index]!;
      if (delay > 0) {
        await step.sleepUntil(`yahoo-readiness-${readinessLabel(delay)}`, createdAt.getTime() + delay);
      }
      await step.do(`yahoo-refresh-${String(index).padStart(2, "0")}`, () => sitePost(env, siteFetch, "/api/internal/fundamentals/refresh", {
        ticker: params.ticker,
        targetPeriodEnd: params.reportDate,
        triggerRef: params.triggerRef,
      }));
      currentPacket = await step.do(`current-quarter-packet-${String(index).padStart(2, "0")}`, () => readPacket(env, siteFetch, params, "current_quarter"));
      if (currentPacket.ready) break;
    }
    if (!currentPacket?.ready || !currentPacket.features || !currentPacket.fundamentalsDataVersion) {
      await step.do("company-run-insufficient", () => updateStatus(env, siteFetch, {
        ...statusBase,
        status: "insufficient_data",
        errorCode: currentPacket?.reason || "yahoo_target_period_missing",
      }));
      return { status: "insufficient_data", reason: currentPacket?.reason ?? "yahoo_target_period_missing" };
    }

    const crossPeriodPacket = await step.do("cross-period-packet", () => readPacket(env, siteFetch, params, "cross_period"));
    if (!crossPeriodPacket.ready || !crossPeriodPacket.features) throw new Error("Cross-period packet is not ready.");
    const inputHash = await sha256(JSON.stringify({
      ticker: params.ticker,
      periodId: params.periodId,
      memoryVersion: params.memoryVersion,
      fundamentalsDataVersion: currentPacket.fundamentalsDataVersion,
      featureFormulaVersion: COMPANY_FEATURE_FORMULA_VERSION,
      skillVersion: COMPANY_ANALYSIS_PROMPT_VERSION,
      modelVersion,
      schemaVersion: COMPANY_ANALYSIS_SCHEMA_VERSION,
    }));
    const generatedAt = new Date().toISOString();
    await step.do("company-run-analyzing", () => updateStatus(env, siteFetch, {
      ...statusBase,
      analysisId,
      inputHash,
      fundamentalsDataVersion: currentPacket!.fundamentalsDataVersion!,
      status: "analyzing",
    }));
    const output = await step.do("company-agent", COMPANY_AGENT_STEP_CONFIG, () => runCompanyAnalysisAgent({
      env,
      fetcher,
      currentPacket: currentPacket!,
      crossPeriodPacket,
      analysisId,
      generatedAt,
    }));
    await step.do("company-run-validating", () => updateStatus(env, siteFetch, {
      ...statusBase,
      analysisId,
      inputHash,
      fundamentalsDataVersion: currentPacket!.fundamentalsDataVersion!,
      status: "validating",
    }));

    const runKey = `company-analysis/${params.ticker}/${analysisId}/run.json`;
    await step.do("company-artifact", () => env.SEC_FILINGS.put(runKey, JSON.stringify({
      params,
      inputHash,
      currentPacket,
      crossPeriodPacket,
      diagnostic: output.diagnostic,
      decision: output.decision,
      overview: output.overview,
      rounds: output.rounds,
      generatedAt,
    }), { httpMetadata: { contentType: "application/json" } }).then(() => undefined));
    const publication = normalizeCompanyAnalysisPublication({
      schemaVersion: COMPANY_ANALYSIS_SCHEMA_VERSION,
      analysisId,
      ticker: params.ticker,
      triggerRef: params.triggerRef,
      periodId: params.periodId,
      periodEnd: currentPacket.targetPeriodEnd,
      reportLabel: formatReportLabel(currentPacket.targetPeriodEnd!),
      inputHash,
      memoryVersion: params.memoryVersion,
      fundamentalsDataVersion: currentPacket.fundamentalsDataVersion,
      status: "ready",
      coverageStatus: currentPacket.features.missingMetricKeys.length ? "partial" : "complete",
      overview: output.overview,
      modelVersion,
      promptVersion: COMPANY_ANALYSIS_PROMPT_VERSION,
      generatedAt,
    });
    const published = await step.do("company-publish", () => sitePost<{ status: string; analysisId: string }>(
      env,
      siteFetch,
      "/api/internal/company-analysis/publish",
      publication,
    ));
    return { status: published.status, analysisId, inputHash, rounds: output.rounds };
  } catch (error) {
    await step.do("company-run-failed", () => updateStatus(env, siteFetch, {
      ...statusBase,
      status: "failed",
      errorCode: error instanceof Error ? error.name : "COMPANY_ANALYSIS_FAILED",
      errorDetail: error instanceof Error ? error.message : String(error),
    })).catch(() => undefined);
    throw error;
  }
}

function readPacket(
  env: SecPipelineEnv,
  fetcher: typeof fetch,
  params: CompanyAnalysisWorkflowParams,
  packetStage: "current_quarter" | "cross_period",
): Promise<CompanyAnalysisPacket> {
  return sitePost<{ packet: CompanyAnalysisPacket }>(env, fetcher, "/api/internal/company-analysis/packet", {
    ticker: params.ticker,
    periodId: params.periodId,
    memoryVersion: params.memoryVersion,
    packetStage,
  }).then((result) => result.packet);
}

function updateStatus(env: SecPipelineEnv, fetcher: typeof fetch, value: Record<string, unknown>): Promise<void> {
  return sitePost(env, fetcher, "/api/internal/company-analysis/status", {
    ...value,
    updatedAt: new Date().toISOString(),
  }).then(() => undefined);
}

function readinessLabel(delay: number): string {
  if (delay === 15 * 60_000) return "15m";
  if (delay === 2 * 60 * 60_000) return "02h";
  if (delay === 8 * 60 * 60_000) return "08h";
  if (delay === 24 * 60 * 60_000) return "24h";
  return "48h";
}

function formatReportLabel(periodEnd: string): string {
  const [year, month, day] = periodEnd.split("-");
  return `截至 ${year}年${Number(month)}月${Number(day)}日`;
}
