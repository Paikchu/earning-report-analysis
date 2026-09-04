import { FundamentalSyncInProgressError } from "./fundamentals-d1.ts";
import { getSecRuntimeConfig } from "./sec-runtime.ts";

export type FundamentalRefreshSchedulerOptions = {
  waitUntil?: (promise: Promise<unknown>) => void;
  syncTicker?: (ticker: string) => Promise<unknown>;
};

const CLOUDFLARE_WORKERS_MODULE = "cloudflare:workers";

export async function scheduleFundamentalRefresh(
  ticker: string,
  options: FundamentalRefreshSchedulerOptions = {},
): Promise<boolean> {
  try {
    const runtime = options.waitUntil
      ? null
      : await import(/* @vite-ignore */ CLOUDFLARE_WORKERS_MODULE) as {
        waitUntil(promise: Promise<unknown>): void;
      };
    const waitUntil = options.waitUntil ?? runtime!.waitUntil;
    const syncTicker = options.syncTicker ?? requestFundamentalRefresh;
    waitUntil(syncTicker(ticker).catch((error) => {
      // Another request already holds the ticker's lease. That is ordinary contention, not a failure.
      if (error instanceof FundamentalSyncInProgressError) return;
      /**
       * The old handler logged the error's name and swallowed the rejection, and both halves hid a
       * refresh that stayed broken for a day: the name of a D1 error is just "Error", so the
       * constraint that actually rejected every write never reached a log, and a swallowed
       * rejection leaves the invocation recorded as a success. The message goes to the log, and
       * the rejection goes back to the runtime, which is the only part of a request anything can
       * alert on. The response is already sent by this point, so no reader is affected.
       */
      console.error(JSON.stringify({
        event: "fundamentals-refresh-failed",
        ticker,
        errorName: error instanceof Error ? error.name : "UnknownError",
        error: error instanceof Error ? error.message : String(error),
      }));
      throw error;
    }));
    return true;
  } catch {
    return false;
  }
}

/**
 * The sync itself runs on the Pipeline Worker, which owns the D1 write and the cron that keeps
 * fundamentals fresh on its own. This is a control-plane request, not a data one: it asks the
 * Worker below this one to do the work, the same way an admin-triggered SEC refresh does — Web
 * does not touch D1 for this at all.
 */
async function requestFundamentalRefresh(ticker: string): Promise<void> {
  const runtime = await getSecRuntimeConfig();
  const origin = runtime.pipelineOrigin.replace(/\/+$/, "");
  const response = await runtime.pipelineFetch(`${origin}/fundamentals/refresh/${encodeURIComponent(ticker)}`, {
    method: "POST",
    headers: { "x-sec-refresh-key": runtime.refreshKey },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Fundamentals refresh HTTP ${response.status}`);
}
