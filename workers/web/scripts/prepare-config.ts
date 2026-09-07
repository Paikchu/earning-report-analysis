import { readFile, writeFile } from "node:fs/promises";
import { WEB_WORKER_CONFIG_PATH } from "../config.ts";
const configPath = process.env.SEC_WEB_WRANGLER_CONFIG ?? WEB_WORKER_CONFIG_PATH;
const config = JSON.parse(await readFile(configPath, "utf8"));
config.name = process.env.SEC_WEB_WORKER_NAME?.trim() || "earning-report-analysis-sec-web";
config.services = [{ binding: "ANALYSIS_SERVICE", service: process.env.SEC_PIPELINE_WORKER_NAME?.trim() || "earning-report-analysis-sec-pipeline" }];
delete config.d1_databases;
if (config.vars) { delete config.vars.SEC_TRACKED_TICKERS; delete config.vars.SEC_PIPELINE_ORIGIN; }
await writeFile(configPath, JSON.stringify(config, null, 2) + "\n");
console.log(`Prepared ${config.name}: one analysis service binding, no analysis database.`);
