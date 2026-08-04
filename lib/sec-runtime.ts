import type { SecServiceRuntime } from "./sec-service.ts";

type SecRuntimeConfig = SecServiceRuntime & {
  refreshKey: string;
  pipelineOrigin: string;
  bootstrapPublicKey: string;
};

export async function getSecRuntimeConfig(): Promise<SecRuntimeConfig> {
  const { env } = await import("cloudflare:workers");
  const values = env as unknown as Record<string, unknown>;
  return {
    apiKey: stringValue(values.DEEPSEEK_API_KEY),
    model: stringValue(values.SEC_ANALYSIS_MODEL) || "deepseek-v4-flash",
    userAgent: stringValue(values.SEC_USER_AGENT) || "max-investment-record/1.0 max.zhangyuchen@gmail.com",
    refreshKey: stringValue(values.SEC_REFRESH_KEY),
    pipelineOrigin: stringValue(values.SEC_PIPELINE_ORIGIN) || "https://max-investment-record-sec-cron.max-zhangyuchen.workers.dev",
    bootstrapPublicKey: stringValue(values.SEC_BOOTSTRAP_PUBLIC_KEY),
  };
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
