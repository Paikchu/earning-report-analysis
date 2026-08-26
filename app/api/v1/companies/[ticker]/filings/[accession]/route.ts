import { getD1 } from "@/db";
import { getPublicFiling } from "@/lib/sec-public-api";
import { D1SecRepository } from "@/lib/sec-d1";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ ticker: string; accession: string }> }) {
  const { ticker, accession } = await context.params;
  const result = await getPublicFiling(new D1SecRepository(await getD1()), ticker, accession);
  if (!result) return Response.json({ error: "SEC filing not found" }, { status: 404 });
  return Response.json(result, { headers: {
    "cache-control": "public, max-age=30, stale-while-revalidate=300",
    "access-control-allow-origin": "*",
    vary: "Origin",
  } });
}
