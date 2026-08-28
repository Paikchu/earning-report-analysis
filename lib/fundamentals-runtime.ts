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
      if (error instanceof FundamentalSyncInProgressError) return;
      console.error("Fundamentals background refresh failed.", {
        ticker,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }));
    return true;
  } catch {
    return false;
  }
}
