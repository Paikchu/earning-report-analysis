import { readFile } from "node:fs/promises";

import { validateMacroDashboard } from "../lib/macro-dashboard.ts";
import type { PortfolioSnapshotV1 } from "../lib/portfolio-snapshot.ts";

const dashboardPath = process.argv[2] ?? "data/macro-dashboard.json";
const snapshotPath = process.argv[3] ?? "data/portfolio-snapshot.json";
const [dashboard, snapshot] = await Promise.all([
  readFile(dashboardPath, "utf8").then(JSON.parse),
  readFile(snapshotPath, "utf8").then(JSON.parse) as Promise<PortfolioSnapshotV1>,
]);
const errors = validateMacroDashboard(dashboard, snapshot);

if (errors.length) {
  for (const error of errors) console.error(error);
  process.exitCode = 1;
} else {
  console.log(`Macro dashboard is valid: ${dashboard.reviewDate}`);
}
