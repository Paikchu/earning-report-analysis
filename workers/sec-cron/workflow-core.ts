import { SEC_ANALYSIS_MODULES, SEC_ANALYSIS_SCHEMA_VERSION, type ModuleAnalysis, type RouterResult } from "../../lib/sec-analysis.ts";
import type {
  SecFiling,
  SecFilingSummary,
  SecNodePlan,
  SecNodeResult,
  SecNodeSpec,
  SecWorkflowTrace,
} from "../../lib/sec.ts";
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
  plan(filing: SecFiling, prepared: PreparedFilingReference): Promise<SecNodePlan>;
  analyzeNode(spec: SecNodeSpec, filing: SecFiling, prepared: PreparedFilingReference): Promise<SecNodeResult>;
  summarizeEvent(filing: SecFiling, prepared: PreparedFilingReference): Promise<SecFilingSummary>;
  summarize(filing: SecFiling, prepared: PreparedFilingReference, context: SecAnalysisContext, router: RouterResult, modules: ModuleAnalysis[], plan: SecNodePlan, nodes: SecNodeResult[]): Promise<{ artifact: SecAnalysisArtifact; summary: SecFilingSummary | null }>;
  publish(artifact: SecAnalysisArtifact, summary: SecFilingSummary | null): Promise<void>;
  publishEvent(summary: SecFilingSummary): Promise<void>;
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
      const eventFiling = /^(8-K|6-K)(\/A)?$/.test(filing.form);
      await step.do(`job:${accession}:start`, () => operations.updateJob({ ...baseJob, status: "running", currentStage: eventFiling ? "prepare" : "context", updatedAt: new Date().toISOString() }));
      if (eventFiling) {
        const prepared = await step.do(`prepare:${accession}`, () => operations.prepare(filing));
        await markJobStage(step, operations, baseJob, "event-summary");
        const summary = await step.do(`event-summary:${accession}`, () => operations.summarizeEvent(filing, prepared));
        await markJobStage(step, operations, baseJob, "publish");
        await step.do(`publish-event:${accession}`, () => operations.publishEvent(summary));
        await step.do(`job:${accession}:complete`, () => operations.updateJob({ ...baseJob, status: "complete", currentStage: "published", updatedAt: new Date().toISOString(), completedAt: new Date().toISOString() }));
        analyzed.push(accession);
        continue;
      }
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
      await markJobStage(step, operations, baseJob, "manager");
      const plan = await step.do(`manager:${accession}`, () => operations.plan(filing, prepared));
      if (!plan.nodes.length) throw new Error("Manager planned no analysis nodes");
      await markJobStage(step, operations, baseJob, "nodes");
      const nodes = await mapWithConcurrency(plan.nodes, 4, (spec, index) => step.do(
        `node:${accession}:${index}:${spec.id}`,
        () => operations.analyzeNode(spec, filing, prepared),
      ));
      await markJobStage(step, operations, baseJob, "synthesis");
      const result = await step.do(`synthesis:${accession}`, () => operations.summarize(filing, prepared, context, router, modules, plan, nodes));
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
      const summary = result.summary ? {
        ...result.summary,
        plan,
        nodes,
        workflow: buildWorkflowTrace(filing, plan, modules, nodes, result.summary),
      } : null;
      await markJobStage(step, operations, baseJob, "publish");
      await step.do(`publish:${accession}`, () => operations.publish(result.artifact, summary));
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

async function mapWithConcurrency<T, R>(values: T[], concurrency: number, operation: (value: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await operation(values[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function buildWorkflowTrace(
  filing: SecFiling,
  plan: SecNodePlan,
  modules: ModuleAnalysis[],
  nodes: SecNodeResult[],
  summary: SecFilingSummary,
): SecWorkflowTrace {
  const completedNodes = nodes.filter((node) => node.status === "complete").length;
  const verifiedModules = modules.filter((module) => module.verificationStatus !== "failed").length;
  return {
    version: 1,
    generatedAt: summary.generatedAt,
    nodes: [
      {
        id: "filing-selection",
        label: "申报文件定位",
        status: "complete",
        output: {
          summary: `已定位 ${filing.companyName} 最新一期 ${filing.form}。`,
          metrics: [
            { label: "报告期", value: filing.reportDate },
            { label: "提交日", value: filing.filingDate },
          ],
        },
      },
      {
        id: "document",
        label: "正文获取",
        status: "complete",
        output: { summary: "已获取并清洗 SEC 原始申报文件，正文通过 R2 引用在步骤间复用。" },
      },
      {
        id: "outline",
        label: "章节大纲",
        status: "complete",
        output: {
          summary: `已恢复 ${plan.outlineSections} 个有效章节并剔除目录重复项。`,
          metrics: [{ label: "有效章节", value: String(plan.outlineSections) }],
        },
      },
      {
        id: "manager-plan",
        label: "主编任务编排",
        status: "complete",
        output: {
          summary: `主编按本期内容拆出 ${plan.nodes.length} 个分析节点。`,
          metrics: [
            { label: "分析节点", value: String(plan.nodes.length) },
            { label: "护栏截断", value: String(plan.clamped ?? 0) },
          ],
          sections: plan.nodes.map((node) => ({
            name: node.title,
            characters: node.question.length,
            excerpt: `${node.question}\n章节：${node.sectionIds.join("、")}`,
          })),
        },
      },
      {
        id: "structured-verification",
        label: "结构化验证",
        status: verifiedModules ? "complete" : "error",
        output: {
          summary: `${verifiedModules}/${modules.length} 个结构化模块产出可用事实或比较。`,
          metrics: [
            { label: "可用模块", value: String(verifiedModules) },
            { label: "总模块", value: String(modules.length) },
          ],
        },
      },
      {
        id: "analysis-nodes",
        label: "动态分段分析",
        status: completedNodes ? "complete" : "error",
        output: {
          summary: `${completedNodes}/${nodes.length} 个动态节点完成分析。`,
          metrics: [
            { label: "完成", value: String(completedNodes) },
            { label: "失败或空白", value: String(nodes.length - completedNodes) },
          ],
          sections: nodes.map((node) => ({
            name: node.title,
            characters: node.narrative.length,
            excerpt: node.error || node.narrative.slice(0, 560),
            evidence: node.evidence,
          })),
        },
      },
      {
        id: "synthesis",
        label: "总编汇总",
        status: summary.report ? "complete" : "error",
        output: {
          summary: summary.headline || "总编未生成有效标题。",
          metrics: [
            { label: "核心结论", value: String(summary.bullets.length) },
            { label: "正文字符", value: String(summary.report?.length ?? 0) },
            { label: "摘要版本", value: String(summary.version ?? 0) },
          ],
          excerpt: summary.analystView,
        },
      },
      {
        id: "persistence",
        label: "结果入库",
        status: "complete",
        output: {
          summary: "完整研报、分段分析与节点轨迹写入同一条 D1 摘要记录。",
          metrics: [
            { label: "股票代码", value: summary.ticker },
            { label: "Accession", value: summary.accessionNumber },
          ],
        },
      },
    ],
  };
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
