import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { mergeSymbolDirectories, parseNasdaqListed, parseOtherListed } from "../lib/symbol-directory.ts";

const NASDAQ_URL = "https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt";
const OTHER_URL = "https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt";

const argument = (name: string, fallback?: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};

const nasdaqSource = argument("--nasdaq");
const otherSource = argument("--other");
const outputPath = argument("--output", "data/us-securities.json")!;

const [nasdaqContents, otherContents] = await Promise.all([
  load(nasdaqSource, NASDAQ_URL),
  load(otherSource, OTHER_URL),
]);
const generatedAt = new Date().toISOString();
const sourceUpdatedAt = directoryTimestamp(nasdaqContents) ?? directoryTimestamp(otherContents);
const securities = mergeSymbolDirectories(parseNasdaqListed(nasdaqContents), parseOtherListed(otherContents));
if (securities.length === 0) throw new Error("Symbol directory is empty");

const temporaryPath = join(dirname(outputPath), `.us-securities-${process.pid}.tmp`);
await writeFile(temporaryPath, `${JSON.stringify({ generatedAt, sourceUpdatedAt, securities })}\n`);
await rename(temporaryPath, outputPath);

async function load(filePath: string | undefined, remoteUrl: string): Promise<string> {
  if (filePath) return readFile(filePath, "utf8");
  const response = await fetch(remoteUrl, { headers: { "user-agent": "MAX-Investment-Record/1.0" } });
  if (!response.ok) throw new Error(`Symbol directory request failed: ${response.status}`);
  return response.text();
}

function directoryTimestamp(contents: string): string | null {
  return contents.match(/^File Creation Time:\s*([^|\r\n]+)/m)?.[1]?.trim() ?? null;
}
