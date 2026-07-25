import type { SecFilingSummary } from "./sec.ts";
import type { SecCacheRecord, SecRepository } from "./sec-service.ts";

type D1ResultStatement = {
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
};

type D1Like = {
  prepare(sql: string): {
    bind(...values: unknown[]): D1ResultStatement;
  };
};

export class D1SecRepository implements SecRepository {
  private readonly database: D1Like;

  constructor(database: D1Like) {
    this.database = database;
  }

  async getCache<T>(key: string): Promise<SecCacheRecord<T> | null> {
    const row = await this.database.prepare(`
      SELECT payload, fetched_at AS fetchedAt
      FROM sec_cache
      WHERE cache_key = ?
    `).bind(key).first<{ payload: string; fetchedAt: string }>();
    if (!row) return null;
    try {
      return { payload: JSON.parse(row.payload) as T, fetchedAt: row.fetchedAt };
    } catch {
      return null;
    }
  }

  async setCache<T>(key: string, payload: T, fetchedAt: string): Promise<void> {
    await this.database.prepare(`
      INSERT INTO sec_cache (cache_key, payload, fetched_at)
      VALUES (?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET
        payload = excluded.payload,
        fetched_at = excluded.fetched_at
    `).bind(key, JSON.stringify(payload), fetchedAt).run();
  }

  async getSummary(ticker: string, accessionNumber: string): Promise<SecFilingSummary | null> {
    const row = await this.database.prepare(`
      SELECT payload
      FROM sec_filing_summaries
      WHERE ticker = ? AND accession_number = ?
    `).bind(ticker, accessionNumber).first<{ payload: string }>();
    if (!row) return null;
    try {
      return JSON.parse(row.payload) as SecFilingSummary;
    } catch {
      return null;
    }
  }

  async setSummary(summary: SecFilingSummary): Promise<void> {
    await this.database.prepare(`
      INSERT INTO sec_filing_summaries (ticker, accession_number, generated_at, payload)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(ticker, accession_number) DO UPDATE SET
        generated_at = excluded.generated_at,
        payload = excluded.payload
    `).bind(summary.ticker, summary.accessionNumber, summary.generatedAt, JSON.stringify(summary)).run();
  }
}

export async function listHoldingPlanTickers(database: D1Like): Promise<string[]> {
  const result = await database.prepare(`
    SELECT DISTINCT ticker FROM holding_plans ORDER BY ticker
  `).bind().all<{ ticker: string }>();
  return result.results.map((row) => row.ticker);
}
