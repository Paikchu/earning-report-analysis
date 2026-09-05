import { readFile } from "node:fs/promises";

import { PIPELINE_WORKER_CONFIG_PATH, WEB_WORKER_CONFIG_PATH } from "../config.ts";

/**
 * Refuses to deploy a Web Worker config that could reach analysis storage directly, or that has
 * lost the Service Binding every analysis read now depends on.
 */
const configPath = process.env.SEC_WEB_WRANGLER_CONFIG ?? WEB_WORKER_CONFIG_PATH;
const pipelineConfigPath = process.env.SEC_PIPELINE_WRANGLER_CONFIG ?? PIPELINE_WORKER_CONFIG_PATH;

const config = JSON.parse(await readFile(configPath, "utf8")) as {
  name?: string;
  compatibility_date?: string;
  compatibility_flags?: string[];
  d1_databases?: Array<{ binding: string; database_name?: string }>;
  r2_buckets?: Array<{ binding: string; bucket_name?: string }>;
  services?: Array<{ binding: string; service?: string }>;
};

const pipelineDate = pipelineCompatibilityDate(await readFile(pipelineConfigPath, "utf8"));
const problems: string[] = [];

if (config.d1_databases?.length) {
  problems.push(
    `still binds D1 (${config.d1_databases.map((binding) => binding.binding).join(", ")}) — the Web Worker reads analysis data through the PIPELINE service binding, not from a database`,
  );
}

if (config.r2_buckets?.length) {
  problems.push(`still binds R2 (${config.r2_buckets.map((binding) => binding.binding).join(", ")}) — analysis artefacts belong to the Pipeline Worker`);
}

if (!config.services?.some((binding) => binding.binding === "PIPELINE")) {
  problems.push("has no PIPELINE service binding — every analysis read and every admin control request goes through it");
}

if (!config.compatibility_flags?.includes("nodejs_compat")) {
  problems.push("is missing the nodejs_compat flag");
}

if (config.compatibility_date !== pipelineDate) {
  problems.push(`uses compatibility_date ${config.compatibility_date}, but the Pipeline Worker uses ${pipelineDate}; both run the same lib/`);
}

if (problems.length) {
  throw new Error([`${configPath} is not deployable:`, ...problems.map((problem) => `  - ${problem}`)].join("\n"));
}

console.log(JSON.stringify({
  configPath,
  worker: config.name,
  compatibilityDate: config.compatibility_date,
  d1Bindings: 0,
  pipelineServiceBinding: true,
}));

function pipelineCompatibilityDate(source: string): string {
  // Wrangler's JSONC allows whole-line comments; value strings such as URLs keep their slashes.
  const parsed = JSON.parse(source.replace(/^\s*\/\/.*$/gm, "")) as { compatibility_date?: string };
  if (!parsed.compatibility_date) throw new Error(`${pipelineConfigPath} has no compatibility_date`);
  return parsed.compatibility_date;
}
