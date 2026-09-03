import { getD1 } from "@/db";
import { handlePublicCompanyAnalysisRequest } from "@/lib/company-analysis/api";
import { D1CompanyAnalysisRepository } from "@/lib/company-analysis/repository";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await context.params;
  return handlePublicCompanyAnalysisRequest(new D1CompanyAnalysisRepository(await getD1()), ticker);
}
