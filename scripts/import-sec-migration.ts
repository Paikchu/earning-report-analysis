import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { SEC_MIGRATION_TABLES } from "../lib/sec-migration.ts";

const origin = required("SEC_IMPORT_ORIGIN").replace(/\/+$/, "");
const key = required("SEC_MIGRATION_KEY");
const inputDir = process.env.SEC_EXPORT_DIR ?? "./migration/sec";
let imported = 0;

for (const table of SEC_MIGRATION_TABLES) {
  const rows = (await readFile(join(inputDir, `${table}.ndjson`), "utf8"))
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  for (let offset = 0; offset < rows.length; offset += 25) {
    const response = await fetch(`${origin}/api/internal/sec/migration/export`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-sec-migration-key": key },
      body: JSON.stringify({ table, rows: rows.slice(offset, offset + 25) }),
    });
    if (!response.ok) throw new Error(`${table} import failed: HTTP ${response.status} ${await response.text()}`);
    imported += Math.min(25, rows.length - offset);
  }
}

console.log(JSON.stringify({ tables: SEC_MIGRATION_TABLES.length, rows: imported }));

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
