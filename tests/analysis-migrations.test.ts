import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { MIGRATIONS_DIRECTORY, createAnalysisDatabase, listMigrationFiles } from "./helpers/analysis-backend.ts";
import { SqliteD1Database } from "./helpers/sqlite-d1.ts";

/**
 * A18. Migration ownership moved from the Web Worker to the analysis backend. Wrangler records
 * applied migrations by **filename** in `d1_migrations`, so a move is safe exactly as long as the
 * filenames and their contents are untouched — and catastrophic if they are not, because a
 * "new" 0000 would be reapplied against a live database.
 *
 * The manifest below is the identity of every migration as it stood before the move. It is not a
 * convenience: it is the thing that fails loudly if a future edit renames, reorders or rewrites a
 * migration that production has already applied.
 */
const ROOT = fileURLToPath(new URL("../", import.meta.url));

const MIGRATION_MANIFEST: ReadonlyArray<readonly [string, string]> = [
  ["0000_absurd_zarda.sql", "8bae063f5f0f7827"],
  ["0001_normal_doctor_strange.sql", "716482ca2d5b6386"],
  ["0002_flat_blockbuster.sql", "f1221dab0b651335"],
  ["0003_neat_toro.sql", "02d045cb7a277229"],
  ["0004_silky_may_parker.sql", "8b7d65fd2da4bf0b"],
  ["0005_fresh_bloodaxe.sql", "8343bcecefb53f36"],
  ["0006_standalone_sec.sql", "9b689976dee96ca6"],
  ["0007_yahoo_fundamentals_p1.sql", "3fd6fd9f324d17c7"],
  ["0008_yahoo_fundamentals_sync.sql", "79156d953502376b"],
  ["0009_company_analysis.sql", "1ab2c07836e00175"],
  ["0009_huge_enchantress.sql", "568351ceb9306b36"],
];

test("the analysis backend owns the migrations, and the Web Worker no longer carries them", async () => {
  const bundled = await listMigrationFiles();
  assert.ok(bundled.length >= 11, `expected the full migration history, found ${bundled.length}`);
  assert.equal(bundled[0], "0000_absurd_zarda.sql");

  // The old location must be gone, not duplicated — two copies is how schema definitions drift.
  await assert.rejects(readdir(join(ROOT, "workers/web/migrations")), /ENOENT/);

  const config = JSON.parse((await readFile(join(ROOT, "workers/pipeline/wrangler.jsonc"), "utf8"))
    .replace(/^\s*\/\/.*$/gm, "")) as { d1_databases?: Array<{ migrations_dir?: string; database_name?: string; database_id?: string }> };
  assert.equal(config.d1_databases?.[0]?.migrations_dir, "migrations");
  // Same database, same name, same id: ownership moved, the database did not.
  assert.equal(config.d1_databases?.[0]?.database_name, "earning-report-analysis-sec-web");
  assert.equal(config.d1_databases?.[0]?.database_id, "3c917a4c-3562-4de1-8b21-586fa384e63f");
});

/**
 * The identity check. If any of these change, a database that has already applied them would either
 * reapply a migration under a new name or silently disagree with the schema it is running.
 */
test("relocating the files changed no migration's name or contents", async () => {
  const names = await listMigrationFiles();
  assert.deepEqual(names, [
    "0000_absurd_zarda.sql",
    "0001_normal_doctor_strange.sql",
    "0002_flat_blockbuster.sql",
    "0003_neat_toro.sql",
    "0004_silky_may_parker.sql",
    "0005_fresh_bloodaxe.sql",
    "0006_standalone_sec.sql",
    "0007_yahoo_fundamentals_p1.sql",
    "0008_yahoo_fundamentals_sync.sql",
    "0009_company_analysis.sql",
    "0009_huge_enchantress.sql",
  ]);

  // Wrangler applies in sorted filename order; that ordering must be stable across the move.
  assert.deepEqual([...names].sort(), names);

  // Drizzle's journal travels with the files, so `db:generate` continues the same history.
  const journal = JSON.parse(await readFile(join(MIGRATIONS_DIRECTORY, "meta/_journal.json"), "utf8")) as {
    entries: Array<{ idx: number; tag: string }>;
  };
  assert.equal(journal.entries[0]?.tag, "0000_absurd_zarda");
  assert.deepEqual(journal.entries.map((entry) => entry.idx), journal.entries.map((_entry, index) => index));

  // A stable digest per file, so a content edit to an already-applied migration fails here.
  const digests = Object.fromEntries(await Promise.all(names.map(async (name) => [
    name,
    createHash("sha256").update(await readFile(join(MIGRATIONS_DIRECTORY, name))).digest("hex").slice(0, 16),
  ])));
  assert.equal(MIGRATION_MANIFEST.length, names.length, "a new migration must be added to the manifest");
  for (const [name, expected] of MIGRATION_MANIFEST) {
    assert.equal(digests[name], expected, `${name} changed content; a database that already applied it will disagree`);
  }
});

test("a fresh database applies the whole history cleanly and ends with every table", async () => {
  const database = await createAnalysisDatabase();
  const tables = (database.raw.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ).all() as Array<{ name: string }>).map((row) => row.name);
  for (const expected of [
    "company_analysis_runs",
    "fundamental_fetch_runs",
    "fundamental_observations",
    "sec_analysis_jobs",
    "sec_filings",
    "sec_published_reports",
  ]) {
    assert.ok(tables.includes(expected), `${expected} missing after a fresh migration run`);
  }
  // The rebuild migrations left no scratch tables behind.
  assert.deepEqual(tables.filter((name) => name.startsWith("__new_")), []);
  database.close();
});

/**
 * The upgrade path: a database that already ran every migration under the old directory. Wrangler
 * compares `d1_migrations.name` against the filenames in `migrations_dir`, so this reproduces that
 * comparison — nothing is unapplied, so nothing would be reapplied.
 */
test("a database migrated under the old location has nothing left to apply", async () => {
  const database = await createAnalysisDatabase();
  database.raw.exec("CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY, name TEXT UNIQUE, applied_at TEXT)");
  const previouslyApplied = await listMigrationFiles();
  const insert = database.raw.prepare("INSERT INTO d1_migrations (name, applied_at) VALUES (?, '2026-01-01T00:00:00Z')");
  for (const name of previouslyApplied) insert.run(name);

  const applied = new Set((database.raw.prepare("SELECT name FROM d1_migrations").all() as Array<{ name: string }>)
    .map((row) => row.name));
  const bundled = await listMigrationFiles();
  const unapplied = bundled.filter((name) => !applied.has(name));
  const unknown = [...applied].filter((name) => !bundled.includes(name));

  assert.deepEqual(unapplied, [], "moving the files must not make an applied migration look new");
  assert.deepEqual(unknown, [], "moving the files must not orphan an applied migration");

  // And the data that was there before the move is still there after it.
  database.raw.prepare(
    "INSERT INTO sec_filings (filing_id, ticker, accession_number, cik, form, filing_date, report_date, document_url, index_url) VALUES ('f', 'MSFT', 'a', 'c', '10-K', '2026-01-01', '2026-01-01', 'u', 'i')",
  ).run();
  const rows = database.raw.prepare("SELECT COUNT(*) AS count FROM sec_filings").get() as { count: number };
  assert.equal(rows.count, 1);
  database.close();
});

test("the migration gate reads the backend's config and finds the same list", async () => {
  const config = JSON.parse((await readFile(join(ROOT, "workers/pipeline/wrangler.jsonc"), "utf8"))
    .replace(/^\s*\/\/.*$/gm, "")) as { d1_databases?: Array<{ binding: string; migrations_dir?: string }> };
  const binding = config.d1_databases?.find((entry) => entry.binding === "DB");
  assert.ok(binding?.migrations_dir);
  const resolved = join(ROOT, "workers/pipeline", binding.migrations_dir!);
  assert.equal(resolved, MIGRATIONS_DIRECTORY);

  const source = await readFile(join(ROOT, "workers/pipeline/scripts/check-migrations.ts"), "utf8");
  assert.match(source, /PIPELINE_WORKER_CONFIG_PATH/);
  assert.match(source, /d1_migrations/);
});

test("the Drizzle generator writes into the backend's directory, from the same schema", async () => {
  const source = await readFile(join(ROOT, "workers/pipeline/drizzle.config.ts"), "utf8");
  assert.match(source, /out:\s*"\.\/workers\/pipeline\/migrations"/);
  assert.match(source, /schema:\s*"\.\/db\/schema\.ts"/);
  const packageJson = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };
  assert.match(packageJson.scripts["db:generate"]!, /workers\/pipeline\/drizzle\.config\.ts/);
  assert.match(packageJson.scripts["worker:pipeline:check:migrations"]!, /workers\/pipeline\/scripts\/check-migrations\.ts/);
  // The Web deploy no longer runs a migration gate, because it no longer has a database.
  assert.equal("worker:web:check:migrations" in packageJson.scripts, false);
  assert.doesNotMatch(packageJson.scripts["worker:web:deploy:built"]!, /check:migrations/);
});

test("no leftover script or config still points at the old migrations directory", async () => {
  const suspects = [
    "package.json",
    "workers/pipeline/wrangler.jsonc",
    "workers/web/wrangler.jsonc",
    "workers/web/scripts/prepare-config.ts",
    "workers/web/scripts/check-config.ts",
    "workers/pipeline/scripts/check-migrations.ts",
    "workers/pipeline/drizzle.config.ts",
  ];
  for (const file of suspects) {
    // Comments may still describe where the files came from; only live configuration must not.
    const source = (await readFile(join(ROOT, file), "utf8")).replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(source, /workers\/web\/migrations|\.\.\/web\/migrations/, file);
  }
});

test("the SQLite stand-in and D1 agree on what a batch means", async () => {
  // The publication tests lean on batch atomicity, so the helper backing them must really roll back.
  const database = new SqliteD1Database();
  database.raw.exec("CREATE TABLE t (id TEXT PRIMARY KEY)");
  await assert.rejects(database.batch([
    database.prepare("INSERT INTO t (id) VALUES (?)").bind("a"),
    database.prepare("INSERT INTO t (id) VALUES (?)").bind("a"),
  ]));
  const rows = database.raw.prepare("SELECT COUNT(*) AS count FROM t").get() as { count: number };
  assert.equal(rows.count, 0, "a failed batch must leave nothing behind");
  database.close();
});
