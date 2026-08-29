import { readFile, writeFile } from "node:fs/promises";

import { PLACEHOLDER_D1_DATABASE_ID, WEB_WORKER_CONFIG_PATH } from "../config.ts";

const configPath = process.env.SEC_WEB_WRANGLER_CONFIG ?? WEB_WORKER_CONFIG_PATH;
const databaseId = required("SEC_WEB_D1_DATABASE_ID");
const config = JSON.parse(await readFile(configPath, "utf8")) as {
  name?: string;
  d1_databases?: Array<{ binding: string; database_id: string; database_name?: string; migrations_dir?: string }>;
  vars?: Record<string, string>;
};

if (!Array.isArray(config.d1_databases) || !config.d1_databases.some((binding) => binding.binding === "DB")) {
  throw new Error("Generated Vinext config does not contain the DB D1 binding");
}

config.name = process.env.SEC_WEB_WORKER_NAME?.trim() || "earning-report-analysis-sec-web";
config.d1_databases = config.d1_databases.map((binding) => binding.binding === "DB"
  ? {
      ...binding,
      database_id: databaseId,
      database_name: process.env.SEC_WEB_D1_DATABASE_NAME?.trim() || "earning-report-analysis-sec-web",
      migrations_dir: "../migrations",
    }
  : binding);
config.vars = {
  ...config.vars,
  ...(process.env.SEC_PIPELINE_ORIGIN ? { SEC_PIPELINE_ORIGIN: process.env.SEC_PIPELINE_ORIGIN.trim() } : {}),
  ...(process.env.SEC_TRACKED_TICKERS ? { SEC_TRACKED_TICKERS: process.env.SEC_TRACKED_TICKERS.trim() } : {}),
};

await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  configPath,
  worker: config.name,
  d1Binding: "DB",
  databaseIdConfigured: true,
  databaseName: config.d1_databases.find((binding) => binding.binding === "DB")?.database_name,
  migrationsDirectory: "dist/migrations",
}));

function required(name: string): string {
  const value = process.env[name]?.trim() ?? "";
  if (!value || value === PLACEHOLDER_D1_DATABASE_ID || !/^[0-9a-f-]{20,}$/i.test(value)) {
    throw new Error(`${name} must be the real Cloudflare D1 database id`);
  }
  return value;
}
