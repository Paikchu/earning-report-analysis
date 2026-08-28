import assert from "node:assert/strict";
import test from "node:test";

import type { SecAnalysisArtifact } from "../lib/sec-types.ts";
import type { SecFiling, SecNodeSpec } from "../lib/sec.ts";
import { callWorkerSecModel, createSecPipelineOperations, type SecPipelineEnv } from "../workers/sec-cron/operations.ts";
import { modelExecutionForAttempt, retryDelayForAttempt } from "../workers/sec-cron/retry-policy.ts";

const filing: SecFiling = {
  ticker: "MSFT", cik: "0000789019", cikNumber: 789019, companyName: "Microsoft Corp", form: "10-K",
  filingDate: "2026-07-30", reportDate: "2026-06-30", accessionNumber: "annual", primaryDocument: "msft.htm",
  description: "Annual report", items: "", documentUrl: "https://sec.test/msft.htm", indexUrl: "https://sec.test/index.htm",
};

test("uses hy3 only after the primary model attempt fails", () => {
  assert.deepEqual(modelExecutionForAttempt(1), { attempt: 1, finalAttempt: false });
  assert.deepEqual(modelExecutionForAttempt(2), { attempt: 2, model: "hy3", finalAttempt: false });
  assert.deepEqual(modelExecutionForAttempt(4), { attempt: 4, model: "hy3", finalAttempt: true });
});

test("adds bounded jitter around 30, 90, and 180 second retry delays", () => {
  assert.equal(retryDelayForAttempt(1, () => 0), 24_000);
  assert.equal(retryDelayForAttempt(1, () => 0.5), 30_000);
  assert.equal(retryDelayForAttempt(2, () => 0.5), 90_000);
  assert.equal(retryDelayForAttempt(3, () => 0.5), 180_000);
  assert.equal(retryDelayForAttempt(3, () => 1), 216_000);
});

test("sends an explicit fallback model override to B.ai", async () => {
  let requestedModel = "";
  const env = {
    WEB_APP_ORIGIN: "https://site.test",
    SEC_REFRESH_KEY: "refresh-key",
    SEC_USER_AGENT: "test@example.com",
    AI_API_KEY: "worker-model-secret",
    SEC_ANALYSIS_MODEL: "primary-model",
    SEC_FILINGS: { async get() { return null; }, async put() { return {}; } },
  } as unknown as SecPipelineEnv;
  const fetcher: typeof fetch = async (_input, init) => {
    requestedModel = (JSON.parse(String(init?.body)) as { model: string }).model;
    return Response.json({ choices: [{ message: { content: "{}" } }] });
  };

  await callWorkerSecModel(env, fetcher, "test", "Return JSON", {}, "hy3");

  assert.equal(requestedModel, "hy3");
});

const modelEnv = {
  WEB_APP_ORIGIN: "https://site.test",
  SEC_REFRESH_KEY: "refresh-key",
  SEC_USER_AGENT: "test@example.com",
  AI_API_KEY: "worker-model-secret",
  SEC_ANALYSIS_MODEL: "primary-model",
  SEC_FILINGS: { async get() { return null; }, async put() { return {}; } },
} as unknown as SecPipelineEnv;

function sse(...events: string[]): Response {
  return new Response(events.map((event) => `data: ${event}\n\n`).join(""), {
    headers: { "content-type": "text/event-stream" },
  });
}

function delta(content: string, finishReason: string | null = null) {
  return JSON.stringify({ choices: [{ delta: { content }, finish_reason: finishReason }] });
}

test("streams the completion so the provider proxy cannot time the request out", async () => {
  let requestBody: Record<string, unknown> = {};
  let acceptHeader = "";
  const fetcher: typeof fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    acceptHeader = String((init?.headers as Record<string, string>)?.accept ?? "");
    return sse(delta('{"head'), delta('line":"ok"}', "stop"), "[DONE]");
  };

  const result = await callWorkerSecModel(modelEnv, fetcher, "node:test", "Return JSON", {});

  assert.equal(requestBody.stream, true, "stream must be requested");
  assert.deepEqual(requestBody.response_format, { type: "json_object" });
  assert.equal(acceptHeader, "text/event-stream");
  assert.deepEqual(result, { headline: "ok" });
});

test("still reads gateways that ignore the stream flag", async () => {
  const fetcher: typeof fetch = async () => Response.json({ choices: [{ message: { content: '{"headline":"ok"}' } }] });

  assert.deepEqual(await callWorkerSecModel(modelEnv, fetcher, "node:test", "Return JSON", {}), { headline: "ok" });
});

test("rejects a truncated stream instead of parsing a plausible fragment", async () => {
  // Without [DONE] or a finish_reason the body is incomplete; parseModelJson would happily read
  // the inner object and return the wrong answer.
  const fetcher: typeof fetch = async () => sse(delta('{"headline":"ok","keyMetrics":[{"metricKey":"revenue"}'));

  await assert.rejects(
    callWorkerSecModel(modelEnv, fetcher, "node:test", "Return JSON", {}),
    (error: Error) => {
      assert.match(error.message, /stream ended before completion/);
      // Must not look like a schema violation, or the retry would resend with the wrong prompt
      // instead of letting the Workflow step retry on the fallback model.
      assert.equal(error instanceof SyntaxError, false);
      assert.equal(error.message.includes("JSON object"), false);
      return true;
    },
  );
});

test("surfaces an error frame carried inside the stream", async () => {
  const fetcher: typeof fetch = async () => sse(JSON.stringify({ error: { message: "upstream overloaded", code: 503 } }));

  await assert.rejects(callWorkerSecModel(modelEnv, fetcher, "node:test", "Return JSON", {}), /stream error.*upstream overloaded/);
});

test("rejects a stream cut short by the output token limit", async () => {
  const fetcher: typeof fetch = async () => sse(delta('{"headline":"tru'), delta("", "length"));

  await assert.rejects(callWorkerSecModel(modelEnv, fetcher, "node:test", "Return JSON", {}), /output token limit/);
});

test("scheduled analysis does not overlap an already running filing job", async () => {
  const env = {
    WEB_APP_ORIGIN: "https://site.test",
    SEC_REFRESH_KEY: "refresh-key",
    SEC_USER_AGENT: "test@example.com",
    SEC_FILINGS: { async get() { return null; }, async put() { return {}; } },
  } as unknown as SecPipelineEnv;
  const operations = createSecPipelineOperations(env, async () => Response.json({ status: "running" }));

  assert.equal(await operations.shouldAnalyze(filing, "scheduled"), false);
  assert.equal(await operations.shouldAnalyze(filing, "manual"), true);
});

test("calls B.ai from the workflow worker when its shared AI secret is configured", async () => {
  const objects = new Map<string, string>();
  const requests: string[] = [];
  const env = {
    WEB_APP_ORIGIN: "https://site.test",
    SEC_REFRESH_KEY: "refresh-key",
    SEC_USER_AGENT: "test@example.com",
    AI_API_KEY: "worker-model-secret",
    SEC_ANALYSIS_MODEL: "deepseek-v4-flash",
    SEC_FILINGS: {
      async get(key: string) {
        const value = objects.get(key);
        return value === undefined ? null : { async text() { return value; } };
      },
      async put(key: string, value: string) {
        objects.set(key, value);
        return {};
      },
    },
  } as SecPipelineEnv;
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    requests.push(url);
    if (url === filing.documentUrl) return new Response("<h1>Item 7. Management Discussion</h1><p>Revenue was 120 USDm.</p>");
    if (url === "https://api.b.ai/v1/chat/completions") {
      const prepared = JSON.parse(objects.get("filings/MSFT/annual/meta.json") ?? "{}") as { outline?: Array<{ id: string }> };
      return Response.json({ choices: [{ message: { content: JSON.stringify({ nodes: [{ id: "growth", title: "增长质量", question: "增长由什么驱动？", sectionIds: [prepared.outline?.[0]?.id] }] }) } }] });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  const operations = createSecPipelineOperations(env, fetcher);
  const reference = await operations.prepare(filing);

  await operations.plan(filing, reference);

  assert.ok(requests.includes("https://api.b.ai/v1/chat/completions"));
  assert.equal(requests.some((url) => url.includes("/api/internal/sec/model")), false);
});

test("plans and runs dynamic nodes from the prepared R2 filing", async () => {
  const objects = new Map<string, string>();
  const env = {
    WEB_APP_ORIGIN: "https://site.test",
    SEC_REFRESH_KEY: "refresh-key",
    SEC_USER_AGENT: "test@example.com",
    AI_API_KEY: "worker-model-secret",
    SEC_FILINGS: {
      async get(key: string) {
        const value = objects.get(key);
        return value === undefined ? null : { async text() { return value; } };
      },
      async put(key: string, value: string) {
        objects.set(key, value);
        return {};
      },
    },
  } as SecPipelineEnv;
  const fetcher: typeof fetch = async (input, init) => {
    if (String(input) === filing.documentUrl) {
      return new Response("<h1>Item 7. Management Discussion</h1><p>Revenue increased 12% to $120 million due to cloud demand.</p>");
    }
    const body = JSON.parse(String(init?.body ?? "{}")) as { messages?: Array<{ content?: string }> };
    const system = body.messages?.[0]?.content ?? "";
    if (system.includes("编排分析任务")) {
      const prepared = JSON.parse(objects.get("filings/MSFT/annual/meta.json") ?? "{}") as { outline?: Array<{ id: string }> };
      return Response.json({ choices: [{ message: { content: JSON.stringify({ nodes: [{ id: "growth", title: "增长质量", question: "增长由什么驱动？", sectionIds: [prepared.outline?.[0]?.id], keywords: ["revenue", "cloud"] }] }) } }] });
    }
    return Response.json({ choices: [{ message: { content: JSON.stringify({ findings: [{ label: "收入", detail: "收入同比增长12%。", importance: "high" }], narrative: "云需求推动收入增长。" }) } }] });
  };
  const operations = createSecPipelineOperations(env, fetcher);
  const reference = await operations.prepare(filing);
  const plan = await operations.plan(filing, reference);
  const node = await operations.analyzeNode(plan.nodes[0] as SecNodeSpec, filing, reference);

  assert.equal(plan.nodes.length, 1);
  assert.equal(node.status, "complete");
  assert.match(node.narrative, /云需求/);
});

test("fetches XBRL during prepare and resolves context in one bridge call", async () => {
  const objects = new Map<string, string>();
  const contextPosts: Array<Record<string, unknown>> = [];
  const env = {
    WEB_APP_ORIGIN: "https://site.test",
    SEC_REFRESH_KEY: "refresh-key",
    SEC_USER_AGENT: "test@example.com",
    AI_API_KEY: "worker-model-secret",
    SEC_FILINGS: {
      async get(key: string) {
        const value = objects.get(key);
        return value === undefined ? null : { async text() { return value; } };
      },
      async put(key: string, value: string) {
        objects.set(key, value);
        return {};
      },
    },
  } as SecPipelineEnv;
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url === filing.documentUrl) return new Response("<h1>Item 7. Management Discussion</h1><p>Revenue was 120 USDm.</p>");
    if (url.includes("/api/xbrl/companyfacts/")) {
      return Response.json({ facts: { "us-gaap": { Revenues: { units: { USD: [
        { start: "2025-07-01", end: "2026-06-30", val: 120, accn: "annual", fy: 2026, fp: "FY", form: "10-K", filed: "2026-07-30" },
      ] } } } } });
    }
    if (url.endsWith("/api/internal/sec/context")) {
      contextPosts.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Response.json({ context: { currentPeriodId: "MSFT:2026-06-30:annual", qoqPeriodId: null, yoyPeriodId: null } });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  const operations = createSecPipelineOperations(env, fetcher);

  const reference = await operations.prepare(filing);
  const context = await operations.getContext(filing, reference);
  const brief = await operations.buildBrief!(filing, reference, context);

  assert.equal(contextPosts.length, 1, "context must be resolved and persisted in a single call");
  assert.ok((contextPosts[0].history as { series: unknown[] }).series.length > 0);
  assert.deepEqual([...objects.keys()].filter((key) => key.startsWith("filings/")).sort(), [
    "filings/MSFT/annual/history.json",
    "filings/MSFT/annual/meta.json",
    "filings/MSFT/annual/text.json",
  ]);
  assert.ok(JSON.parse(objects.get("filings/MSFT/annual/meta.json")!).blockIds.length > 0);
  assert.equal(JSON.parse(objects.get("filings/MSFT/annual/meta.json")!).document, undefined);
  assert.deepEqual(brief.currentFacts.map((fact) => [fact.metricKey, fact.value]), [["revenue", "120"]]);
});

test("publishes cited evidence in bounded D1 bridge calls", async () => {
  const blocks = Array.from({ length: 20 }, (_, ordinal) => ({
    blockId: `block-${ordinal}`,
    ordinal,
    heading: "Financial Statements",
    headingPath: "Item 8",
    elementType: "paragraph" as const,
    preview: `Block ${ordinal}`,
    body: `Revenue evidence ${ordinal}`,
    tokenCount: 3,
    numericDensity: 0.2,
    tableCount: 0,
    contentHash: `hash-${ordinal}`,
  }));
  const citedBlocks = blocks.slice(0, 18);
  const prepared = {
    filing,
    periodId: "MSFT:2026-06-30:annual",
    periodScope: "annual" as const,
    blocks,
    document: { text: blocks.map((block) => block.body).join("\n"), headings: [] },
    outline: [],
  };
  const env = {
    WEB_APP_ORIGIN: "https://site.test",
    SEC_REFRESH_KEY: "refresh-key",
    SEC_USER_AGENT: "test@example.com",
    SEC_FILINGS: {
      async get(key: string) {
        if (key === "filings/MSFT/annual/meta.json") {
          return { async text() { return JSON.stringify({ filing, periodId: prepared.periodId, periodScope: prepared.periodScope, outline: [], blockIds: blocks.map((block) => `ev:${block.blockId}`) }); } };
        }
        if (key === "filings/MSFT/annual/text.json") {
          return { async text() { return JSON.stringify({ document: prepared.document, blocks }); } };
        }
        return null;
      },
      async put() { return {}; },
    },
  } as unknown as SecPipelineEnv;
  const artifact = {
    filing,
    periodId: prepared.periodId,
    periodScope: prepared.periodScope,
    blocks: [],
    comparisons: [],
    report: {
      ticker: "MSFT",
      periodId: prepared.periodId,
      reportVersion: "v1",
      headline: "verified",
      keyMetrics: [{ metricKey: "revenue", currentValue: "331839", status: "verified" as const, evidenceIds: citedBlocks.map((block) => `ev:${block.blockId}`) }],
      changes: { qoq: [], yoy: [], guidance: [], risks: [] },
      dataQuality: { coverage: 1, verificationStatus: "verified" as const, warnings: [] },
    },
  } satisfies SecAnalysisArtifact;
  const published: Array<{ artifact: SecAnalysisArtifact; summary: unknown }> = [];
  const fetcher: typeof fetch = async (_input, init) => {
    published.push(JSON.parse(String(init?.body)) as { artifact: SecAnalysisArtifact; summary: unknown });
    return Response.json({ status: "ok" });
  };

  await createSecPipelineOperations(env, fetcher).publish(artifact, null);

  assert.equal(published.length, 2);
  const blockPosts = published.slice(0, -1) as unknown as Array<{ filing: SecFiling; blocks: Array<{ blockId: string }>; artifact?: unknown }>;
  assert.deepEqual(blockPosts.flatMap((body) => body.blocks.map((block) => block.blockId)), citedBlocks.map((block) => block.blockId));
  assert.ok(blockPosts.every((body) => body.artifact === undefined), "evidence posts must not resend the report");
  assert.ok(blockPosts.every((body) => body.blocks.length <= 40));
  assert.equal(published.at(-1)?.artifact.report.dataQuality.verificationStatus, "verified");
  assert.deepEqual(published.at(-1)?.artifact.blocks, []);
});

test("publishes event summaries without creating a structured filing artifact", async () => {
  const requestBodies: Array<Record<string, unknown>> = [];
  const env = {
    WEB_APP_ORIGIN: "https://site.test",
    SEC_REFRESH_KEY: "refresh-key",
    SEC_USER_AGENT: "test@example.com",
    SEC_FILINGS: { async get() { return null; }, async put() { return {}; } },
  } as unknown as SecPipelineEnv;
  const summary = {
    ticker: "MSFT", form: "8-K", filingDate: "2026-08-10", accessionNumber: "event",
    headline: "事件简析", bullets: [{ label: "事件", detail: "影响已披露。", importance: "high" as const }],
    analystView: "事件改变短期预期。", source: "deepseek" as const, generatedAt: "2026-08-10T00:00:00.000Z",
  };

  await createSecPipelineOperations(env, async (_input, init) => {
    requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return Response.json({ status: "published" });
  }).publishEvent(summary);

  assert.equal(requestBodies.length, 1);
  assert.deepEqual(requestBodies[0].filing, { ticker: "MSFT", form: "8-K", filingDate: "2026-08-10", accessionNumber: "event" });
  assert.equal("artifact" in requestBodies[0], false);
});
