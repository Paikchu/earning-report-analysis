import { runCommand } from "./services/result.ts";
import { claimSecMemory } from "./services/sec-memory-claim.ts";
import { hasInternalSecAccess } from "./sec/api.ts";
import { isTrackedTicker, normalizeTrackedTicker, parseTrackedTickers } from "./sec/config.ts";

export type SecWorkflowBinding<T = SecWorkflowParams> = {
  create(options: { id: string; params: T }): Promise<{ id: string }>;
};

export type SecWorkflowParams = {
  ticker: string;
  requestedBy: "scheduled" | "manual";
  backfill?: boolean;
};

export type SecMemoryWorkflowParams = {
  jobId: string;
  ticker: string;
  ownerToken?: string;
};

export type CompanyAnalysisWorkflowParams = {
  ticker: string;
  memoryJobId: string;
  memoryVersion: number;
  periodId: string;
  reportDate: string;
  triggerRef: string;
};

export type SecCronEnv = {
  DB: D1Database;
  SEC_TRACKED_TICKERS?: string;
  SEC_REFRESH_KEY: string;
  SEC_ANALYSIS_WORKFLOW: SecWorkflowBinding;
  SEC_MEMORY_WORKFLOW?: SecWorkflowBinding<SecMemoryWorkflowParams>;
  COMPANY_ANALYSIS_WORKFLOW?: SecWorkflowBinding<CompanyAnalysisWorkflowParams>;
};

/** Pipeline owns collection policy; Web availability never affects scheduling. */

export async function runSecRefresh(env: SecCronEnv, now = Date.now()) {
  if (!env.SEC_ANALYSIS_WORKFLOW) {
    throw new Error("SEC cron environment is incomplete");
  }
  const tickers = parseTrackedTickers(env.SEC_TRACKED_TICKERS);
  const started: string[] = [];
  const failed: string[] = [];
  for (const ticker of [...new Set(tickers)]) {
    try {
      await startWorkflow(env.SEC_ANALYSIS_WORKFLOW, ticker, "scheduled", now, false);
      started.push(ticker);
    } catch {
      failed.push(ticker);
    }
  }
  return { started, failed };
}

export async function runSecMemorySweep(env: SecCronEnv): Promise<{ started: string[] }> {
  if (!env.SEC_MEMORY_WORKFLOW) return { started: [] };
  const ownerToken = `sweeper:${crypto.randomUUID()}`;
  const body = await runCommand<{ claim: { jobId: string; ticker: string } | null }>(claimSecMemory, env, { ownerToken });
  if (!body.claim) return { started: [] };
  await env.SEC_MEMORY_WORKFLOW.create({
    id: `memory-${crypto.randomUUID()}`,
    params: { jobId: body.claim.jobId, ticker: body.claim.ticker, ownerToken },
  });
  return { started: [body.claim.jobId] };
}

export async function handleSecAnalysisRequest(request: Request, env: SecCronEnv, now = Date.now()): Promise<Response> {
  if (request.method !== "POST") return new Response("Not found", { status: 404 });
  if (!await hasInternalSecAccess(request, env.SEC_REFRESH_KEY)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const match = new URL(request.url).pathname.match(/^\/(jobs|backfill)\/([^/]+)$/);
  if (!match) return Response.json({ error: "Not found" }, { status: 404 });
  const mode = match?.[1] ?? "jobs";
  let rawTicker = "";
  try {
    rawTicker = decodeURIComponent(match?.[2] ?? "");
  } catch {
    return Response.json({ error: "Invalid ticker" }, { status: 400 });
  }
  const ticker = normalizeTrackedTicker(rawTicker);
  if (!ticker) return Response.json({ error: "Invalid ticker" }, { status: 400 });
  let trackedTickers: string[];
  try {
    trackedTickers = parseTrackedTickers(env.SEC_TRACKED_TICKERS);
  } catch {
    return Response.json({ error: "Analysis service unavailable", code: "UNAVAILABLE" }, { status: 503 });
  }
  if (!isTrackedTicker(ticker, trackedTickers)) return Response.json({ error: "Ticker is not tracked" }, { status: 403 });
  try {
    const instance = await startWorkflow(env.SEC_ANALYSIS_WORKFLOW, ticker, "manual", now, mode === "backfill");
    return Response.json({ status: "queued", jobId: instance.id, ticker, mode }, { status: 202 });
  } catch {
    return Response.json({ error: "Unable to queue analysis", code: "UNAVAILABLE" }, { status: 503 });
  }
}

async function startWorkflow(binding: SecWorkflowBinding, ticker: string, requestedBy: SecWorkflowParams["requestedBy"], now: number, backfill: boolean) {
  const runKey = requestedBy === "manual" ? `${now}-${crypto.randomUUID()}` : Math.floor(now / (5 * 60_000));
  const id = `${requestedBy}-${ticker}-${runKey}`;
  return binding.create({ id, params: { ticker, requestedBy, backfill } });
}
