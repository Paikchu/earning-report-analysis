import { SEC_ANALYSIS_MODULES, SEC_ANALYSIS_SCHEMA_VERSION, type ModuleAnalysis, type RouterResult } from "../../lib/sec-analysis.ts";
import type { SecFiling, SecFilingSummary } from "../../lib/sec.ts";
import type { SecAnalysisArtifact, SecAnalysisContext } from "../../lib/sec-service.ts";
import type { SecWorkflowParams } from "./core.ts";

export type WorkflowStepLike = {
  do<T>(name: string, callback: () => Promise<T>): Promise<T>;
};

export type PreparedFilingReference = {
  key: string;
  filing: SecFiling;
};

export type WorkflowJobUpdate = {
  jobId: string;
  ticker: string;
  accessionNumber: string;
  analysisVersion: string;
  status: "queued" | "running" | "complete" | "failed";
  currentStage: string;
  attempt: number;
  errorCode?: string;
  errorDetail?: string;
  requestedBy: SecWorkflowParams["requestedBy"];
  workflowInstanceId: string;
  updatedAt: string;
  completedAt?: string;
};

export type SecPipelineOperations = {
  discover(ticker: string): Promise<{ feed: unknown; filings: SecFiling[] }>;
  publishFeed(feed: unknown): Promise<void>;
  shouldAnalyze(filing: SecFiling, requestedBy: SecWorkflowParams["requestedBy"]): Promise<boolean>;
  getContext(filing: SecFiling): Promise<SecAnalysisContext>;
  prepare(filing: SecFiling): Promise<PreparedFilingReference>;
  route(filing: SecFiling, prepared: PreparedFilingReference, context: SecAnalysisContext): Promise<RouterResult>;
  analyzeModule(moduleKey: ModuleAnalysis["moduleKey"], filing: SecFiling, prepared: PreparedFilingReference, context: SecAnalysisContext, router: RouterResult): Promise<ModuleAnalysis>;
  summarize(filing: SecFiling, prepared: PreparedFilingReference, context: SecAnalysisContext, router: RouterResult, modules: ModuleAnalysis[]): Promise<{ artifact: SecAnalysisArtifact; summary: SecFilingSummary | null }>;
  publish(artifact: SecAnalysisArtifact, summary: SecFilingSummary | null): Promise<void>;
  updateJob(job: WorkflowJobUpdate): Promise<void>;
};

export async function executeSecAnalysisWorkflow(
  params: SecWorkflowParams,
  workflowInstanceId: string,
  step: WorkflowStepLike,
  operations: SecPipelineOperations,
) {
  const discovery = await step.do("discover", () => operations.discover(params.ticker));
  await step.do("publish-feed", () => operations.publishFeed(discovery.feed));
  const analyzed: string[] = [];
  const skipped: string[] = [];
  const failed: string[] = [];

  for (const filing of discovery.filings) {
    const accession = filing.accessionNumber;
    const jobId = `${filing.ticker}:${accession}:${SEC_ANALYSIS_SCHEMA_VERSION}:${workflowInstanceId}`;
    const baseJob = {
      jobId,
      ticker: filing.ticker,
      accessionNumber: accession,
      analysisVersion: SEC_ANALYSIS_SCHEMA_VERSION,
      attempt: 1,
      requestedBy: params.requestedBy,
      workflowInstanceId,
    } as const;
    try {
      const shouldAnalyze = await step.do(`status:${accession}`, () => operations.shouldAnalyze(filing, params.requestedBy));
      if (!shouldAnalyze) {
        skipped.push(accession);
        continue;
      }
      await step.do(`job:${accession}:start`, () => operations.updateJob({ ...baseJob, status: "running", currentStage: "context", updatedAt: new Date().toISOString() }));
      const context = await step.do(`context:${accession}`, () => operations.getContext(filing));
      await markJobStage(step, operations, baseJob, "prepare");
      const prepared = await step.do(`prepare:${accession}`, () => operations.prepare(filing));
      await markJobStage(step, operations, baseJob, "router");
      const router = await step.do(`router:${accession}`, () => operations.route(filing, prepared, context));
      await markJobStage(step, operations, baseJob, "modules");
      const modules = await Promise.all(SEC_ANALYSIS_MODULES.map((module) => step.do(
        `module:${accession}:${module.key}`,
        () => operations.analyzeModule(module.key, filing, prepared, context, router),
      )));
      await markJobStage(step, operations, baseJob, "summary");
      const result = await step.do(`summary:${accession}`, () => operations.summarize(filing, prepared, context, router, modules));
      if (result.artifact.report.dataQuality.verificationStatus === "failed") {
        await step.do(`job:${accession}:failed`, () => operations.updateJob({
          ...baseJob,
          status: "failed",
          currentStage: "verification",
          errorCode: "verification_failed",
          errorDetail: result.artifact.report.dataQuality.warnings.join("; ").slice(0, 500),
          updatedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        }));
        failed.push(accession);
        continue;
      }
      await markJobStage(step, operations, baseJob, "publish");
      await step.do(`publish:${accession}`, () => operations.publish(result.artifact, result.summary));
      await step.do(`job:${accession}:complete`, () => operations.updateJob({ ...baseJob, status: "complete", currentStage: "published", updatedAt: new Date().toISOString(), completedAt: new Date().toISOString() }));
      analyzed.push(accession);
    } catch (error) {
      await step.do(`job:${accession}:error`, () => operations.updateJob({
        ...baseJob,
        status: "failed",
        currentStage: "execution",
        errorCode: "pipeline_error",
        errorDetail: error instanceof Error ? error.message.slice(0, 500) : "Unknown pipeline error",
        updatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      }));
      failed.push(accession);
    }
  }
  return { analyzed, skipped, failed };
}

function markJobStage(
  step: WorkflowStepLike,
  operations: SecPipelineOperations,
  baseJob: Omit<WorkflowJobUpdate, "status" | "currentStage" | "updatedAt">,
  currentStage: string,
) {
  return step.do(`job:${baseJob.accessionNumber}:stage:${currentStage}`, () => operations.updateJob({
    ...baseJob,
    status: "running",
    currentStage,
    updatedAt: new Date().toISOString(),
  }));
}
