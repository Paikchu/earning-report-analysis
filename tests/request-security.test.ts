import assert from "node:assert/strict";
import test from "node:test";

import { isSameOriginRequest } from "../lib/request-security.ts";

test("accepts same-origin writes and rejects missing or foreign origins", () => {
  assert.equal(isSameOriginRequest(new Request("https://site.example/api/plans/AAPL", { headers: { origin: "https://site.example" } })), true);
  assert.equal(isSameOriginRequest(new Request("https://site.example/api/plans/AAPL")), false);
  assert.equal(isSameOriginRequest(new Request("https://site.example/api/plans/AAPL", { headers: { origin: "https://evil.example" } })), false);
});

