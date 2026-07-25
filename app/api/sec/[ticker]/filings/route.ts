import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getD1 } from "@/db";
import { handleSecFeedRequest } from "@/lib/sec-api";
import { D1SecRepository } from "@/lib/sec-d1";
import { findSecurity } from "@/lib/site-data";

export async function GET(_request: Request, context: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await context.params;
  const security = findSecurity(ticker);
  return handleSecFeedRequest({
    user: await getChatGPTUser(),
    ticker,
    security: security ? { symbol: security.symbol, type: security.type } : null,
    repository: new D1SecRepository(await getD1()),
  });
}
