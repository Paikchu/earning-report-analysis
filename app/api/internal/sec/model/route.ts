import { hasInternalSecAccess } from "@/lib/sec-api";
import { getSecRuntimeConfig } from "@/lib/sec-runtime";
import { callSecModel } from "@/lib/sec-service";

export async function POST(request: Request) {
  const runtime = await getSecRuntimeConfig();
  if (!await hasInternalSecAccess(request, runtime.refreshKey)) return Response.json({ error: "无权调用 SEC 分析模型。" }, { status: 401 });
  const body = await request.json().catch(() => null) as { stage?: string; system?: string; payload?: unknown } | null;
  const system = typeof body?.system === "string" ? body.system : "";
  if (!body || !system || system.length > 8_000 || JSON.stringify(body.payload ?? null).length > 1_500_000) {
    return Response.json({ error: "SEC 模型请求无效。" }, { status: 400 });
  }
  try {
    const value = await callSecModel(runtime, system, body.payload);
    return Response.json({ stage: body.stage ?? "unknown", value }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "SEC model failed";
    return Response.json({ error: message.slice(0, 300) }, { status: 502 });
  }
}
