import { readFile } from "node:fs/promises";

import { PLACEHOLDER_D1_DATABASE_ID, WEB_WORKER_CONFIG_PATH } from "../build/web-worker-config.ts";

const configPath = process.env.SEC_WEB_WRANGLER_CONFIG ?? WEB_WORKER_CONFIG_PATH;
const pipelineConfigPath = "workers/sec-cron/wrangler.jsonc";

const config = JSON.parse(await readFile(configPath, "utf8")) as {
  name?: string;
  compatibility_date?: string;
  compatibility_flags?: string[];
  d1_databases?: Array<{ binding: string; database_id: string; database_name?: string }>;
};

const database = config.d1_databases?.find((binding) => binding.binding === "DB");
const pipelineDate = pipelineCompatibilityDate(await readFile(pipelineConfigPath, "utf8"));
const problems: string[] = [];

if (!database) {
  problems.push("has no DB D1 binding");
} else if (database.database_id === PLACEHOLDER_D1_DATABASE_ID) {
  problems.push("still carries the placeholder D1 id — run `npm run web:prepare` with the real SEC_WEB_D1_DATABASE_ID");
} else if (!/^[0-9a-f-]{20,}$/i.test(database.database_id)) {
  problems.push(`has a malformed D1 id: ${database.database_id}`);
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
  databaseName: database?.database_name,
}));

function pipelineCompatibilityDate(source: string): string {
  // Wrangler's JSONC allows whole-line comments; value strings such as URLs keep their slashes.
  const parsed = JSON.parse(source.replace(/^\s*\/\/.*$/gm, "")) as { compatibility_date?: string };
  if (!parsed.compatibility_date) throw new Error(`${pipelineConfigPath} has no compatibility_date`);
  return parsed.compatibility_date;
}
