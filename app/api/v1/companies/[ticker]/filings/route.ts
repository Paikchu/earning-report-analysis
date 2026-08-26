import { getD1 } from "@/db";
import { getPublicFilingPage } from "@/lib/sec-public-api";
import { D1SecRepository } from "@/lib/sec-d1";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await context.params;
  const url = new URL(request.url);
  try {
    const page = await getPublicFilingPage(new D1SecRepository(await getD1()), ticker, url.searchParams.get("cursor"), url.searchParams.get("limit"));
    return Response.json(page, { headers: publicHeaders() });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "SEC filing query failed" }, { status: 400 });
  }
}

function publicHeaders(): HeadersInit {
  return {
    "cache-control": "public, max-age=30, stale-while-revalidate=300",
    "access-control-allow-origin": "*",
    vary: "Origin",
  };
}
