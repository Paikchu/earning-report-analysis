import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

test("validates the checked-in review against the current portfolio snapshot", async () => {
  const reviewModule = await import("../lib/daily-portfolio-review.ts");
  const [review, snapshot] = await Promise.all([
    readFile(new URL("data/daily-portfolio-review.json", projectRoot), "utf8").then(JSON.parse),
    readFile(new URL("data/portfolio-snapshot.json", projectRoot), "utf8").then(JSON.parse),
  ]);

  assert.deepEqual(reviewModule.validateDailyPortfolioReview(review, snapshot), []);
});

test("rejects stale provenance, unknown tickers, and untrusted source URLs", async () => {
  const { validateDailyPortfolioReview } = await import("../lib/daily-portfolio-review.ts");
  const snapshot = JSON.parse(await readFile(new URL("data/portfolio-snapshot.json", projectRoot), "utf8"));
  const review = {
    version: 1,
    reviewDate: "2026-08-13",
    generatedAt: "2026-08-13T02:00:00.000Z",
    snapshotGeneratedAt: "2026-08-11T00:00:00.000Z",
    tone: "balanced",
    headline: "测试复盘",
    summary: "这是一条足够明确的测试摘要。",
    drivers: [{ title: "测试驱动", detail: "已披露事实。", implication: "组合层面的含义。", tickers: ["UNKNOWN"] }],
    watchItems: [{ label: "测试观察", detail: "需要继续验证。" }],
    sources: [{ title: "不安全来源", url: "http://example.com" }],
  };

  const errors = validateDailyPortfolioReview(review, snapshot);
  assert.ok(errors.some((error: string) => error.includes("snapshotGeneratedAt")));
  assert.ok(errors.some((error: string) => error.includes("UNKNOWN")));
  assert.ok(errors.some((error: string) => error.includes("HTTPS")));
});

test("requires at least one material driver, watch item, and source", async () => {
  const { validateDailyPortfolioReview } = await import("../lib/daily-portfolio-review.ts");
  const snapshot = JSON.parse(await readFile(new URL("data/portfolio-snapshot.json", projectRoot), "utf8"));
  const review = {
    version: 1,
    reviewDate: "2026-08-13",
    generatedAt: "2026-08-13T02:00:00.000Z",
    snapshotGeneratedAt: snapshot.generatedAt,
    tone: "balanced",
    headline: "测试复盘",
    summary: "这是一条足够明确的测试摘要。",
    drivers: [],
    watchItems: [],
    sources: [],
  };

  const errors = validateDailyPortfolioReview(review, snapshot);
  assert.ok(errors.some((error: string) => error.includes("drivers")));
  assert.ok(errors.some((error: string) => error.includes("watchItems")));
  assert.ok(errors.some((error: string) => error.includes("sources")));
});
