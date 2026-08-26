import type { SecServiceRuntime } from "./sec-service.ts";
import { parseTrackedTickers } from "./sec-config.ts";

type SecRuntimeConfig = SecServiceRuntime & {
  refreshKey: string;
  pipelineOrigin: string;
  adminToken: string;
  migrationKey: string;
  trackedTickers: string[];
};

export async function getSecRuntimeConfig(): Promise<SecRuntimeConfig> {
  const { env } = await import("cloudflare:workers");
  const values = env as unknown as Record<string, unknown>;
  return {
    apiKey: "",
    model: stringValue(values.SEC_ANALYSIS_MODEL) || "deepseek-v4-flash",
    userAgent: stringValue(values.SEC_USER_AGENT) || "max-investment-record/1.0 max.zhangyuchen@gmail.com",
    refreshKey: stringValue(values.SEC_REFRESH_KEY),
    pipelineOrigin: stringValue(values.SEC_PIPELINE_ORIGIN) || "https://earning-report-analysis-sec-pipeline.example.workers.dev",
    adminToken: stringValue(values.SEC_ADMIN_TOKEN),
    migrationKey: stringValue(values.SEC_MIGRATION_KEY),
    trackedTickers: parseTrackedTickers(stringValue(values.SEC_TRACKED_TICKERS)),
  };
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
