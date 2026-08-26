import { readFile } from "node:fs/promises";

const [beforePath, afterPath] = process.argv.slice(2);
if (!beforePath || !afterPath) throw new Error("Usage: tsx scripts/verify-r2-manifest.ts source.json destination.json");
const before = await readManifest(beforePath);
const after = await readManifest(afterPath);
const differences: string[] = [];
for (const [key, source] of before.entries()) {
  const destination = after.get(key);
  if (!destination) differences.push(`missing:${key}`);
  else if (source.size !== destination.size || source.sha256 !== destination.sha256) differences.push(`mismatch:${key}`);
}
for (const key of after.keys()) if (!before.has(key)) differences.push(`unexpected:${key}`);
if (differences.length) {
  console.error(JSON.stringify({ ok: false, differences }));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ ok: true, keys: before.size }));
}

async function readManifest(path: string): Promise<Map<string, { size: number; sha256: string }>> {
  const value = JSON.parse(await readFile(path, "utf8")) as { objects?: Array<{ key: string; size: number; sha256: string }> };
  return new Map((value.objects ?? []).map((object) => [object.key, { size: object.size, sha256: object.sha256 }]));
}
