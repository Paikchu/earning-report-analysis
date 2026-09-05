import assert from "node:assert/strict";
import test from "node:test";

import { AnalysisBackendClient, analysisErrorCodeOf, isAnalysisErrorBody } from "../lib/analysis-contract/client.ts";
import { AnalysisRequestError } from "../lib/analysis-contract/errors.ts";
import { handleAnalysisReadRequest } from "../workers/pipeline/read-api/router.ts";
import { TEST_READ_TOKEN, createAnalysisDatabase, readEnv } from "./helpers/analysis-backend.ts";
import { FIXTURE_TICKER, VERIFIED_ACCESSION, seedAnalysisFixtures, seedCompanyAnalysisPublication, seedFundamentals } from "./helpers/analysis-fixtures.ts";

/**
 * The client is exercised against the real router, without the Web Worker: `fetcher` stands in for
 * the Service Binding exactly the way the binding does at runtime — it hands a `Request` to the
 * other Worker's handler and gets its `Response` back.
 */
/** Stands in for a Service Binding: hand a Request to the other Worker, take its Response back. */
function routerFetcher(env: ReturnType<typeof readEnv>): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) =>
    handleAnalysisReadRequest(new Request(input as RequestInfo, init) as unknown as Request, env)) as unknown as typeof fetch;
}

async function boundBackend() {
  const database = await createAnalysisDatabase();
  await seedAnalysisFixtures(database);
  seedCompanyAnalysisPublication(database);
  seedFundamentals(database, { fetchedAt: "2026-08-28T00:00:00.000Z" });
  const seen: Request[] = [];
  const env = readEnv(database);
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input as RequestInfo, init);
    seen.push(request.clone() as unknown as Request);
    return handleAnalysisReadRequest(request as unknown as Request, env);
  }) as unknown as typeof fetch;
  return { database, seen, client: new AnalysisBackendClient({ origin: "https://binding.invalid", token: TEST_READ_TOKEN, fetcher }) };
}

test("the client reaches every resource and presents its credential on each one", async () => {
  const { client, seen, database } = await boundBackend();
  assert.equal((await client.listFilings(FIXTURE_TICKER, { limit: "2" })).status, 200);
  assert.equal((await client.getFiling(FIXTURE_TICKER, VERIFIED_ACCESSION)).status, 200);
  assert.equal((await client.getCompanyAnalysis(FIXTURE_TICKER)).status, 200);
  assert.equal((await client.getFundamentals(FIXTURE_TICKER, { periodCount: "2" })).status, 200);

  assert.equal(seen.length, 4);
  for (const request of seen) {
    assert.equal(request.method, "GET");
    assert.equal(request.headers.get("authorization"), `Bearer ${TEST_READ_TOKEN}`);
  }
  // Query parameters are built by the client, not pasted in by the caller.
  assert.match(seen[0]!.url, /\/api\/v1\/companies\/MSFT\/filings\?limit=2$/);
  assert.match(seen[3]!.url, /\/fundamentals\?periodCount=2$/);
  database.close();
});

test("path segments are encoded, so a ticker cannot escape its own route", async () => {
  const { client, seen, database } = await boundBackend();
  await client.getFiling("MSFT/../../admin", "0000/1");
  assert.doesNotMatch(seen[0]!.url, /\/admin/);
  assert.match(seen[0]!.url, /companies\/MSFT%2F\.\.%2F\.\.%2Fadmin\/filings\/0000%2F1/);
  database.close();
});

test("a non-2xx comes back as data — proxies must be able to reproduce it", async () => {
  const { client, database } = await boundBackend();
  const missing = await client.getFiling(FIXTURE_TICKER, "0000000009-26-999999");
  assert.equal(missing.status, 404);
  assert.equal(analysisErrorCodeOf(missing.body), "FILING_NOT_FOUND");
  assert.equal(isAnalysisErrorBody(missing.body), true);

  const invalid = await client.listFilings("not-a-ticker");
  assert.equal(invalid.status, 400);
  assert.equal(analysisErrorCodeOf(invalid.body), "INVALID_TICKER");
  database.close();
});

test("a wrong credential is rejected by the backend, not waved through by the client", async () => {
  const database = await createAnalysisDatabase();
  const env = readEnv(database);
  const client = new AnalysisBackendClient({
    origin: "https://binding.invalid",
    token: "test-consumer.wrong-secret-0123456789abcdef",
    fetcher: routerFetcher(env),
  });
  const response = await client.listFilings(FIXTURE_TICKER);
  assert.equal(response.status, 401);
  database.close();
});

/** A transport failure must not surface an internal hostname or a raw error to the caller. */
test("transport failures become BACKEND_UNAVAILABLE with nothing internal attached", async () => {
  const failing = new AnalysisBackendClient({
    origin: "https://internal-backend-9.invalid",
    token: TEST_READ_TOKEN,
    fetcher: (async () => { throw new Error("connect ECONNREFUSED 10.1.2.3:8787"); }) as unknown as typeof fetch,
  });
  await assert.rejects(failing.listFilings(FIXTURE_TICKER), (error: unknown) => {
    assert.ok(error instanceof AnalysisRequestError);
    assert.equal(error.code, "BACKEND_UNAVAILABLE");
    assert.doesNotMatch(error.message, /ECONNREFUSED|10\.1\.2\.3|internal-backend-9/);
    return true;
  });

  const unreadable = new AnalysisBackendClient({
    origin: "https://backend.invalid",
    token: TEST_READ_TOKEN,
    fetcher: (async () => new Response("<html>gateway error</html>", { status: 502 })) as unknown as typeof fetch,
  });
  await assert.rejects(unreadable.listFilings(FIXTURE_TICKER), (error: unknown) =>
    error instanceof AnalysisRequestError && error.code === "BACKEND_UNAVAILABLE");
});

test("a hung backend is abandoned rather than allowed to hang the caller", async () => {
  const client = new AnalysisBackendClient({
    origin: "https://backend.invalid",
    token: TEST_READ_TOKEN,
    timeoutMs: 20,
    fetcher: ((_input: RequestInfo | URL, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    })) as unknown as typeof fetch,
  });
  await assert.rejects(client.listFilings(FIXTURE_TICKER), (error: unknown) =>
    error instanceof AnalysisRequestError && error.code === "BACKEND_UNAVAILABLE");
});

/**
 * A04. The two transports are the same code path, so the only honest way to show it is to run the
 * same request through both shapes and compare what comes back.
 */
test("Service Binding and plain HTTPS return the same domain payload and the same status", async () => {
  const database = await createAnalysisDatabase();
  await seedAnalysisFixtures(database);
  seedCompanyAnalysisPublication(database);
  seedFundamentals(database, { fetchedAt: "2026-08-28T00:00:00.000Z" });
  const env = readEnv(database);

  // The binding ignores the hostname and honours only the path; an external consumer uses a real
  // origin. Both arrive at the same handler with the same credential.
  const overBinding = new AnalysisBackendClient({
    origin: "https://service-binding.invalid",
    token: TEST_READ_TOKEN,
    fetcher: routerFetcher(env),
  });
  const overHttps = new AnalysisBackendClient({
    origin: "https://analysis-backend.example.workers.dev",
    token: TEST_READ_TOKEN,
    fetcher: routerFetcher(env),
  });

  const calls = [
    (client: AnalysisBackendClient) => client.listFilings(FIXTURE_TICKER, { limit: "3" }),
    (client: AnalysisBackendClient) => client.getFiling(FIXTURE_TICKER, VERIFIED_ACCESSION),
    (client: AnalysisBackendClient) => client.getCompanyAnalysis(FIXTURE_TICKER),
    (client: AnalysisBackendClient) => client.getFundamentals(FIXTURE_TICKER),
    (client: AnalysisBackendClient) => client.getFiling(FIXTURE_TICKER, "0000000009-26-999999"),
    (client: AnalysisBackendClient) => client.listFilings("bad ticker"),
  ];
  for (const call of calls) {
    const binding = await call(overBinding);
    const https = await call(overHttps);
    assert.equal(binding.status, https.status);
    assert.deepEqual(binding.body, https.body);
    assert.equal(binding.headers.get("cache-control"), https.headers.get("cache-control"));
    assert.equal(binding.headers.get("etag"), https.headers.get("etag"));
  }
  database.close();
});
