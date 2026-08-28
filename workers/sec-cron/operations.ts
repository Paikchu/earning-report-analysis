import {
  analyzePreparedSecNode,
  buildPreparedSecBrief,
  failedSecNode,
  discoverSecTicker,
  planPreparedSecFiling,
  prepareSecFiling,
  reviewPreparedSecAnalysis,
  summarizePreparedSecEvent,
  summarizePreparedSecFiling,
  type PreparedSecFiling,
  type PreparedSecFilingMeta,
  type SecModelCall,
} from "../../lib/sec-pipeline.ts";
import type { SecAnalysisArtifact } from "../../lib/sec-types.ts";
import type { SecFilingSummary, SecNodePlan, SecNodeResult, SecNodeSpec } from "../../lib/sec.ts";
import { SEC_ANALYSIS_SCHEMA_VERSION, type FilingBlock, type ManagerReview, type SecHistorySnapshot } from "../../lib/sec-analysis.ts";
import { normalizeCompanyFacts } from "../../lib/sec-history.ts";
import { siteHeaders, type SecCronEnv } from "./core.ts";
import type { SecModelExecution } from "./retry-policy.ts";
import type { PreparedFilingReference, SecPipelineOperations } from "./workflow-core.ts";
import { jobAnalysisVersionFor } from "./workflow-core.ts";

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
  /** Optional stronger model for planning, review and synthesis. Unset means one model everywhere. */
  SEC_REASONING_MODEL?: string;
};

const PUBLISH_BLOCK_CHUNK_SIZE = 40;

/** Planning, review and synthesis carry the judgement; node extraction is mechanical. */
const REASONING_STAGE = /^(manager|synthesis)/;

export function modelForStage(env: SecPipelineEnv, stage: string, override?: string): string | undefined {
  if (override) return override;
  return REASONING_STAGE.test(stage) ? env.SEC_REASONING_MODEL || undefined : undefined;
}

export function createSecPipelineOperations(env: SecPipelineEnv, fetcher: typeof fetch = fetch): SecPipelineOperations {
  const modelFor = (execution?: SecModelExecution): SecModelCall => async (stage, system, payload) => {
    try {
      return await callWorkerSecModel(env, fetcher, stage, system, payload, modelForStage(env, stage, execution?.model));
    } catch (error) {
      if (!(error instanceof SyntaxError) && !String(error).includes("JSON object")) throw error;
      const retryStage = `${stage}:schema-retry`;
      return callWorkerSecModel(env, fetcher, retryStage, `${system}\nYour previous response violated the JSON schema. Return one valid JSON object only.`, payload, modelForStage(env, retryStage, execution?.model));
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
          analysisVersion: jobAnalysisVersionFor(filing.form),
        },
      });
      return result.status === null || result.status === "failed";
    },
    getContext: async (filing, reference) => {
      const history = reference ? await readHistory(env.SEC_FILINGS, reference) : EMPTY_HISTORY;
      const response = await sitePost<{ context: Awaited<ReturnType<SecPipelineOperations["getContext"]>> }>(env, fetcher, "/api/internal/sec/context", { filing, history });
      return { ...response.context, history: response.context.history ?? history };
    },
    prepare: async (filing) => {
      const prepared = await prepareSecFiling(filing, { userAgent: env.SEC_USER_AGENT, fetcher });
      const history = await fetchCompanyHistory(filing.cik, filing.ticker, env.SEC_USER_AGENT, fetcher).catch(() => EMPTY_HISTORY);
      const key = preparedKey(filing.ticker, filing.accessionNumber);
      const { blocks, document, ...meta } = prepared;
      await Promise.all([
        putJson(env.SEC_FILINGS, `${key}/meta.json`, meta),
        putJson(env.SEC_FILINGS, `${key}/text.json`, { document, blocks }),
        putJson(env.SEC_FILINGS, `${key}/history.json`, history),
      ]);
      return { key, filing };
    },
    buildBrief: async (_filing, reference, context) => {
      const meta = await readMeta(env.SEC_FILINGS, reference);
      const history = context.history ?? await readHistory(env.SEC_FILINGS, reference);
      const brief = buildPreparedSecBrief(meta, context, history);
      await putArtifact(env.SEC_FILINGS, reference, "brief", brief);
      return brief;
    },
    plan: async (_filing, reference, brief, execution): Promise<SecNodePlan> => {
      const plan = await planPreparedSecFiling(await readMeta(env.SEC_FILINGS, reference), modelFor(execution), brief);
      await putArtifact(env.SEC_FILINGS, reference, "manager-plan", plan);
      return plan;
    },
    analyzeNode: async (spec: SecNodeSpec, _filing, reference, brief, round = 0, execution): Promise<SecNodeResult> => {
      const prepared = await readPrepared(env.SEC_FILINGS, reference);
      let result: SecNodeResult;
      try {
        result = await analyzePreparedSecNode(prepared, spec, modelFor(execution), brief);
      } catch (error) {
        // Rethrow so the Workflow step retries and escalates to the fallback model; only the
        // final attempt degrades to an error node so one flaky response cannot lose the filing.
        if (execution && !execution.finalAttempt) throw error;
        result = failedSecNode(spec, error);
      }
      await putArtifact(env.SEC_FILINGS, reference, `nodes/round-${round}/${spec.id}`, result);
      return result;
    },
    review: async (_filing, reference, brief, plan, nodes, round, execution): Promise<ManagerReview> => {
      const result = await reviewPreparedSecAnalysis(await readMeta(env.SEC_FILINGS, reference), brief, plan, nodes, round, modelFor(execution));
      await putArtifact(env.SEC_FILINGS, reference, `manager-review/round-${round}`, result);
      return result;
    },
    summarizeEvent: async (_filing, reference, execution) => summarizePreparedSecEvent(await readPrepared(env.SEC_FILINGS, reference), modelFor(execution)),
    summarize: async (_filing, reference, context, plan, nodes, brief, review, execution) => {
      await putArtifact(env.SEC_FILINGS, reference, "nodes/final", nodes);
      if (review) await putArtifact(env.SEC_FILINGS, reference, "manager-review/final", review);
      const result = await summarizePreparedSecFiling(await readMeta(env.SEC_FILINGS, reference), context, modelFor(execution), new Date(), plan, nodes, brief, review);
      const synthesisKey = await putArtifact(env.SEC_FILINGS, reference, "synthesis", result);
      return { ...result, artifact: { ...result.artifact, blocks: [], artifactKeys: collectArtifactKeys(reference, synthesisKey) } };
    },
    publish: async (artifact, summary) => {
      const reference = { key: preparedKey(artifact.filing.ticker, artifact.filing.accessionNumber), filing: artifact.filing };
      const prepared = await readPrepared(env.SEC_FILINGS, reference);
      const citedBlockIds = collectReferencedBlockIds(artifact);
      const citedBlocks = prepared.blocks.filter((block) => citedBlockIds.has(block.blockId));
      for (const blocks of chunks(citedBlocks, PUBLISH_BLOCK_CHUNK_SIZE)) {
        await sitePost(env, fetcher, "/api/internal/sec/publish", { filing: artifact.filing, blocks });
      }
      return sitePost<{ memoryJobId?: string }>(env, fetcher, "/api/internal/sec/publish", {
        artifact: { ...artifact, blocks: [] } satisfies SecAnalysisArtifact,
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

const EMPTY_HISTORY: SecHistorySnapshot = { registryVersion: "sec-canonical-series.v1", series: [] };

async function readJson<T>(bucket: R2BucketLike, key: string): Promise<T> {
  const object = await bucket.get(key);
  if (!object) throw new Error(`Prepared filing not found: ${key}`);
  return JSON.parse(await object.text()) as T;
}

async function putJson(bucket: R2BucketLike, key: string, value: unknown): Promise<void> {
  await bucket.put(key, JSON.stringify(value), { httpMetadata: { contentType: "application/json" } });
}

function readMeta(bucket: R2BucketLike, reference: PreparedFilingReference): Promise<PreparedSecFilingMeta> {
  return readJson<PreparedSecFilingMeta>(bucket, `${reference.key}/meta.json`);
}

function readHistory(bucket: R2BucketLike, reference: PreparedFilingReference): Promise<SecHistorySnapshot> {
  return readJson<SecHistorySnapshot>(bucket, `${reference.key}/history.json`).catch(() => EMPTY_HISTORY);
}

async function readPrepared(bucket: R2BucketLike, reference: PreparedFilingReference): Promise<PreparedSecFiling> {
  const [meta, body] = await Promise.all([
    readMeta(bucket, reference),
    readJson<{ document: PreparedSecFiling["document"]; blocks: FilingBlock[] }>(bucket, `${reference.key}/text.json`),
  ]);
  return { ...meta, document: body.document, blocks: body.blocks };
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
  return `filings/${ticker}/${accessionNumber}`;
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
  const key = `${reference.key.replace(/^filings\//, "analysis/")}/${SEC_ANALYSIS_SCHEMA_VERSION}/${name}.json`;
  await bucket.put(key, JSON.stringify(value), { httpMetadata: { contentType: "application/json" } });
  return key;
}

function collectArtifactKeys(reference: PreparedFilingReference, synthesisKey: string): Record<string, string> {
  const prefix = `${reference.key.replace(/^filings\//, "analysis/")}/${SEC_ANALYSIS_SCHEMA_VERSION}`;
  return {
    brief: `${prefix}/brief.json`,
    plan: `${prefix}/manager-plan.json`,
    "manager-review": `${prefix}/manager-review/final.json`,
    nodes: `${prefix}/nodes/final.json`,
    synthesis: synthesisKey,
  };
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
    headers: { "content-type": "application/json", accept: "text/event-stream", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: modelOverride || env.SEC_ANALYSIS_MODEL || "glm-5.3-flash",
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(payload) },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
      // Streaming keeps bytes flowing so the provider's proxy cannot time the request out at ~100s.
      stream: true,
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`DeepSeek ${stage} HTTP ${response.status}: ${detail.slice(0, 300)}`);
  }
  return parseModelJson(await readModelContent(response, stage));
}

/**
 * Assembles the assistant message from an SSE stream, falling back to a whole-body completion for
 * gateways that ignore `stream: true`. Throws before parsing when the stream ends early, because a
 * truncated JSON body can still parse into a plausible but wrong object.
 */
export async function readModelContent(response: Response, stage: string): Promise<string> {
  const raw = await response.text();
  const lines = raw.split(/\r?\n/);
  const dataLines = lines.filter((line) => line.startsWith("data:"));
  if (!dataLines.length) return nonStreamedContent(raw, stage);

  let content = "";
  let finishReason: string | null = null;
  let done = false;
  for (const line of dataLines) {
    const data = line.slice(5).trim();
    if (!data) continue;
    if (data === "[DONE]") {
      done = true;
      continue;
    }
    let chunk: Record<string, unknown>;
    try {
      chunk = JSON.parse(data) as Record<string, unknown>;
    } catch {
      continue;
    }
    const error = chunk.error;
    if (error) throw new Error(`DeepSeek ${stage} stream error: ${JSON.stringify(error).slice(0, 300)}`);
    const choice = (chunk.choices as Array<Record<string, unknown>> | undefined)?.[0];
    if (!choice) continue;
    const delta = choice.delta as { content?: unknown } | undefined;
    if (typeof delta?.content === "string") content += delta.content;
    if (typeof choice.finish_reason === "string") finishReason = choice.finish_reason;
  }

  if (!done && !finishReason) {
    throw new Error(`DeepSeek ${stage} stream ended before completion after ${content.length} characters`);
  }
  if (finishReason === "length") {
    throw new Error(`DeepSeek ${stage} stream hit the output token limit after ${content.length} characters`);
  }
  if (!content) throw new Error(`DeepSeek ${stage} returned empty content`);
  return content;
}

function nonStreamedContent(raw: string, stage: string): string {
  let data: { choices?: Array<{ message?: { content?: unknown } }> };
  try {
    data = JSON.parse(raw) as typeof data;
  } catch {
    throw new Error(`DeepSeek ${stage} returned neither an event stream nor JSON: ${raw.slice(0, 200)}`);
  }
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content) throw new Error(`DeepSeek ${stage} returned empty content`);
  return content;
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
