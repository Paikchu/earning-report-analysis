import { getD1 } from "@/db";
import { D1CompanyAnalysisRepository } from "@/lib/company-analysis/repository";
import { hasInternalSecAccess } from "@/lib/sec-api";
import { getSecRuntimeConfig } from "@/lib/sec-runtime";

export async function POST(request: Request) {
  const runtime = await getSecRuntimeConfig();
  if (!await hasInternalSecAccess(request, runtime.refreshKey)) {
    return Response.json({ error: "无权读取公司分析补齐任务。" }, { status: 401 });
  }
  const body = await request.json().catch(() => null) as { limit?: number; includeIncomplete?: boolean } | null;
  const limit = Number.isFinite(body?.limit) ? Number(body?.limit) : 100;
  const candidates = await new D1CompanyAnalysisRepository(await getD1())
    .listBackfillCandidates(runtime.trackedTickers, limit, body?.includeIncomplete === true);
  return Response.json({ candidates }, { headers: { "cache-control": "no-store" } });
}
