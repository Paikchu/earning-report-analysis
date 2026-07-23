import assert from "node:assert/strict";
import test from "node:test";

test("formats financial signs with a true minus and fixed decimals", async () => {
  const { money, percent, number } = await import("../lib/portfolio-format.ts");

  assert.equal(money(-5032.09), "−$5,032.09");
  assert.equal(money(86.17, true), "+$86.17");
  assert.equal(percent(-7.0316, true), "−7.03%");
  assert.equal(percent(31.7949), "31.79%");
  assert.equal(number(-1.25, 2, 2), "−1.25");
});
