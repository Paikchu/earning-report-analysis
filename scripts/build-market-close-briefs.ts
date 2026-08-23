import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { validateMarketCloseBriefArchive, type MarketCloseBriefArchiveV1, type MarketCloseBriefV1 } from "../lib/market-close-brief.ts";

const sourceDirectory = process.argv[2] ?? "data/market-close-briefs";
const outputPath = process.argv[3] ?? "data/market-close-briefs.json";
const files = (await readdir(sourceDirectory))
  .filter((file) => /^\d{4}-\d{2}-\d{2}\.json$/.test(file))
  .sort()
  .reverse();
const items = await Promise.all(files.map(async (file) => JSON.parse(await readFile(path.join(sourceDirectory, file), "utf8")) as MarketCloseBriefV1));
const archive: MarketCloseBriefArchiveV1 = { version: 1, items };
const errors = validateMarketCloseBriefArchive(archive);

if (errors.length) {
  for (const error of errors) console.error(error);
  process.exitCode = 1;
} else {
  await writeFile(outputPath, `${JSON.stringify(archive, null, 2)}\n`, "utf8");
  console.log(`Market close archive is valid: ${items.length} file(s), latest ${items[0].sessionDate}`);
}
