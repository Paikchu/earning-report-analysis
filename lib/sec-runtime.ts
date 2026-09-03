import { parseTrackedTickers } from "./sec-config.ts";
import { asServiceBinding, serviceFetcher } from "./service-binding.ts";

type SecRuntimeConfig = {
  refreshKey: string;
  pipelineOrigin: string;
  /** Reaches the Pipeline Worker. Its public hostname 404s from inside a Worker, so admin
   *  refresh and backfill have to go through the Service Binding when one is bound. */
  pipelineFetch: typeof fetch;
  adminToken: string;
  trackedTickers: string[];
};

export async function getSecRuntimeConfig(): Promise<SecRuntimeConfig> {
  const { env } = await import("cloudflare:workers");
  const values = env as unknown as Record<string, unknown>;
  return {
    refreshKey: stringValue(values.SEC_REFRESH_KEY),
    pipelineOrigin: stringValue(values.SEC_PIPELINE_ORIGIN) || "https://earning-report-analysis-sec-pipeline.example.workers.dev",
    pipelineFetch: serviceFetcher(asServiceBinding(values.PIPELINE)),
    adminToken: stringValue(values.SEC_ADMIN_TOKEN),
    trackedTickers: parseTrackedTickers(stringValue(values.SEC_TRACKED_TICKERS)),
  };
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
