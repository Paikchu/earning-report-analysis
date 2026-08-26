import {
  analyzePreparedSecNode,
  analyzePreparedSecModule,
  buildPreparedClaimLedger,
  buildPreparedSecBrief,
  discoverSecTicker,
  planPreparedSecFiling,
  prepareSecFiling,
  reviewPreparedSecAnalysis,
  routePreparedSecFiling,
  summarizePreparedSecEvent,
  summarizePreparedSecFiling,
  type PreparedSecFiling,
  type SecModelCall,
} from "../../lib/sec-pipeline.ts";
import type { SecAnalysisArtifact } from "../../lib/sec-service.ts";
import type { SecFilingSummary, SecNodePlan, SecNodeResult, SecNodeSpec } from "../../lib/sec.ts";
import {
  fallbackRouterResult,
  normalizeReverseClaimCheck,
  SEC_ANALYSIS_MODULES,
  SEC_ANALYSIS_SCHEMA_VERSION,
  verifyClaimLedger,
  type ClaimCheckResult,
  type ClaimLedger,
  type ManagerReview,
  type RouterResult,
} from "../../lib/sec-analysis.ts";
import { normalizeCompanyFacts } from "../../lib/sec-history.ts";
import { siteHeaders, type SecCronEnv } from "./core.ts";
import type { SecModelExecution } from "./retry-policy.ts";
import type { PreparedFilingReference, SecPipelineOperations } from "./workflow-core.ts";

type R2ObjectLike = { text(): Promise<string> };
type R2BucketLike = {
  get(key: string): Promise<R2ObjectLike | null>;
  put(key: string, value: string, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
};

export type SecPipelineEnv = SecCronEnv & {
  SEC_FILINGS: R2BucketLike;
  SEC_USER_AGENT: string;
  AI_API_KEY?: string;
  SEC_ANALYSIS_MODEL?: string;
};

const PUBLISH_BLOCK_CHUNK_SIZE = 5;
const PUBLISH_MEMORY_CHUNK_SIZE = 15;
const PUBLISH_COMPARISON_CHUNK_SIZE = 30;

export function createSecPipelineOperations(env: SecPipelineEnv, fetcher: typeof fetch = fetch): SecPipelineOperations {
  const modelFor = (execution?: SecModelExecution): SecModelCall => async (stage, system, payload) => {
    try {
      return await callWorkerSecModel(env, fetcher, stage, system, payload, execution?.model);
    } catch (error) {
      if (!(error instanceof SyntaxError) && !String(error).includes("JSON object")) throw error;
      return callWorkerSecModel(env, fetcher, `${stage}:schema-retry`, `${system}\nYour previous response violated the JSON schema. Return one valid JSON object only.`, payload, execution?.model);
    }
  };
  return {
    discover: (ticker) => discoverSecTicker(ticker, { userAgent: env.SEC_USER_AGENT, fetcher }),
    publishFeed: (feed) => sitePost(env, fetcher, "/api/internal/sec/feed", { feed }).then(() => undefined),
    shouldAnalyze: async (filing, requestedBy) => {
      if (requestedBy === "manual") return true;
      const result = await sitePost<{ status: "queued" | "running" | "complete" | "failed" | null }>(env, fetcher, "/api/internal/sec/jobs", {
        lookup: {
          ticker: filing.ticker,
          accessionNumber: filing.accessionNumber,
          analysisVersion: SEC_ANALYSIS_SCHEMA_VERSION,
        },
      });
      return result.status === null || result.status === "failed";
    },
    getContext: async (filing) => (await sitePost<{ context: Awaited<ReturnType<SecPipelineOperations["getContext"]>> }>(env, fetcher, "/api/internal/sec/context", { filing })).context,
    prepare: async (filing) => {
      const prepared = await prepareSecFiling(filing, { userAgent: env.SEC_USER_AGENT, fetcher });
      const key = preparedKey(filing.ticker, filing.accessionNumber);
      await env.SEC_FILINGS.put(key, JSON.stringify(prepared), { httpMetadata: { contentType: "application/json" } });
      return { key, filing };
    },
    route: async (_filing, reference, context, execution) => {
      const prepared = await readPrepared(env.SEC_FILINGS, reference);
      let router: RouterResult;
      try {
        router = await routePreparedSecFiling(prepared, context, modelFor(execution));
      } catch (error) {
        if (execution && !execution.finalAttempt) throw error;
        router = fallbackRouterResult(prepared.blocks);
      }
      await Promise.all(SEC_ANALYSIS_MODULES.map(async (module) => {
        const selected = new Set(router.selections.find((selection) => selection.moduleKey === module.key)?.blockIds ?? []);
        const slice: PreparedSecFiling = {
          ...prepared,
          blocks: prepared.blocks.filter((block) => selected.has(block.blockId)).slice(0, 8),
          document: { text: "", headings: [] },
          outline: [],
        };
        await env.SEC_FILINGS.put(modulePreparedKey(reference, module.key), JSON.stringify(slice), { httpMetadata: { contentType: "application/json" } });
      }));
      await putArtifact(env.SEC_FILINGS, reference, "router", router);
      return router;
    },
    analyzeModule: async (moduleKey, _filing, reference, context, router, execution) => {
      const result = await analyzePreparedSecModule(moduleKey, await readPrepared(env.SEC_FILINGS, { ...reference, key: modulePreparedKey(reference, moduleKey) }), context, router, modelFor(execution));
      await putArtifact(env.SEC_FILINGS, reference, `modules/${moduleKey}`, result);
      return result;
    },
    buildBrief: async (filing, reference, context, modules) => {
      const prepared = await readPrepared(env.SEC_FILINGS, reference);
      const history = await fetchCompanyHistory(filing.cik, filing.ticker, env.SEC_USER_AGENT, fetcher).catch(() => context.history ?? { registryVersion: "sec-canonical-series.v1", series: [] });
      const persisted = await sitePost<{ context?: typeof context }>(env, fetcher, "/api/internal/sec/context", { filing, history }).catch(() => ({ context: undefined }));
      const brief = buildPreparedSecBrief(prepared, persisted.context ?? { ...context, history }, modules, history);
      await putArtifact(env.SEC_FILINGS, reference, "brief", brief);
      return brief;
    },
    plan: async (_filing, reference, brief, execution): Promise<SecNodePlan> => {
      const plan = await planPreparedSecFiling(await readPrepared(env.SEC_FILINGS, reference), modelFor(execution), brief);
      await putArtifact(env.SEC_FILINGS, reference, "manager-plan", plan);
      return plan;
    },
    analyzeNode: async (spec: SecNodeSpec, _filing, reference, brief, round = 0, execution): Promise<SecNodeResult> => {
      const result = await analyzePreparedSecNode(await readPrepared(env.SEC_FILINGS, reference), spec, modelFor(execution), brief);
      await putArtifact(env.SEC_FILINGS, reference, `nodes/round-${round}/${spec.id}`, result);
      return result;
    },
    review: async (_filing, reference, brief, plan, nodes, round, execution): Promise<ManagerReview> => {
      const result = await reviewPreparedSecAnalysis(await readPrepared(env.SEC_FILINGS, reference), brief, plan, nodes, round, modelFor(execution));
      await putArtifact(env.SEC_FILINGS, reference, `manager-review/round-${round}`, result);
      return result;
    },
    buildClaimLedger: async (_filing, reference, brief, nodes): Promise<ClaimLedger> => {
      const result = buildPreparedClaimLedger(brief, nodes, []);
      await putArtifact(env.SEC_FILINGS, reference, "nodes/final", nodes);
      await putArtifact(env.SEC_FILINGS, reference, "claim-ledger", result);
      return result;
    },
    summarizeEvent: async (_filing, reference, execution) => summarizePreparedSecEvent(await readPrepared(env.SEC_FILINGS, reference), modelFor(execution)),
    summarize: async (_filing, reference, context, router, modules, plan, nodes, brief, review, ledger, execution) => {
      if (review) await putArtifact(env.SEC_FILINGS, reference, "manager-review/final", review);
      const result = await summarizePreparedSecFiling(await readPrepared(env.SEC_FILINGS, reference), context, router, modules, modelFor(execution), new Date(), plan, nodes, brief, review, ledger);
      const synthesisKey = await putArtifact(env.SEC_FILINGS, reference, "synthesis", result);
      return { ...result, artifact: { ...result.artifact, blocks: [], artifactKeys: collectArtifactKeys(reference, synthesisKey) } };
    },
    repairSynthesis: async (_filing, reference, context, router, modules, plan, nodes, brief, review, ledger, failedCheck, execution) => {
      const repairedReview = { ...review, unresolvedQuestions: [...review.unresolvedQuestions, `Claim repair: ${JSON.stringify(failedCheck)}`] };
      const result = await summarizePreparedSecFiling(await readPrepared(env.SEC_FILINGS, reference), context, router, modules, modelFor(execution), new Date(), plan, nodes, brief, repairedReview, ledger, "synthesis-repair");
      const synthesisKey = await putArtifact(env.SEC_FILINGS, reference, "synthesis-repair", result);
      return { ...result, artifact: { ...result.artifact, blocks: [], artifactKeys: collectArtifactKeys(reference, synthesisKey) } };
    },
    checkClaims: async (artifact, ledger, summary, execution): Promise<ClaimCheckResult> => {
      const deterministic = verifyClaimLedger(ledger, artifact.report.keyMetrics);
      if (deterministic.status === "failed" || !summary?.report) return deterministic.status === "failed" ? deterministic : { ...deterministic, status: "failed", unsupportedClaims: ["Synthesis body is missing"] };
      const reverse = normalizeReverseClaimCheck(await modelFor(execution)("claim-check", reverseClaimSystemPrompt(), {
        report: summary.report,
        headline: summary.headline,
        bullets: summary.bullets,
        analystView: summary.analystView,
        claimLedger: ledger,
        outputSchema: { claims: "[{claimId,evidenceIds}]", unsupportedClaims: "[string]" },
      }), ledger);
      return reverse.status === "failed" ? reverse : deterministic;
    },
    publish: async (artifact, summary) => {
      const reference = { key: preparedKey(artifact.filing.ticker, artifact.filing.accessionNumber), filing: artifact.filing };
      const prepared = await readPrepared(env.SEC_FILINGS, reference);
      const citedBlockIds = collectReferencedBlockIds(artifact);
      const citedBlocks = prepared.blocks.filter((block) => citedBlockIds.has(block.blockId));
      const deferredArtifact: SecAnalysisArtifact = {
        ...artifact,
        blocks: [],
        moduleAnalyses: [],
        snapshots: [],
        comparisons: [],
        memoryCandidates: [],
        report: {
          ...artifact.report,
          dataQuality: { ...artifact.report.dataQuality, verificationStatus: "failed" },
        },
      };
      for (const blocks of chunks(citedBlocks, PUBLISH_BLOCK_CHUNK_SIZE)) {
        await sitePost(env, fetcher, "/api/internal/sec/publish", { artifact: { ...deferredArtifact, blocks }, summary: null });
      }
      for (const snapshot of artifact.snapshots) {
        await sitePost(env, fetcher, "/api/internal/sec/publish", { artifact: { ...deferredArtifact, snapshots: [snapshot] }, summary: null });
      }
      for (const comparisons of chunks(artifact.comparisons, PUBLISH_COMPARISON_CHUNK_SIZE)) {
        await sitePost(env, fetcher, "/api/internal/sec/publish", { artifact: { ...deferredArtifact, comparisons }, summary: null });
      }
      for (const memoryCandidates of chunks(artifact.memoryCandidates, PUBLISH_MEMORY_CHUNK_SIZE)) {
        await sitePost(env, fetcher, "/api/internal/sec/publish", { artifact: { ...deferredArtifact, memoryCandidates }, summary: null });
      }
      return sitePost<{ memoryJobId?: string }>(env, fetcher, "/api/internal/sec/publish", {
        artifact: { ...artifact, blocks: [], snapshots: [], comparisons: [], memoryCandidates: [] } satisfies SecAnalysisArtifact,
        summary,
      });
    },
    enqueueMemory: async (jobId, ticker) => {
      if (!env.SEC_MEMORY_WORKFLOW) return;
      await env.SEC_MEMORY_WORKFLOW.create({ id: `memory-${crypto.randomUUID()}`, params: { jobId, ticker } });
    },
    publishEvent: async (summary) => sitePost(env, fetcher, "/api/internal/sec/publish", { filing: summaryIdentity(summary), summary }).then(() => undefined),
    updateJob: (job) => sitePost(env, fetcher, "/api/internal/sec/jobs", { job }).then(() => undefined),
  };
}

async function readPrepared(bucket: R2BucketLike, reference: PreparedFilingReference): Promise<PreparedSecFiling> {
  const object = await bucket.get(reference.key);
  if (!object) throw new Error(`Prepared filing not found: ${reference.key}`);
  return JSON.parse(await object.text()) as PreparedSecFiling;
}

export async function sitePost<T = Record<string, unknown>>(env: SecPipelineEnv, fetcher: typeof fetch, path: string, body: unknown): Promise<T> {
  const response = await fetcher(`${env.WEB_APP_ORIGIN.replace(/\/+$/, "")}${path}`, {
    method: "POST",
    headers: siteHeaders(env),
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Site bridge ${path} HTTP ${response.status}: ${detail.slice(0, 300)}`);
  }
  return response.json() as Promise<T>;
}

function preparedKey(ticker: string, accessionNumber: string) {
  return `filings/${ticker}/${accessionNumber}.json`;
}

function modulePreparedKey(reference: PreparedFilingReference, moduleKey: string) {
  return `${reference.key.replace(/\.json$/, "")}/modules/${moduleKey}.json`;
}

function collectReferencedBlockIds(artifact: SecAnalysisArtifact): Set<string> {
  const blockIds = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (key === "evidenceIds" && Array.isArray(child)) {
        child.forEach((evidenceId) => {
          if (typeof evidenceId === "string" && evidenceId.startsWith("ev:")) blockIds.add(evidenceId.slice(3));
        });
      } else {
        visit(child);
      }
    }
  };
  visit(artifact);
  return blockIds;
}

function summaryIdentity(summary: SecFilingSummary) {
  return {
    ticker: summary.ticker,
    form: summary.form,
    filingDate: summary.filingDate,
    accessionNumber: summary.accessionNumber,
  };
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

async function fetchCompanyHistory(cik: string, ticker: string, userAgent: string, fetcher: typeof fetch) {
  const normalizedCik = String(cik).replace(/\D/g, "").padStart(10, "0");
  const response = await fetcher(`https://data.sec.gov/api/xbrl/companyfacts/CIK${normalizedCik}.json`, {
    cache: "no-store",
    headers: { accept: "application/json", "user-agent": userAgent },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`SEC Company Facts HTTP ${response.status}`);
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > 20_000_000) throw new Error("SEC Company Facts payload exceeds 20 MB");
  return normalizeCompanyFacts(ticker, await response.json());
}

async function putArtifact(bucket: R2BucketLike, reference: PreparedFilingReference, name: string, value: unknown): Promise<string> {
  const key = `${reference.key.replace(/^filings\//, "analysis/").replace(/\.json$/, "")}/${SEC_ANALYSIS_SCHEMA_VERSION}/${name}.json`;
  await bucket.put(key, JSON.stringify(value), { httpMetadata: { contentType: "application/json" } });
  return key;
}

function collectArtifactKeys(reference: PreparedFilingReference, synthesisKey: string): Record<string, string> {
  const prefix = `${reference.key.replace(/^filings\//, "analysis/").replace(/\.json$/, "")}/${SEC_ANALYSIS_SCHEMA_VERSION}`;
  return {
    router: `${prefix}/router.json`,
    brief: `${prefix}/brief.json`,
    plan: `${prefix}/manager-plan.json`,
    "manager-review": `${prefix}/manager-review/final.json`,
    nodes: `${prefix}/nodes/final.json`,
    claimLedger: `${prefix}/claim-ledger.json`,
    synthesis: synthesisKey,
    ...Object.fromEntries(SEC_ANALYSIS_MODULES.map((module) => [`module:${module.key}`, `${prefix}/modules/${module.key}.json`])),
  };
}

function reverseClaimSystemPrompt(): string {
  return [
    "You are the final reverse Claim verifier for an SEC analysis report.",
    "Extract every factual or numeric assertion from the report and map it to an exact claimId in the supplied Claim Ledger.",
    "Put any assertion without an exact ledger entry in unsupportedClaims. Do not forgive formatting or period, unit, currency, or basis mismatches.",
    "Return one JSON object using the exact outputSchema.",
  ].join("\n");
}

export async function callWorkerSecModel(
  env: SecPipelineEnv,
  fetcher: typeof fetch,
  stage: string,
  system: string,
  payload: unknown,
  modelOverride?: string,
): Promise<Record<string, unknown>> {
  const apiKey = await resolveWorkerModelKey(env, fetcher);
  const response = await fetcher("https://api.b.ai/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: modelOverride || env.SEC_ANALYSIS_MODEL || "deepseek-v4-flash",
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(payload) },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`DeepSeek ${stage} HTTP ${response.status}: ${detail.slice(0, 300)}`);
  }
  const data = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content) throw new Error(`DeepSeek ${stage} returned empty content`);
  return parseModelJson(content);
}

export async function resolveWorkerModelKey(env: SecPipelineEnv, fetcher: typeof fetch = fetch): Promise<string> {
  void fetcher;
  if (!env.AI_API_KEY) throw new Error("SEC pipeline AI_API_KEY is not configured");
  return env.AI_API_KEY;
}

function parseModelJson(content: string): Record<string, unknown> {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? content;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("DeepSeek did not return a JSON object");
  return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
}
