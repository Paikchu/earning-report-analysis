import { getD1 } from "@/db";
import {
  handlePublicFundamentalsRequest,
} from "@/lib/fundamentals-api";
import { D1FundamentalsRepository } from "@/lib/fundamentals-d1";
import { scheduleFundamentalRefresh } from "@/lib/fundamentals-runtime";
import { findSecurity } from "@/lib/site-data";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await context.params;
  return handlePublicFundamentalsRequest(request, ticker, {
    getRepository: async () => new D1FundamentalsRepository(await getD1()),
    isRefreshEligible: (normalizedTicker) => findSecurity(normalizedTicker)?.type === "stock",
    scheduleRefresh: scheduleFundamentalRefresh,
  });
}
