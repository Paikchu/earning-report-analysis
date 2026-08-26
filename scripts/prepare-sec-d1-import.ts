import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { SEC_MIGRATION_TABLES } from "../lib/sec-migration.ts";

const inputDir = process.env.SEC_EXPORT_DIR ?? "./migration/sec";
const outputDir = process.env.SEC_D1_IMPORT_DIR ?? join(inputDir, "d1-import");
const files: Array<{ table: string; file: string; rows: number }> = [];

await mkdir(outputDir, { recursive: true });
for (const table of SEC_MIGRATION_TABLES) {
  const sourcePath = join(inputDir, `${table}.ndjson`);
  const rows = (await readFile(sourcePath, "utf8")).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
  if (!rows.length) continue;
  const columns = Object.keys(rows[0]);
  for (let offset = 0; offset < rows.length; offset += 25) {
    const chunk = rows.slice(offset, offset + 25);
    const sql = [
      "BEGIN;",
      ...chunk.map((row) => `INSERT OR REPLACE INTO ${quoteIdentifier(table)} (${columns.map(quoteIdentifier).join(", ")}) VALUES (${columns.map((column) => sqlValue(row[column])).join(", " )});`),
      "COMMIT;",
      "",
    ].join("\n");
    const file = `${table}-${String(offset / 25).padStart(5, "0")}.sql`;
    await writeFile(join(outputDir, file), sql, "utf8");
    files.push({ table, file, rows: chunk.length });
  }
}

await writeFile(join(outputDir, "manifest.json"), `${JSON.stringify({ generatedAt: new Date().toISOString(), files }, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ outputDir, files: files.length, rows: files.reduce((total, file) => total + file.rows, 0) }));

function quoteIdentifier(value: string): string {
  if (!/^[a-z][a-z0-9_]*$/i.test(value)) throw new Error(`Unsafe SQLite identifier: ${value}`);
  return `"${value}"`;
}

function sqlValue(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "1" : "0";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return `'${text.replaceAll("'", "''")}'`;
}
