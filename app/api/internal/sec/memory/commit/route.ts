import { getD1 } from "@/db";
import { hasInternalSecAccess } from "@/lib/sec-api";
import { D1SecRepository, type SecMemoryExtractionPayload, type SecMemoryJobClaim } from "@/lib/sec-d1";
import { getSecRuntimeConfig } from "@/lib/sec-runtime";

export async function POST(request: Request) {
  const runtime = await getSecRuntimeConfig();
  if (!await hasInternalSecAccess(request, runtime.refreshKey)) return Response.json({ error: "无权提交 SEC Memory 任务。" }, { status: 401 });
  const body = await request.json().catch(() => null) as { claim?: SecMemoryJobClaim; extraction?: SecMemoryExtractionPayload } | null;
  if (!body?.claim?.jobId || !body.claim.ownerToken || !Array.isArray(body.extraction?.candidates)) {
    return Response.json({ error: "SEC Memory 提交内容无效。" }, { status: 400 });
  }
  const result = await new D1SecRepository(await getD1()).commitMemoryJob(body.claim, body.extraction);
  return Response.json({ status: "committed", ...result }, { headers: { "cache-control": "no-store" } });
}
