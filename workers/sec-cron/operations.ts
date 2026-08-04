import {
  analyzePreparedSecModule,
  discoverSecTicker,
  prepareSecFiling,
  routePreparedSecFiling,
  summarizePreparedSecFiling,
  type PreparedSecFiling,
  type SecModelCall,
} from "../../lib/sec-pipeline.ts";
import type { SecAnalysisArtifact } from "../../lib/sec-service.ts";
import { SEC_ANALYSIS_MODULES, SEC_ANALYSIS_SCHEMA_VERSION } from "../../lib/sec-analysis.ts";
import { siteHeaders, type SecCronEnv } from "./core.ts";
import type { PreparedFilingReference, SecPipelineOperations } from "./workflow-core.ts";

type R2ObjectLike = { text(): Promise<string> };
type R2BucketLike = {
  get(key: string): Promise<R2ObjectLike | null>;
  put(key: string, value: string, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
};

export type SecPipelineEnv = SecCronEnv & {
  SEC_FILINGS: R2BucketLike;
  SEC_USER_AGENT: string;
};

export function createSecPipelineOperations(env: SecPipelineEnv, fetcher: typeof fetch = fetch): SecPipelineOperations {
  const model: SecModelCall = async (stage, system, payload) => {
    const result = await sitePost<{ value?: Record<string, unknown> }>(env, fetcher, "/api/internal/sec/model", { stage, system, payload });
    if (!result.value) throw new Error(`SEC model stage ${stage} returned no value`);
    return result.value;
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
    route: async (_filing, reference, context) => {
      const prepared = await readPrepared(env.SEC_FILINGS, reference);
      const router = await routePreparedSecFiling(prepared, context, model);
      await Promise.all(SEC_ANALYSIS_MODULES.map(async (module) => {
        const selected = new Set(router.selections.find((selection) => selection.moduleKey === module.key)?.blockIds ?? []);
        const slice = { ...prepared, blocks: prepared.blocks.filter((block) => selected.has(block.blockId)).slice(0, 8) };
        await env.SEC_FILINGS.put(modulePreparedKey(reference, module.key), JSON.stringify(slice), { httpMetadata: { contentType: "application/json" } });
      }));
      return router;
    },
    analyzeModule: async (moduleKey, _filing, reference, context, router) => analyzePreparedSecModule(moduleKey, await readPrepared(env.SEC_FILINGS, { ...reference, key: modulePreparedKey(reference, moduleKey) }), context, router, model),
    summarize: async (_filing, reference, context, router, modules) => {
      const result = await summarizePreparedSecFiling(await readPrepared(env.SEC_FILINGS, reference), context, router, modules, model);
      return { ...result, artifact: { ...result.artifact, blocks: [] } };
    },
    publish: async (artifact, summary) => {
      const reference = { key: preparedKey(artifact.filing.ticker, artifact.filing.accessionNumber), filing: artifact.filing };
      const prepared = await readPrepared(env.SEC_FILINGS, reference);
      await sitePost(env, fetcher, "/api/internal/sec/publish", { artifact: { ...artifact, blocks: prepared.blocks } satisfies SecAnalysisArtifact, summary });
    },
    updateJob: (job) => sitePost(env, fetcher, "/api/internal/sec/jobs", { job }).then(() => undefined),
  };
}

async function readPrepared(bucket: R2BucketLike, reference: PreparedFilingReference): Promise<PreparedSecFiling> {
  const object = await bucket.get(reference.key);
  if (!object) throw new Error(`Prepared filing not found: ${reference.key}`);
  return JSON.parse(await object.text()) as PreparedSecFiling;
}

async function sitePost<T = Record<string, unknown>>(env: SecPipelineEnv, fetcher: typeof fetch, path: string, body: unknown): Promise<T> {
  const response = await fetcher(`${env.MAX_SITE_ORIGIN.replace(/\/+$/, "")}${path}`, {
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
