import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

import { SEC_MIGRATION_TABLES } from "../lib/sec-migration.ts";

const origin = required("SEC_EXPORT_ORIGIN").replace(/\/+$/, "");
const key = required("SEC_MIGRATION_KEY");
const outputDir = process.env.SEC_EXPORT_DIR ?? "./migration/sec";
const pageSize = Math.min(100, Math.max(1, Number(process.env.SEC_EXPORT_LIMIT ?? 100)));

await mkdir(outputDir, { recursive: true });
const manifest: Array<{ table: string; file: string; rowCount: number; sha256: string; primaryKey: string[] }> = [];

for (const table of SEC_MIGRATION_TABLES) {
  let cursor = 0;
  const rows: string[] = [];
  while (true) {
    const url = new URL(`${origin}/api/internal/sec/migration/export`);
    url.searchParams.set("table", table);
    url.searchParams.set("cursor", String(cursor));
    url.searchParams.set("limit", String(pageSize));
    const response = await fetch(url, { headers: { "x-sec-migration-key": key } });
    if (!response.ok) throw new Error(`${table} export failed: HTTP ${response.status} ${await response.text()}`);
    const page = await response.json() as { rows: Array<Record<string, unknown> & { _sha256: string }>; nextCursor: number | null };
    rows.push(...page.rows.map((row) => JSON.stringify(Object.fromEntries(Object.entries(row).filter(([name]) => name !== "_sha256")))));
    if (page.nextCursor === null) break;
    cursor = page.nextCursor;
  }
  const file = `${table}.ndjson`;
  const path = join(outputDir, file);
  await writeFile(path, rows.length ? `${rows.join("\n")}\n` : "", "utf8");
  manifest.push({ table, file, rowCount: rows.length, sha256: await fileSha256(path), primaryKey: primaryKeyFor(table) });
}

await writeFile(join(outputDir, "manifest.json"), JSON.stringify({ generatedAt: new Date().toISOString(), tables: manifest }, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ outputDir, tables: manifest.length, rows: manifest.reduce((total, item) => total + item.rowCount, 0) }));

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function fileSha256(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

function primaryKeyFor(table: string): string[] {
  const keys: Record<string, string[]> = {
    sec_cache: ["cache_key"],
    sec_filing_summaries: ["ticker", "accession_number"],
    sec_filings: ["filing_id"],
    sec_periods: ["period_id"],
    sec_filing_periods: ["filing_id", "period_id", "role"],
    sec_filing_blocks: ["block_id"],
    sec_evidence: ["evidence_id"],
    sec_facts: ["fact_id"],
    sec_module_snapshots: ["snapshot_id"],
    sec_memory_items: ["memory_id"],
    sec_memory_events: ["event_id"],
    sec_memory_jobs: ["job_id"],
    sec_memory_extractions: ["extraction_id"],
    sec_company_memory_threads: ["ticker"],
    sec_comparisons: ["comparison_id"],
    sec_analysis_runs: ["run_id"],
    sec_analysis_jobs: ["job_id"],
    sec_published_reports: ["ticker", "period_id", "report_version"],
  };
  return keys[table] ?? [];
}
