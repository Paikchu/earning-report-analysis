import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("the symbol directory CLI merges official files into a compact catalog", async () => {
  const directory = await mkdtemp(join(tmpdir(), "symbol-directory-"));
  const nasdaqPath = join(directory, "nasdaq.txt");
  const otherPath = join(directory, "other.txt");
  const outputPath = join(directory, "symbols.json");

  await Promise.all([
    writeFile(nasdaqPath, "Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares\nAAPL|Apple Inc. - Common Stock|Q|N|N|100|N|N\nFile Creation Time: 0722202612:00|||||||"),
    writeFile(otherPath, "ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol\nBOXX|Alpha Architect 1-3 Month Box ETF|P|BOXX|Y|100|N|BOXX\nFile Creation Time: 0722202612:00|||||||"),
  ]);

  await execFileAsync(process.execPath, [
    "--experimental-strip-types", "scripts/update-symbol-directory.ts",
    "--nasdaq", nasdaqPath, "--other", otherPath, "--output", outputPath,
  ], { cwd: new URL("../", import.meta.url) });

  const result = JSON.parse(await readFile(outputPath, "utf8"));
  assert.match(result.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(result.sourceUpdatedAt, "0722202612:00");
  assert.deepEqual(result.securities.map((item: { symbol: string }) => item.symbol), ["AAPL", "BOXX"]);
});
