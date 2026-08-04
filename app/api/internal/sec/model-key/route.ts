import { hasInternalSecAccess } from "@/lib/sec-api";
import { encryptSecModelKey } from "@/lib/sec-key-bootstrap";
import { getSecRuntimeConfig } from "@/lib/sec-runtime";

export async function POST(request: Request) {
  const runtime = await getSecRuntimeConfig();
  if (!await hasInternalSecAccess(request, runtime.refreshKey)) {
    return Response.json({ error: "无权读取 SEC 模型配置。" }, { status: 401 });
  }
  if (!runtime.apiKey || !runtime.bootstrapPublicKey) {
    return Response.json({ error: "SEC 模型配置不完整。" }, { status: 503 });
  }
  const ciphertext = await encryptSecModelKey(runtime.apiKey, runtime.bootstrapPublicKey);
  return Response.json({ ciphertext }, { headers: { "cache-control": "no-store" } });
}
