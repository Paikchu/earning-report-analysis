import { readFile } from "node:fs/promises";
import { WEB_WORKER_CONFIG_PATH } from "../config.ts";
const configPath = process.env.SEC_WEB_WRANGLER_CONFIG ?? WEB_WORKER_CONFIG_PATH;
const config = JSON.parse(await readFile(configPath, "utf8"));
if (config.d1_databases?.length) throw new Error("Web must not bind the analysis database");
if (config.services?.length !== 1 || config.services[0].binding !== "ANALYSIS_SERVICE" || !config.services[0].service) throw new Error("Web requires one ANALYSIS_SERVICE binding");
if (!config.compatibility_flags?.includes("nodejs_compat")) throw new Error("Missing nodejs_compat");
console.log(`Validated ${config.name}`);
