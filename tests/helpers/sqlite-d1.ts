import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFile } from "node:fs/promises";

import type {
  FundamentalsD1Database,
  FundamentalsD1Statement,
} from "../../lib/fundamentals-d1.ts";

class SqliteD1Statement implements FundamentalsD1Statement {
  private readonly database: DatabaseSync;
  private readonly sql: string;
  private readonly values: unknown[];

  constructor(
    database: DatabaseSync,
    sql: string,
    values: unknown[],
  ) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }

  async first<T>(): Promise<T | null> {
    return (this.database.prepare(this.sql).get(...this.values as SQLInputValue[]) as T | undefined) ?? null;
  }

  async all<T>(): Promise<{ results: T[] }> {
    return { results: this.database.prepare(this.sql).all(...this.values as SQLInputValue[]) as T[] };
  }

  async run(): Promise<unknown> {
    return this.database.prepare(this.sql).run(...this.values as SQLInputValue[]);
  }
}

export class SqliteD1Database implements FundamentalsD1Database {
  readonly raw = new DatabaseSync(":memory:");

  prepare(sql: string): { bind(...values: unknown[]): FundamentalsD1Statement } {
    return {
      bind: (...values) => new SqliteD1Statement(this.raw, sql, values),
    };
  }

  async batch(statements: FundamentalsD1Statement[]): Promise<unknown[]> {
    this.raw.exec("BEGIN IMMEDIATE");
    try {
      const results: unknown[] = [];
      for (const statement of statements) results.push(await statement.run());
      this.raw.exec("COMMIT");
      return results;
    } catch (error) {
      this.raw.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    this.raw.close();
  }
}

export async function applyFundamentalsMigrations(database: SqliteD1Database): Promise<void> {
  database.raw.exec("PRAGMA foreign_keys = ON");
  for (const migration of [
    "../../workers/web/migrations/0007_yahoo_fundamentals_p1.sql",
    "../../workers/web/migrations/0008_yahoo_fundamentals_sync.sql",
  ]) {
    await applySqlMigration(database, migration);
  }
  database.raw.exec("PRAGMA foreign_keys = ON");
}

export async function applySqlMigration(database: SqliteD1Database, relativePath: string): Promise<void> {
  const sql = await readFile(new URL(relativePath, import.meta.url), "utf8");
  database.raw.exec(sql.replaceAll("--> statement-breakpoint", ""));
}
