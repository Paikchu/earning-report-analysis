import { parseTrackedTickers } from "./sec-config.ts";

type SecRuntimeConfig = {
  refreshKey: string;
  pipelineOrigin: string;
  adminToken: string;
  trackedTickers: string[];
};

export async function getSecRuntimeConfig(): Promise<SecRuntimeConfig> {
  const { env } = await import("cloudflare:workers");
  const values = env as unknown as Record<string, unknown>;
  return {
    refreshKey: stringValue(values.SEC_REFRESH_KEY),
    pipelineOrigin: stringValue(values.SEC_PIPELINE_ORIGIN) || "https://earning-report-analysis-sec-pipeline.example.workers.dev",
    adminToken: stringValue(values.SEC_ADMIN_TOKEN),
    trackedTickers: parseTrackedTickers(stringValue(values.SEC_TRACKED_TICKERS)),
  };
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
