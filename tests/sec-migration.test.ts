import assert from "node:assert/strict";
import test from "node:test";

import { isSecMigrationTable, readMigrationPage } from "../lib/sec-migration.ts";

test("exports a bounded page with deterministic row hashes", async () => {
  const database = {
    prepare() {
      return { bind() { return { async all<T>() { return { results: [{ cache_key: "sec:MSFT", payload: "{}" }] as T[] }; } }; } };
    },
  };
  const page = await readMigrationPage(database, "sec_cache", 0, 1);
  assert.equal(page.rows.length, 1);
  assert.match(page.rows[0]._sha256, /^[a-f0-9]{64}$/);
  assert.equal(page.nextCursor, null);
});

test("rejects dynamic table names outside the export whitelist at the route boundary", () => {
  assert.equal(isSecMigrationTable("holding_plans"), false);
  assert.equal(isSecMigrationTable("sec_filings"), true);
});
