import { FundamentalSyncService } from "../../lib/fundamental-sync.ts";
import { D1FundamentalsRepository, FundamentalSyncInProgressError, type FundamentalsD1Database } from "../../lib/fundamentals-d1.ts";

export type FundamentalsSyncOutcome = {
  ticker: string;
  status: "synced" | "in-progress";
  qualityStatus?: string;
  observationCount?: number;
  fetchedAt?: string;
};

/**
 * The Yahoo sync used to run on the Web Worker: this Worker's cron POSTed
 * `/api/internal/fundamentals/refresh`, and the request handler kicked the fetch off in a
 * `waitUntil` before answering. That put outbound third-party fetching on the Worker that serves
 * public traffic, and it put the failure — a rate limit, a schema change at Yahoo — inside a
 * request the reader was still waiting on. Here it is an ordinary durable step: the Worker that
 * owns the schedule also does the fetching, and a failure is retried by the Workflow instead of
 * being swallowed by a request that already returned.
 */
export async function syncFundamentals(database: FundamentalsD1Database, ticker: string): Promise<FundamentalsSyncOutcome> {
  const service = new FundamentalSyncService(new D1FundamentalsRepository(database));
  try {
    const result = await service.syncTicker(ticker);
    return {
      ticker,
      status: "synced",
      qualityStatus: result.qualityStatus,
      observationCount: result.observationCount,
      fetchedAt: result.fetchedAt,
    };
  } catch (error) {
    // Another run already holds this ticker's lease. That is ordinary contention, not a failure,
    // and retrying the step would only take a number in the same queue.
    if (error instanceof FundamentalSyncInProgressError) return { ticker, status: "in-progress" };
    throw error;
  }
}
