import { getD1 } from "@/db";
import { hasInternalSecAccess } from "@/lib/sec-api";
import { D1SecRepository } from "@/lib/sec-d1";
import { getSecRuntimeConfig } from "@/lib/sec-runtime";
import { cleanSecTicker, type SecFilingSummary } from "@/lib/sec";
import type { SecAnalysisArtifact } from "@/lib/sec-service";
import { findSecurity } from "@/lib/site-data";

export async function POST(request: Request) {
  const runtime = await getSecRuntimeConfig();
  if (!await hasInternalSecAccess(request, runtime.refreshKey)) return Response.json({ error: "无权发布 SEC 分析。" }, { status: 401 });
  const body = await request.json().catch(() => null) as { artifact?: SecAnalysisArtifact; summary?: SecFilingSummary | null } | null;
  const artifact = body?.artifact;
  const ticker = cleanSecTicker(artifact?.filing?.ticker ?? "");
  const security = findSecurity(ticker);
  if (!artifact || !artifact.filing.accessionNumber || !security || security.type !== "stock") return Response.json({ error: "SEC 分析结果无效。" }, { status: 400 });
  const repository = new D1SecRepository(await getD1());
  await repository.saveAnalysis({ ...artifact, filing: { ...artifact.filing, ticker } });
  if (artifact.report.dataQuality.verificationStatus !== "failed" && body?.summary) await repository.setSummary(body.summary);
  return Response.json({ status: artifact.report.dataQuality.verificationStatus === "failed" ? "rejected" : "published", ticker, accessionNumber: artifact.filing.accessionNumber }, { headers: { "cache-control": "no-store" } });
}
