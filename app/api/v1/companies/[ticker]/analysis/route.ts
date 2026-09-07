import { proxyAnalysisRead } from "../../../../../../lib/web/analysis-proxy.ts";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await context.params;
  return proxyAnalysisRead(request, (client) => client.getCompanyAnalysis(ticker));
}
