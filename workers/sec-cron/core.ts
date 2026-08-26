import { cleanSecTicker } from "../../lib/sec.ts";

export type SecWorkflowBinding<T = SecWorkflowParams> = {
  create(options: { id: string; params: T }): Promise<{ id: string }>;
};

export type SecWorkflowParams = {
  ticker: string;
  requestedBy: "scheduled" | "manual";
};

export type SecMemoryWorkflowParams = {
  jobId: string;
  ticker: string;
  ownerToken?: string;
};

export type SecCronEnv = {
  MAX_SITE_ORIGIN: string;
  MAX_SITE_BYPASS_TOKEN: string;
  SEC_REFRESH_KEY: string;
  SEC_ANALYSIS_WORKFLOW: SecWorkflowBinding;
  SEC_MEMORY_WORKFLOW?: SecWorkflowBinding<SecMemoryWorkflowParams>;
};

export async function runSecRefresh(env: SecCronEnv, fetcher: typeof fetch = fetch, now = Date.now()) {
  const origin = env.MAX_SITE_ORIGIN.replace(/\/+$/, "");
  if (!origin || !env.MAX_SITE_BYPASS_TOKEN || !env.SEC_REFRESH_KEY || !env.SEC_ANALYSIS_WORKFLOW) {
    throw new Error("SEC cron environment is incomplete");
  }
  const response = await fetcher(`${origin}/api/internal/sec/watchlist`, {
    headers: siteHeaders(env),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`SEC watchlist HTTP ${response.status}`);
  const body = await response.json() as { tickers?: unknown };
  const tickers = Array.isArray(body.tickers) ? body.tickers.map(String).map(cleanSecTicker).filter(Boolean) : [];
  const started: string[] = [];
  const failed: string[] = [];
  for (const ticker of [...new Set(tickers)]) {
    try {
      await startWorkflow(env.SEC_ANALYSIS_WORKFLOW, ticker, "scheduled", now);
      started.push(ticker);
    } catch {
      failed.push(ticker);
    }
  }
  return { started, failed };
}

export async function runSecMemorySweep(env: SecCronEnv, fetcher: typeof fetch = fetch): Promise<{ started: string[] }> {
  if (!env.SEC_MEMORY_WORKFLOW) return { started: [] };
  const ownerToken = `sweeper:${crypto.randomUUID()}`;
  const response = await fetcher(`${env.MAX_SITE_ORIGIN.replace(/\/+$/, "")}/api/internal/sec/memory/claim`, {
    method: "POST",
    headers: siteHeaders(env),
    body: JSON.stringify({ ownerToken }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`SEC memory claim HTTP ${response.status}`);
  const body = await response.json() as { claim?: { jobId: string; ticker: string } | null };
  if (!body.claim) return { started: [] };
  await env.SEC_MEMORY_WORKFLOW.create({
    id: `memory-${crypto.randomUUID()}`,
    params: { jobId: body.claim.jobId, ticker: body.claim.ticker, ownerToken },
  });
  return { started: [body.claim.jobId] };
}

export async function handleSecAnalysisRequest(request: Request, env: SecCronEnv, now = Date.now()): Promise<Response> {
  if (request.method !== "POST") return new Response("Not found", { status: 404 });
  if (!env.SEC_REFRESH_KEY || request.headers.get("x-sec-refresh-key") !== env.SEC_REFRESH_KEY) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const match = new URL(request.url).pathname.match(/^\/jobs\/([^/]+)$/);
  const ticker = cleanSecTicker(decodeURIComponent(match?.[1] ?? ""));
  if (!ticker) return Response.json({ error: "Invalid ticker" }, { status: 400 });
  try {
    const instance = await startWorkflow(env.SEC_ANALYSIS_WORKFLOW, ticker, "manual", now);
    return Response.json({ status: "queued", jobId: instance.id, ticker }, { status: 202 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to queue analysis" }, { status: 503 });
  }
}

export function siteHeaders(env: Pick<SecCronEnv, "MAX_SITE_BYPASS_TOKEN" | "SEC_REFRESH_KEY">) {
  return {
    "content-type": "application/json",
    "oai-sites-authorization": `Bearer ${env.MAX_SITE_BYPASS_TOKEN}`,
    "x-sec-refresh-key": env.SEC_REFRESH_KEY,
  };
}

async function startWorkflow(binding: SecWorkflowBinding, ticker: string, requestedBy: SecWorkflowParams["requestedBy"], now: number) {
  const runKey = requestedBy === "manual" ? `${now}-${crypto.randomUUID()}` : Math.floor(now / (5 * 60_000));
  const id = `${requestedBy}-${ticker}-${runKey}`;
  return binding.create({ id, params: { ticker, requestedBy } });
}
