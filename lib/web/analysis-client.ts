import type { PublicFilingResponse } from "../../shared/analysis-contract/filings.ts";

export type AnalysisTransport = {
  binding?: { fetch(request: Request): Promise<Response> };
  origin?: string;
  token: string;
};

/** All service details stay here. Routes and components never import a Worker implementation. */
export function createAnalysisClient(transport: AnalysisTransport) {
  return {
    async request(path: string, method: "GET" | "POST" = "GET"): Promise<Response> {
      if (!path.startsWith("/api/v1/") || path.startsWith("//")) throw new Error("Invalid analysis API path");
      if (!transport.token || (!transport.binding && !transport.origin)) return unavailable();
      try {
        const request = new Request(new URL(path, transport.binding ? "https://analysis.internal" : transport.origin), {
          method,
          headers: { "x-sec-refresh-key": transport.token },
          signal: AbortSignal.timeout(15_000),
        });
        const response = transport.binding ? await transport.binding.fetch(request) : await fetch(request);
        const headers = new Headers();
        for (const name of ["content-type", "cache-control", "x-analysis-api-version", "x-company-analysis-schema"]) {
          const value = response.headers.get(name);
          if (value) headers.set(name, value);
        }
        headers.set("access-control-allow-origin", "*");
        return new Response(response.body, { status: response.status, headers });
      } catch { return unavailable(); }
    },
  };
}

export async function getAnalysisClient() {
  const { env } = await import("cloudflare:workers");
  const values = env as unknown as { ANALYSIS_SERVICE?: AnalysisTransport["binding"]; SEC_PIPELINE_ORIGIN?: string; SEC_REFRESH_KEY?: string };
  return createAnalysisClient({ binding: values.ANALYSIS_SERVICE, origin: values.SEC_PIPELINE_ORIGIN, token: values.SEC_REFRESH_KEY ?? "" });
}

export async function proxyAnalysisRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  return (await getAnalysisClient()).request(url.pathname + url.search, request.method === "POST" ? "POST" : "GET");
}

export async function getPublicFiling(ticker: string, accession: string): Promise<PublicFilingResponse | null> {
  const response = await (await getAnalysisClient()).request(`/api/v1/companies/${encodeURIComponent(ticker)}/filings/${encodeURIComponent(accession)}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("财报分析服务暂时不可用。");
  return response.json() as Promise<PublicFilingResponse>;
}

function unavailable() {
  return Response.json({ error: "Analysis service unavailable", code: "UNAVAILABLE" }, { status: 503, headers: { "cache-control": "no-store" } });
}
