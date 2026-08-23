import { readFile } from "node:fs/promises";

import { validateMarketCloseBriefArchive } from "../lib/market-close-brief.ts";

const archivePath = process.argv[2] ?? "data/market-close-briefs.json";
const archive = JSON.parse(await readFile(archivePath, "utf8"));
const errors = validateMarketCloseBriefArchive(archive);

if (errors.length) {
  for (const error of errors) console.error(error);
  process.exitCode = 1;
} else {
  console.log(`Market close archive is valid: ${archive.items.length} file(s), latest ${archive.items[0].sessionDate}`);
}
