import { FundamentalSyncService } from "./fundamental-sync.ts";
import {
  FundamentalSyncInProgressError,
  type FundamentalsRepository,
} from "./fundamentals-d1.ts";

export type FundamentalRefreshSchedulerOptions = {
  waitUntil?: (promise: Promise<unknown>) => void;
  syncTicker?: (ticker: string) => Promise<unknown>;
};


export async function scheduleFundamentalRefresh(
  repository: FundamentalsRepository,
  ticker: string,
  options: FundamentalRefreshSchedulerOptions = {},
): Promise<boolean> {
  try {
    const waitUntil = options.waitUntil;
    if (!waitUntil) return false;
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
