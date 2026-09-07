import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

/**
 * The Web Worker is a read service for analysis data: it serves the public site and the public
 * `/api/v1/*` JSON API straight off D1, and it forwards a handful of admin/control-plane requests
 * down to the Pipeline Worker, which does the writing. Nothing under `app/` should call a
 * repository write method directly — that would put a second writer on tables Pipeline already
 * owns, the same "two copies" failure mode the whitelist migration (see core.ts) was written to
 * avoid, just on data instead of config. This walks the App Router tree and fails if it finds one.
 */
const WRITE_METHODS = [
  "saveFilingBlocks",
  "saveAnalysis",
  "commitFinalPublication",
  "setSummary",
  "upsertAnalysisJob",
  "claimMemoryJob",
  "commitMemoryJob",
  "setCache",
  "upsertFilingIndex",
  "saveHistory",
  "upsertRun",
];

test("app/ never calls a SEC or company-analysis repository write method", async () => {
  const appDirectory = fileURLToPath(new URL("../app", import.meta.url));
  const entries = await readdir(appDirectory, { recursive: true, withFileTypes: true });
  const sourceFiles = entries
    .filter((entry) => entry.isFile() && [".ts", ".tsx"].includes(extname(entry.name)))
    .map((entry) => join(entry.parentPath, entry.name));

  const offenders: string[] = [];
  for (const file of sourceFiles) {
    const source = await readFile(file, "utf8");
    for (const method of WRITE_METHODS) {
      if (new RegExp(`\\.${method}\\(`).test(source)) offenders.push(`${file}: ${method}`);
    }
  }
  assert.deepEqual(offenders, []);
});
