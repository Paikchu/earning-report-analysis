import assert from "node:assert/strict";
import test from "node:test";
import { checkArchitecture, checkSourceBoundary } from "../scripts/check-architecture.ts";

test("all production source files obey service ownership", async () => { assert.deepEqual(await checkArchitecture(), []); });
test("guards reject transitive escape routes, type imports and implementation in contracts", () => {
  for (const source of ['import x from "@/lib/web/site-data";', 'export * from "../../../app/page";', 'const x = import("@/lib/web/analysis-client");', 'type X = import("@/lib/web/analysis-client").AnalysisTransport;']) {
    assert.ok(checkSourceBoundary("workers/pipeline/src/example.ts", source).length);
  }
  assert.ok(checkSourceBoundary("app/page.tsx", 'import type { X } from "@/workers/pipeline/src/core";').length);
  assert.ok(checkSourceBoundary("shared/analysis-contract/test.ts", 'export function retry() {}').length);
  assert.ok(checkSourceBoundary("shared/analysis-contract/test.ts", 'export type Row = D1Database;').length);
  assert.deepEqual(checkSourceBoundary("shared/analysis-contract/test.ts", 'export type ResponseDto = { ticker: string };'), []);
});
