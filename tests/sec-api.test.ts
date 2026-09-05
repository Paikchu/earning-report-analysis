import assert from "node:assert/strict";
import test from "node:test";

import { hasInternalSecAccess, hasSecAdminAccess, requestSecAnalysis, requestSecBackfill } from "../lib/sec-api.ts";

test("requires the exact internal refresh key", async () => {
  assert.equal(await hasInternalSecAccess(new Request("https://site.test"), "secret"), false);
  assert.equal(await hasInternalSecAccess(new Request("https://site.test", { headers: { "x-sec-refresh-key": "wrong" } }), "secret"), false);
  assert.equal(await hasInternalSecAccess(new Request("https://site.test", { headers: { "x-sec-refresh-key": "secret" } }), "secret"), true);
  assert.equal(await hasInternalSecAccess(new Request("https://site.test", { headers: { "x-sec-refresh-key": "secret" } }), ""), false);
});

test("queues analysis through the independent worker and returns immediately", async () => {
  const captured: Request[] = [];
  const response = await requestSecAnalysis({
    ticker: "MSFT",
    pipelineOrigin: "https://sec-worker.example/",
    refreshKey: "secret",
    fetcher: async (input, init) => {
      captured.push(new Request(input, init));
      return Response.json({ status: "queued", jobId: "manual-MSFT-1" }, { status: 202 });
    },
  });

  assert.equal(response.status, 202);
  assert.equal(captured.length, 1);
  assert.equal(captured[0].url, "https://sec-worker.example/jobs/MSFT");
  assert.equal(captured[0].method, "POST");
  assert.equal(captured[0].headers.get("x-sec-refresh-key"), "secret");
});

test("requires an exact admin bearer token", async () => {
  const bearer = (value: string) => new Request("https://site.test", { headers: { authorization: `Bearer ${value}` } });
  assert.equal(await hasSecAdminAccess(bearer("admin-token"), "admin-token"), true);
  assert.equal(await hasSecAdminAccess(bearer("wrong"), "admin-token"), false);
  assert.equal(await hasSecAdminAccess(new Request("https://site.test"), "admin-token"), false);
  // Fails closed when no admin token is configured, rather than accepting anything.
  assert.equal(await hasSecAdminAccess(bearer("anything"), ""), false);
});

test("backfill forwards to its own backend path with the same administrative key", async () => {
  const captured: Request[] = [];
  const response = await requestSecBackfill({
    ticker: "MSFT",
    pipelineOrigin: "https://sec-worker.example/",
    refreshKey: "secret",
    fetcher: async (input, init) => {
      captured.push(new Request(input, init));
      return Response.json({ status: "queued" }, { status: 202 });
    },
  });
  assert.equal(response.status, 202);
  assert.equal(captured[0]!.url, "https://sec-worker.example/backfill/MSFT");
  assert.equal(captured[0]!.headers.get("x-sec-refresh-key"), "secret");
});

test("an unconfigured backend is reported, not silently skipped", async () => {
  const response = await requestSecAnalysis({
    ticker: "MSFT",
    pipelineOrigin: "",
    refreshKey: "",
    fetcher: async () => { throw new Error("must not be called"); },
  });
  assert.equal(response.status, 503);
});
