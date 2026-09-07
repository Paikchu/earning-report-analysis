import { readFile, writeFile } from "node:fs/promises";

import { WEB_WORKER_CONFIG_PATH } from "../config.ts";

/**
 * Prepares the generated Web Worker config for deployment.
 *
 * It used to exist to inject the real D1 id, because `vinext build` bakes a placeholder into the
 * generated config. The Web Worker no longer binds D1 at all, so the job reversed: this script now
 * *strips* any D1 binding the generator emits, and `check-config.ts` refuses a config that still
 * carries one. A leftover binding would be exactly the unexplained direct database access the
 * service boundary was drawn to remove.
 */
const configPath = process.env.SEC_WEB_WRANGLER_CONFIG ?? WEB_WORKER_CONFIG_PATH;
const config = JSON.parse(await readFile(configPath, "utf8")) as {
  name?: string;
  d1_databases?: Array<{ binding: string }>;
  services?: Array<{ binding: string; service: string }>;
  vars?: Record<string, string>;
};

const removedD1Bindings = (config.d1_databases ?? []).map((binding) => binding.binding);
delete config.d1_databases;

if (!config.services?.some((binding) => binding.binding === "PIPELINE")) {
  throw new Error("Generated Vinext config does not contain the PIPELINE service binding — every analysis read depends on it");
}

config.name = process.env.SEC_WEB_WORKER_NAME?.trim() || "earning-report-analysis-sec-web";
config.vars = {
  ...config.vars,
  ...(process.env.SEC_PIPELINE_ORIGIN ? { SEC_PIPELINE_ORIGIN: process.env.SEC_PIPELINE_ORIGIN.trim() } : {}),
};

await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  configPath,
  worker: config.name,
  removedD1Bindings,
  pipelineServiceBinding: true,
}));
