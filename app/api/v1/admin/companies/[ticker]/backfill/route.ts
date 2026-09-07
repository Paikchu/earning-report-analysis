import { proxyAnalysisRequest } from "@/lib/web/analysis-client";
import { hasSecAdminAccess } from "@/lib/web/admin-auth";
export async function POST(request: Request) {
  const { env } = await import("cloudflare:workers");
  const token = (env as unknown as { SEC_ADMIN_TOKEN?: string }).SEC_ADMIN_TOKEN ?? "";
  if (!await hasSecAdminAccess(request, token)) return Response.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  return proxyAnalysisRequest(request);
}
