import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("adds ownership data to the stock detail flow", async () => {
  const [detail, section, route, css] = await Promise.all([
    readFile(new URL("../app/positions/[ticker]/PositionDetailContent.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/positions/[ticker]/OwnershipSection.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ownership/[ticker]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(detail, /<OwnershipSection ticker=\{ticker\} \/>/);
  assert.match(section, /机构披露持仓占比/);
  assert.match(section, /内部人\/大股东披露占比/);
  assert.match(section, /散户及未分类估算占比/);
  assert.match(section, /cache: "no-store"/);
  assert.match(section, /\/api\/ownership\/\$\{encodeURIComponent\(ticker\)\}/);
  assert.match(route, /getChatGPTUser/);
  assert.match(route, /refreshOwnership/);
  assert.match(css, /\.ownership-section/);
  assert.match(css, /\.ownership-composition-bar/);
});

test("protects the ownership route and keeps the shared repository cache available", async () => {
  await Promise.all([
    access(new URL("../app/api/ownership/[ticker]/route.ts", import.meta.url)),
    access(new URL("../lib/ownership-service.ts", import.meta.url)),
  ]);
  const [route, service] = await Promise.all([
    readFile(new URL("../app/api/ownership/[ticker]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/ownership-service.ts", import.meta.url), "utf8"),
  ]);

  assert.match(route, /new D1SecRepository/);
  assert.match(route, /findSecurity/);
  assert.match(service, /ownership:/);
});
