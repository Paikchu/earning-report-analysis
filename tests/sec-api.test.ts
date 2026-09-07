import assert from "node:assert/strict";
import test from "node:test";
import { hasInternalSecAccess } from "../workers/pipeline/src/sec/api.ts";
import { hasSecAdminAccess } from "../lib/web/admin-auth.ts";
import { createAnalysisClient } from "../lib/web/analysis-client.ts";

test("requires the exact service credential", async () => {
  for (const supplied of ["", "wrong"]) assert.equal(await hasInternalSecAccess(new Request("https://service.test", { headers: { "x-sec-refresh-key": supplied } }), "secret"), false);
  assert.equal(await hasInternalSecAccess(new Request("https://service.test", { headers: { "x-sec-refresh-key": "secret" } }), "secret"), true);
  assert.equal(await hasInternalSecAccess(new Request("https://service.test", { headers: { "x-sec-refresh-key": "secret" } }), ""), false);
});

test("Web admin auth requires a bearer token and does not accept a service credential", async () => {
  assert.equal(await hasSecAdminAccess(new Request("https://web.test", { headers: { "x-sec-refresh-key": "secret" } }), "secret"), false);
  assert.equal(await hasSecAdminAccess(new Request("https://web.test", { headers: { authorization: "Bearer wrong" } }), "secret"), false);
  assert.equal(await hasSecAdminAccess(new Request("https://web.test", { headers: { authorization: "Bearer secret" } }), "secret"), true);
});

test("Web queues jobs through the single transport and streams status back", async () => {
  const captured: Request[] = [];
  const client = createAnalysisClient({ token: "secret", binding: { async fetch(request) { captured.push(request); return Response.json({ status: "queued" }, { status: 202 }); } } });
  const response = await client.request("/api/v1/admin/companies/MSFT/refresh", "POST");
  assert.equal(response.status, 202);
  assert.equal(captured.length, 1);
  assert.equal(captured[0].method, "POST");
  assert.equal(captured[0].headers.get("x-sec-refresh-key"), "secret");
  assert.equal(captured[0].headers.has("authorization"), false);
});
