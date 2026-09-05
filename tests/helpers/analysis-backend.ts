import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { SqliteD1Database } from "./sqlite-d1.ts";
import type { AnalysisReadEnv } from "../../workers/pipeline/read-api/router.ts";

/**
 * A real SQLite database with the project's real migrations applied, standing in for D1.
 *
 * Mocking the repositories would only prove the mocks agree with themselves; these tests run the
 * actual SQL the Worker ships against the actual schema the Worker deploys, which is the only way
 * a query bug or a schema drift shows up in a test rather than in production.
 */
export const MIGRATIONS_DIRECTORY = fileURLToPath(new URL("../../workers/pipeline/migrations", import.meta.url));

export async function listMigrationFiles(): Promise<string[]> {
  return (await readdir(MIGRATIONS_DIRECTORY)).filter((entry) => entry.endsWith(".sql")).sort();
}

export async function createAnalysisDatabase(): Promise<SqliteD1Database> {
  const database = new SqliteD1Database();
  database.raw.exec("PRAGMA foreign_keys = ON");
  for (const name of await listMigrationFiles()) {
    const sql = await readFile(join(MIGRATIONS_DIRECTORY, name), "utf8");
    database.raw.exec(sql.replaceAll("--> statement-breakpoint", ""));
  }
  database.raw.exec("PRAGMA foreign_keys = ON");
  return database;
}

/**
 * Wraps a database so any statement that is not a plain read throws.
 *
 * This is the mechanism behind the "a read writes nothing" tests: rather than asserting that a
 * particular helper was not called — which only ever tests the assertion's own imagination — it
 * makes a write physically impossible and lets the read path prove it by succeeding.
 */
export class ReadOnlyGuardDatabase {
  readonly attemptedWrites: string[] = [];
  private readonly inner: SqliteD1Database;

  constructor(inner: SqliteD1Database) {
    this.inner = inner;
  }

  prepare(sql: string) {
    if (!isReadOnlySql(sql)) {
      this.attemptedWrites.push(sql.trim().slice(0, 80));
      throw new Error(`Read path attempted a write: ${sql.trim().slice(0, 120)}`);
    }
    return this.inner.prepare(sql);
  }

  async batch(_statements: Parameters<SqliteD1Database["batch"]>[0]): Promise<unknown[]> {
    this.attemptedWrites.push("BATCH");
    throw new Error("Read path attempted a batch write");
  }
}

function isReadOnlySql(sql: string): boolean {
  const normalized = sql.trim().replace(/^\(+/, "").toUpperCase();
  return normalized.startsWith("SELECT") || normalized.startsWith("WITH") || normalized.startsWith("PRAGMA");
}

export const TEST_READ_SECRET = "test-read-secret-0123456789abcdef";
export const TEST_READ_KEY_ID = "test-consumer";
export const TEST_READ_TOKEN = `${TEST_READ_KEY_ID}.${TEST_READ_SECRET}`;
export const TEST_READ_KEYS = `${TEST_READ_KEY_ID}:${TEST_READ_SECRET}:*`;

/** A credential that can read filings and nothing else, for the insufficient-scope cases. */
export const FILINGS_ONLY_SECRET = "filings-only-secret-0123456789ab";
export const FILINGS_ONLY_TOKEN = `filings-only.${FILINGS_ONLY_SECRET}`;
export const FILINGS_ONLY_KEYS = `filings-only:${FILINGS_ONLY_SECRET}:filings:read`;

export function readEnv(database: unknown, overrides: Partial<AnalysisReadEnv> = {}): AnalysisReadEnv {
  return {
    DB: database as D1Database,
    ANALYSIS_READ_KEYS: `${TEST_READ_KEYS},${FILINGS_ONLY_KEYS}`,
    ...overrides,
  };
}

export function readRequest(path: string, init: RequestInit & { token?: string | null } = {}): Request {
  const { token = TEST_READ_TOKEN, headers, ...rest } = init;
  return new Request(`https://analysis.test${path}`, {
    ...rest,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(headers as Record<string, string> | undefined),
    },
  });
}
