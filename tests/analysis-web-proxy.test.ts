import assert from "node:assert/strict";
import test from "node:test";

import { AnalysisBackendClient } from "../lib/analysis-contract/client.ts";
import { proxyAnalysisRead, type ProxyDependencies } from "../lib/analysis-proxy.ts";
import { handleAnalysisReadRequest } from "../workers/pipeline/read-api/router.ts";
import { TEST_READ_TOKEN, createAnalysisDatabase, readEnv } from "./helpers/analysis-backend.ts";
import {
  FIXTURE_TICKER,
  VERIFIED_ACCESSION,
  seedAnalysisFixtures,
  seedCompanyAnalysisPublication,
  seedFundamentals,
} from "./helpers/analysis-fixtures.ts";
import type { PublicFilingPage } from "../lib/analysis-contract/filings.ts";

/**
 * The Web Worker's compatibility layer, running the real backend behind it. The proxy's job is
 * mostly negative — keep the URLs, keep anonymous access, and reveal nothing about the credential
 * it holds — so most of what these tests check is what does *not* come out.
 */
async function proxyAgainstBackend(overrides: { token?: string; origin?: string } = {}) {
  const database = await createAnalysisDatabase();
  await seedAnalysisFixtures(database);
  seedCompanyAnalysisPublication(database);
  seedFundamentals(database, { fetchedAt: "2026-08-28T00:00:00.000Z" });
  const env = readEnv(database);
  const client = new AnalysisBackendClient({
    origin: overrides.origin ?? "https://service-binding.invalid",
    token: overrides.token ?? TEST_READ_TOKEN,
    fetcher: (async (input: RequestInfo | URL, init?: RequestInit) =>
      handleAnalysisReadRequest(new Request(input as RequestInfo, init) as unknown as Request, env)) as unknown as typeof fetch,
  });
  const dependencies: ProxyDependencies = {
    getRuntime: async () => ({ configured: true, client }),
    getRateLimiter: async () => null,
  };
  return { database, client, dependencies };
}

function anonymous(path: string): Request {
  return new Request(`https://site.test${path}`);
}

test("a public request with no credential still gets the data, at its original URL", async () => {
  const { database, client, dependencies } = await proxyAgainstBackend();
  const response = await proxyAnalysisRead(
    anonymous(`/api/v1/companies/${FIXTURE_TICKER}/filings?limit=2`),
    () => client.listFilings(FIXTURE_TICKER, { limit: "2" }),
    dependencies,
  );
  assert.equal(response.status, 200);
  const page = await response.json() as PublicFilingPage;
  // Forwarded verbatim: the body is the backend's, not a second envelope wrapped around it.
  assert.equal(page.apiSchemaVersion, "analysis-api.v1");
  assert.equal(page.filings.length, 2);
  assert.equal("body" in page, false);
  assert.equal("data" in page, false);
  // Public data, public cache, CORS as before.
  assert.equal(response.headers.get("cache-control"), "public, max-age=30, stale-while-revalidate=300");
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(response.headers.get("vary"), "Origin");
  database.close();
});

test("a client's own mistakes are forwarded; the backend's private failures are not", async () => {
  const { database, client, dependencies } = await proxyAgainstBackend();
  const notFound = await proxyAnalysisRead(
    anonymous(`/api/v1/companies/${FIXTURE_TICKER}/filings/0000000009-26-999999`),
    () => client.getFiling(FIXTURE_TICKER, "0000000009-26-999999"),
    dependencies,
  );
  assert.equal(notFound.status, 404);
  assert.equal((await notFound.json() as { code: string }).code, "FILING_NOT_FOUND");

  const invalid = await proxyAnalysisRead(
    anonymous("/api/v1/companies/bad/filings"),
    () => client.listFilings("not a ticker"),
    dependencies,
  );
  assert.equal(invalid.status, 400);
  database.close();
});

/**
 * A15. Whether Web's credential is missing, wrong, or the backend is simply down is an operator's
 * problem. A browser gets one flat answer either way.
 */
test("no backend refusal reveals anything about the credential Web holds", async () => {
  const database = await createAnalysisDatabase();
  const env = readEnv(database);
  const routerFetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
    handleAnalysisReadRequest(new Request(input as RequestInfo, init) as unknown as Request, env)) as unknown as typeof fetch;

  const scenarios: Array<[string, ProxyDependencies]> = [
    ["unconfigured token", { getRuntime: async () => ({ configured: false, reason: "missing_token" }) }],
    ["unconfigured origin", { getRuntime: async () => ({ configured: false, reason: "missing_origin" }) }],
    ["wrong credential", {
      getRuntime: async () => ({
        configured: true,
        client: new AnalysisBackendClient({ origin: "https://b.invalid", token: "test-consumer.wrong-secret-0123456789abc", fetcher: routerFetch }),
      }),
    }],
    ["backend unreachable", {
      getRuntime: async () => ({
        configured: true,
        client: new AnalysisBackendClient({
          origin: "https://internal-backend-9.invalid",
          token: TEST_READ_TOKEN,
          fetcher: (async () => { throw new Error("connect ECONNREFUSED 10.0.0.7"); }) as unknown as typeof fetch,
        }),
      }),
    }],
  ];

  const errors: string[] = [];
  const originalError = console.error;
  console.error = (value: unknown) => { errors.push(String(value)); };
  try {
    for (const [label, dependencies] of scenarios) {
      const response = await proxyAnalysisRead(
        anonymous(`/api/v1/companies/${FIXTURE_TICKER}/analysis`),
        (client) => client.getCompanyAnalysis(FIXTURE_TICKER),
        { getRateLimiter: async () => null, ...dependencies },
      );
      const text = await response.text();
      assert.equal(response.status, 503, label);
      assert.equal(JSON.parse(text).code, "ANALYSIS_BACKEND_UNAVAILABLE", label);
      // An outage must not render as "no reports" — the state that used to hide a broken fallback.
      assert.doesNotMatch(text, /unavailable_credential|missing_token|401|403|ECONNREFUSED|10\.0\.0\.7/, label);
      assert.equal(response.headers.get("cache-control"), "no-store", label);
    }
  } finally {
    console.error = originalError;
  }
  // The reason is available to an operator, in the log, and nowhere else.
  assert.equal(errors.length, 4);
  assert.match(errors.join("\n"), /missing_token/);
  assert.doesNotMatch(errors.join("\n"), new RegExp(TEST_READ_TOKEN));
  database.close();
});

test("the public front door is rate limited on the caller's IP, not on Web's credential", async () => {
  const { database, client } = await proxyAgainstBackend();
  const keys: string[] = [];
  const response = await proxyAnalysisRead(
    new Request(`https://site.test/api/v1/companies/${FIXTURE_TICKER}/filings`, {
      headers: { "cf-connecting-ip": "203.0.113.7" },
    }),
    () => client.listFilings(FIXTURE_TICKER),
    {
      getRuntime: async () => ({ configured: true, client }),
      getRateLimiter: async () => ({ async limit({ key }) { keys.push(key); return { success: false }; } }),
    },
  );
  assert.equal(response.status, 429);
  assert.equal((await response.json() as { code: string }).code, "PUBLIC_RATE_LIMITED");
  assert.deepEqual(keys, ["203.0.113.7"]);
  database.close();
});

test("a backend rate limit reaches the caller as a rate limit, not as an outage", async () => {
  const { database, dependencies } = await proxyAgainstBackend();
  const response = await proxyAnalysisRead(
    anonymous(`/api/v1/companies/${FIXTURE_TICKER}/filings`),
    async () => ({ status: 429, headers: new Headers(), body: { code: "RATE_LIMITED", error: "x", apiSchemaVersion: "analysis-api.v1" as const } }),
    dependencies,
  );
  assert.equal(response.status, 429);
  assert.equal((await response.json() as { code: string }).code, "ANALYSIS_BACKEND_RATE_LIMITED");
  database.close();
});

test("a no-store payload does not become publicly cacheable on the way through", async () => {
  const { database, client, dependencies } = await proxyAgainstBackend();
  // A company with no publication answers no-store on the backend; the proxy must not widen that.
  const response = await proxyAnalysisRead(
    anonymous("/api/v1/companies/NVDA/analysis"),
    () => client.getCompanyAnalysis("NVDA"),
    dependencies,
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");

  const cacheable = await proxyAnalysisRead(
    anonymous(`/api/v1/companies/${FIXTURE_TICKER}/filings/${VERIFIED_ACCESSION}`),
    () => client.getFiling(FIXTURE_TICKER, VERIFIED_ACCESSION),
    dependencies,
  );
  assert.match(cacheable.headers.get("cache-control") ?? "", /^public, max-age=30/);
  database.close();
});
