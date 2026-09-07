import { proxyAnalysisRequest } from "@/lib/web/analysis-client";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return proxyAnalysisRequest(request); }
