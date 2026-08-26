import type { SecMemoryJobClaim } from "../../lib/sec-d1.ts";
import { normalizeMemoryExtraction } from "../../lib/sec-memory.ts";
import type { SecMemoryWorkflowParams } from "./core.ts";
import { callWorkerSecModel, sitePost, type SecPipelineEnv } from "./operations.ts";
import { modelExecutionForAttempt } from "./retry-policy.ts";
import type { WorkflowStepLike } from "./workflow-core.ts";

export async function executeSecMemoryWorkflow(
  params: SecMemoryWorkflowParams,
  workflowInstanceId: string,
  step: WorkflowStepLike,
  env: SecPipelineEnv,
  fetcher: typeof fetch = fetch,
) {
  const ownerToken = params.ownerToken || `${workflowInstanceId}:${crypto.randomUUID()}`;
  const claimed = await step.do(`memory-claim:${params.jobId}`, () => sitePost<{ claim: SecMemoryJobClaim | null }>(env, fetcher, "/api/internal/sec/memory/claim", {
    jobId: params.jobId,
    ownerToken,
  }));
  if (!claimed.claim) return { status: "no-op", jobId: params.jobId };
  const claim = claimed.claim;
  const source = await step.do(`memory-source:${params.jobId}`, async () => {
    const object = await env.SEC_FILINGS.get(claim.sourceR2Key);
    if (!object) throw new Error(`Memory source not found: ${claim.sourceR2Key}`);
    return JSON.parse(await object.text()) as Record<string, unknown>;
  });
  const validEvidenceIds = collectValidEvidenceIds(source);
  const extraction = await step.do(`memory-extract:${params.jobId}`, async (context) => {
    const execution = modelExecutionForAttempt(context?.attempt ?? 1);
    const value = await callWorkerSecModel(env, fetcher, "memory-extract", memoryExtractionSystemPrompt(), compactMemorySource(source), execution.model);
    return normalizeMemoryExtraction(value, validEvidenceIds);
  });
  const committed = await step.do(`memory-commit:${params.jobId}`, () => sitePost<{ status: string; noOp: boolean; itemCount: number }>(env, fetcher, "/api/internal/sec/memory/commit", {
    claim,
    extraction,
  }));
  return { status: committed.status, jobId: params.jobId, noOp: committed.noOp, itemCount: committed.itemCount };
}

function compactMemorySource(source: Record<string, unknown>) {
  const artifact = record(source.artifact);
  const summary = record(source.summary);
  const brief = record(artifact?.brief);
  const review = record(artifact?.managerReview) ?? record(summary?.managerReview);
  return {
    task: "Extract durable company memory from verified filing analysis inputs.",
    facts: brief?.currentFacts ?? [],
    comparisons: brief?.comparisons ?? [],
    claims: brief?.currentClaims ?? [],
    nodeFindings: Array.isArray(summary?.nodes) ? summary.nodes : [],
    unresolvedItems: review?.unresolvedQuestions ?? [],
    priorMemory: brief?.memoryItems ?? [],
    rules: [
      "Keep only facts or falsifiable judgments that can affect a future filing assessment.",
      "Every candidate must cite supplied evidence IDs.",
      "A judgment requires horizon, nextTest, and falsifier.",
      "Omission is stale, never resolved. Use resolved only for explicit fulfillment and contradicted only for explicit contrary evidence.",
    ],
    outputSchema: {
      candidates: "[{candidateId,kind:fact|judgment,topicKey,statement,evidenceIds,materialityScore,confidence,horizon,nextTest,falsifier,disposition}]",
    },
  };
}

function collectValidEvidenceIds(source: Record<string, unknown>): Set<string> {
  const artifact = record(source.artifact);
  const ledger = record(artifact?.claimLedger);
  return new Set(Array.isArray(ledger?.validEvidenceIds) ? ledger.validEvidenceIds.map(String) : []);
}

function memoryExtractionSystemPrompt() {
  return [
    "You are Phase 1 of a company filing memory system.",
    "Perform one strict structured extraction. Do not summarize the report prose and do not invent future expectations.",
    "Facts require evidence. Judgments require evidence, a deadline or horizon, nextTest, and falsifier.",
    "Return one JSON object using the exact outputSchema.",
  ].join("\n");
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : null;
}
