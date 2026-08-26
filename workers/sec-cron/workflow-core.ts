import {
  MAX_REPAIR_NODES_PER_ROUND,
  MAX_REPAIR_ROUNDS,
  buildClaimLedger,
  buildSecAnalysisBrief,
  SEC_ANALYSIS_MODULES,
  SEC_ANALYSIS_SCHEMA_VERSION,
  unresolvedFingerprint,
  verifyClaimLedger,
  type ClaimCheckResult,
  type ClaimLedger,
  type ManagerRepairTask,
  type ManagerReview,
  type ModuleAnalysis,
  type RouterResult,
  type SecAnalysisBrief,
} from "../../lib/sec-analysis.ts";
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
import { modelExecutionForAttempt, type SecModelExecution } from "./retry-policy.ts";

export type WorkflowStepContextLike = {
  attempt: number;
};

export type WorkflowStepLike = {
  do<T>(name: string, callback: (context?: WorkflowStepContextLike) => Promise<T>): Promise<T>;
};

function executionFor(context?: WorkflowStepContextLike): SecModelExecution {
  return modelExecutionForAttempt(context?.attempt ?? 1);
}

export type ManagerRepairLoopRuntime = {
  review(round: number, nodes: SecNodeResult[], execution?: SecModelExecution): Promise<ManagerReview>;
  repair(task: ManagerRepairTask, round: number, execution?: SecModelExecution): Promise<SecNodeResult>;
};

export async function runManagerRepairLoop(
  accessionNumber: string,
  step: WorkflowStepLike,
  _plan: SecNodePlan,
  initialNodes: SecNodeResult[],
  runtime: ManagerRepairLoopRuntime,
): Promise<{ nodes: SecNodeResult[]; review: ManagerReview; rounds: number }> {
  const nodes = [...initialNodes];
  let rounds = 0;
  let review = await step.do(`manager-review:${accessionNumber}:round:0`, (context) => runtime.review(0, nodes, executionFor(context)));
  let previousFingerprint = unresolvedFingerprint(review);
  while (review.status === "needs_repair" && rounds < MAX_REPAIR_ROUNDS) {
    const tasks = review.repairTasks.slice(0, MAX_REPAIR_NODES_PER_ROUND);
    if (!tasks.length) {
      review = { ...review, status: "partial", stopReason: "analysis_incomplete" };
      break;
    }
    rounds += 1;
    const repaired: SecNodeResult[] = [];
    for (const [index, task] of tasks.entries()) {
      repaired.push(await step.do(
        `repair-node:${accessionNumber}:round:${rounds}:${index}:${task.id}`,
        (context) => runtime.repair(task, rounds, executionFor(context)),
      ));
    }
    for (const result of repaired) {
      const index = nodes.findIndex((node) => node.id === result.id);
      if (index >= 0) nodes[index] = result;
      else nodes.push(result);
    }
    review = await step.do(`manager-review:${accessionNumber}:round:${rounds}`, (context) => runtime.review(rounds, nodes, executionFor(context)));
    const fingerprint = unresolvedFingerprint(review);
    if (review.status === "needs_repair" && fingerprint === previousFingerprint) {
      review = { ...review, status: "partial", repairTasks: [], stopReason: "no_progress" };
      break;
    }
    previousFingerprint = fingerprint;
  }
  if (review.status === "needs_repair") review = { ...review, status: "partial", repairTasks: [], stopReason: "max_rounds" };
  if (review.status === "partial" && !review.stopReason) review = { ...review, stopReason: "analysis_incomplete" };
  return { nodes, review, rounds };
}

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
  route(filing: SecFiling, prepared: PreparedFilingReference, context: SecAnalysisContext, execution?: SecModelExecution): Promise<RouterResult>;
  analyzeModule(moduleKey: ModuleAnalysis["moduleKey"], filing: SecFiling, prepared: PreparedFilingReference, context: SecAnalysisContext, router: RouterResult, execution?: SecModelExecution): Promise<ModuleAnalysis>;
  buildBrief?(filing: SecFiling, prepared: PreparedFilingReference, context: SecAnalysisContext, modules: ModuleAnalysis[]): Promise<SecAnalysisBrief>;
  plan(filing: SecFiling, prepared: PreparedFilingReference, brief?: SecAnalysisBrief, execution?: SecModelExecution): Promise<SecNodePlan>;
  analyzeNode(spec: SecNodeSpec, filing: SecFiling, prepared: PreparedFilingReference, brief?: SecAnalysisBrief, round?: number, execution?: SecModelExecution): Promise<SecNodeResult>;
  review?(filing: SecFiling, prepared: PreparedFilingReference, brief: SecAnalysisBrief, plan: SecNodePlan, nodes: SecNodeResult[], round: number, execution?: SecModelExecution): Promise<ManagerReview>;
  buildClaimLedger?(filing: SecFiling, prepared: PreparedFilingReference, brief: SecAnalysisBrief, nodes: SecNodeResult[]): Promise<ClaimLedger>;
  summarizeEvent(filing: SecFiling, prepared: PreparedFilingReference, execution?: SecModelExecution): Promise<SecFilingSummary>;
  summarize(filing: SecFiling, prepared: PreparedFilingReference, context: SecAnalysisContext, router: RouterResult, modules: ModuleAnalysis[], plan: SecNodePlan, nodes: SecNodeResult[], brief?: SecAnalysisBrief, review?: ManagerReview, ledger?: ClaimLedger, execution?: SecModelExecution): Promise<{ artifact: SecAnalysisArtifact; summary: SecFilingSummary | null }>;
  repairSynthesis?(filing: SecFiling, prepared: PreparedFilingReference, context: SecAnalysisContext, router: RouterResult, modules: ModuleAnalysis[], plan: SecNodePlan, nodes: SecNodeResult[], brief: SecAnalysisBrief, review: ManagerReview, ledger: ClaimLedger, failedCheck: ClaimCheckResult, execution?: SecModelExecution): Promise<{ artifact: SecAnalysisArtifact; summary: SecFilingSummary | null }>;
  checkClaims?(artifact: SecAnalysisArtifact, ledger: ClaimLedger, summary: SecFilingSummary | null, execution?: SecModelExecution): Promise<ClaimCheckResult>;
  publish(artifact: SecAnalysisArtifact, summary: SecFilingSummary | null): Promise<void | { memoryJobId?: string }>;
  enqueueMemory?(jobId: string, ticker: string): Promise<void>;
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
        const summary = await step.do(`event-summary:${accession}`, (context) => operations.summarizeEvent(filing, prepared, executionFor(context)));
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
      const router = await step.do(`router:${accession}`, (stepContext) => operations.route(filing, prepared, context, executionFor(stepContext)));
      await markJobStage(step, operations, baseJob, "modules");
      const modules = await Promise.all(SEC_ANALYSIS_MODULES.map(async (module) => {
        try {
          return await step.do(
            `module:${accession}:${module.key}`,
            (stepContext) => operations.analyzeModule(module.key, filing, prepared, context, router, executionFor(stepContext)),
          );
        } catch {
          return {
            moduleKey: module.key,
            facts: [],
            claims: [],
            memoryCandidates: [],
            missingFields: [...module.fields],
            evidenceCoverage: 0,
            verificationStatus: "failed" as const,
          };
        }
      }));
      await markJobStage(step, operations, baseJob, "brief");
      const brief = await step.do(`brief:${accession}`, async () => operations.buildBrief
        ? operations.buildBrief(filing, prepared, context, modules)
        : buildFallbackBrief(filing, context, modules));
      assertBriefCanProceed(brief);
      await markJobStage(step, operations, baseJob, "manager");
      const plan = await step.do(`manager:${accession}`, (stepContext) => operations.plan(filing, prepared, brief, executionFor(stepContext)));
      if (!plan.nodes.length) throw new Error("Manager planned no analysis nodes");
      await markJobStage(step, operations, baseJob, "nodes-round-0");
      const nodes = await mapWithConcurrency(plan.nodes, 4, (spec, index) => step.do(
        `node:${accession}:round:0:${index}:${spec.id}`,
        (stepContext) => operations.analyzeNode(spec, filing, prepared, brief, 0, executionFor(stepContext)),
      ));
      await markJobStage(step, operations, baseJob, "manager-review");
      const loop = await runManagerRepairLoop(accession, step, plan, nodes, {
        review: (round, currentNodes, execution) => operations.review
          ? operations.review(filing, prepared, brief, plan, currentNodes, round, execution)
          : Promise.resolve(fallbackManagerReview(plan, currentNodes)),
        repair: (task, round, execution) => operations.analyzeNode({ ...task, id: task.targetNodeId }, filing, prepared, brief, round, execution),
      });
      const managerReview: ManagerReview = brief.evidenceQuality.failedModules.length
        ? {
          ...loop.review,
          status: "partial",
          unresolvedQuestions: [...new Set([
            ...loop.review.unresolvedQuestions,
            ...brief.evidenceQuality.failedModules.map((moduleKey) => `module:${moduleKey}`),
          ])],
          stopReason: loop.review.stopReason === "no_progress" || loop.review.stopReason === "max_rounds"
            ? loop.review.stopReason
            : "analysis_incomplete",
        }
        : loop.review;
      await markJobStage(step, operations, baseJob, "claim-ledger");
      const ledger = await step.do(`claim-ledger:${accession}`, () => operations.buildClaimLedger
        ? operations.buildClaimLedger(filing, prepared, brief, loop.nodes)
        : Promise.resolve(buildClaimLedger(brief, loop.nodes.map((node) => ({ id: node.id, findings: node.findings, narrative: node.narrative, evidenceIds: node.evidenceIds })), [])));
      await markJobStage(step, operations, baseJob, "synthesis");
      let result = await step.do(`synthesis:${accession}`, (stepContext) => operations.summarize(filing, prepared, context, router, modules, plan, loop.nodes, brief, managerReview, ledger, executionFor(stepContext)));
      await markJobStage(step, operations, baseJob, "claim-check");
      let claimCheck = await step.do(`claim-check:${accession}:attempt:0`, (stepContext) => operations.checkClaims
        ? operations.checkClaims(result.artifact, ledger, result.summary, executionFor(stepContext))
        : Promise.resolve(verifyClaimLedger(ledger, result.artifact.report.keyMetrics)));
      if (claimCheck.status === "failed") {
        if (!operations.repairSynthesis) throw new Error("Claim verification failed after synthesis");
        result = await step.do(`synthesis-repair:${accession}`, (stepContext) => operations.repairSynthesis!(filing, prepared, context, router, modules, plan, loop.nodes, brief, managerReview, ledger, claimCheck, executionFor(stepContext)));
        claimCheck = await step.do(`claim-check:${accession}:attempt:1`, (stepContext) => operations.checkClaims
          ? operations.checkClaims(result.artifact, ledger, result.summary, executionFor(stepContext))
          : Promise.resolve(verifyClaimLedger(ledger, result.artifact.report.keyMetrics)));
        if (claimCheck.status === "failed") throw new Error("Claim verification failed after synthesis repair");
      }
      result.artifact.report.dataQuality = {
        ...result.artifact.report.dataQuality,
        analysisStatus: managerReview.status === "complete" ? "complete" : "partial",
        unresolvedQuestions: managerReview.unresolvedQuestions,
        failedNodeIds: loop.nodes.filter((node) => node.status !== "complete").map((node) => node.id),
        stopReason: managerReview.stopReason,
        managerCoverageScore: managerReview.coverageScore,
      };
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
        nodes: loop.nodes,
        managerReview,
        repairRounds: loop.rounds,
        workflow: buildWorkflowTrace(filing, plan, modules, loop.nodes, result.summary),
      } : null;
      await markJobStage(step, operations, baseJob, "publish");
      const publication = await step.do(`publish:${accession}`, () => operations.publish(result.artifact, summary));
      await step.do(`job:${accession}:complete`, () => operations.updateJob({ ...baseJob, status: "complete", currentStage: "published", updatedAt: new Date().toISOString(), completedAt: new Date().toISOString() }));
      if (publication && publication.memoryJobId && operations.enqueueMemory) {
        await step.do(`memory-enqueue:${accession}`, async () => {
          try {
            await operations.enqueueMemory!(publication.memoryJobId!, filing.ticker);
          } catch {
            return;
          }
        });
      }
      analyzed.push(accession);
    } catch (error) {
      const detail = error instanceof Error ? error.message.slice(0, 500) : "Unknown pipeline error";
      const hardFailure = /No core facts|illegal evidence|Conflicting (fact|history) units|Manager[- ](Review|planned)|Claim verification|Synthesis|final publish|R2 memory source/i.test(detail);
      await step.do(`job:${accession}:error`, () => operations.updateJob({
        ...baseJob,
        status: "failed",
        currentStage: "execution",
        errorCode: hardFailure ? "hard_failure" : "pipeline_error",
        errorDetail: detail,
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

function buildFallbackBrief(filing: SecFiling, context: SecAnalysisContext, modules: ModuleAnalysis[]): SecAnalysisBrief {
  return buildSecAnalysisBrief({
    ticker: filing.ticker,
    filingId: filing.accessionNumber,
    periodId: context.currentPeriodId,
    periodScope: /^(10-K|20-F)/.test(filing.form) ? "annual" : "quarter",
    modules,
    history: context.history ?? { registryVersion: "sec-canonical-series.v1", series: [] },
    memorySummary: context.companyMemorySummary ?? "",
    memoryItems: context.memoryItems ?? [],
    validEvidenceIds: new Set(modules.flatMap((module) => [...module.facts, ...module.claims].flatMap((item) => item.evidenceIds))),
  });
}

function assertBriefCanProceed(brief: SecAnalysisBrief): void {
  if (!brief.currentFacts.length) throw new Error("No core facts passed factual verification");
  if (brief.evidenceQuality.invalidEvidenceIds.length) throw new Error("Brief contains illegal evidence IDs");
  const identities = new Map<string, string>();
  for (const fact of brief.currentFacts) {
    const key = `${fact.metricKey}:${fact.periodScope ?? brief.periodId}:${fact.basis}`;
    const unit = `${fact.unit}:${fact.currency ?? ""}`;
    const previous = identities.get(key);
    if (previous && previous !== unit) throw new Error(`Conflicting fact units for ${fact.metricKey}`);
    identities.set(key, unit);
  }
  for (const series of brief.history.series) {
    for (const observation of [...series.quarters, ...series.annual]) {
      const key = `history:${series.seriesId}:${observation.periodScope}:${observation.startDate ?? "instant"}:${observation.endDate}:${observation.basis}`;
      const unit = `${observation.unit}:${observation.currency ?? ""}`;
      const previous = identities.get(key);
      if (previous && previous !== unit) throw new Error(`Conflicting history units for ${series.seriesId}`);
      identities.set(key, unit);
    }
  }
}

function fallbackManagerReview(plan: SecNodePlan, nodes: SecNodeResult[]): ManagerReview {
  const results = new Map(nodes.map((node) => [node.id, node]));
  const questions = plan.nodes.map((node) => {
    const result = results.get(node.id);
    const answered = result?.status === "complete" && Boolean(result.narrative || result.findings.length);
    return { questionId: node.id, status: answered ? "answered" as const : "unanswered" as const, explanation: answered ? "Node completed" : result?.error ?? "Node incomplete" };
  });
  const unresolvedQuestions = plan.nodes.filter((_node, index) => questions[index].status !== "answered").map((node) => node.question);
  return {
    status: unresolvedQuestions.length ? "partial" : "complete",
    questions,
    repairTasks: [],
    unresolvedQuestions,
    coverageScore: questions.length ? questions.filter((question) => question.status === "answered").length / questions.length : 0,
    stopReason: unresolvedQuestions.length ? "analysis_incomplete" : "complete",
  };
}
