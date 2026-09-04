import { FundamentalSyncService } from "./fundamental-sync.ts";
import {
  FundamentalSyncInProgressError,
  type FundamentalsRepository,
} from "./fundamentals-d1.ts";

export type FundamentalRefreshSchedulerOptions = {
  waitUntil?: (promise: Promise<unknown>) => void;
  syncTicker?: (ticker: string) => Promise<unknown>;
};

const CLOUDFLARE_WORKERS_MODULE = "cloudflare:workers";

export async function scheduleFundamentalRefresh(
  repository: FundamentalsRepository,
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
    const syncTicker = options.syncTicker ?? ((value: string) =>
      new FundamentalSyncService(repository).syncTicker(value));
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
