import assert from "node:assert/strict";
import { statSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

/**
 * Automated boundary enforcement (A06).
 *
 * The rule this protects: the Web Worker has no direct capability to reach analysis storage or the
 * analysis executor. Checking for one obvious import string would not hold — the coupling that
 * actually comes back is indirect, through a shared `lib/` module that itself imports a repository.
 * So this resolves the whole import graph from every Web entry point and fails on the first module
 * that is not allowed to be reachable, naming the chain that got there.
 */
const ROOT = fileURLToPath(new URL("../", import.meta.url));

/** Everything the Web Worker can start executing from. */
const WEB_ENTRY_DIRECTORIES = ["app", "components"];
const WEB_ENTRY_FILES = ["workers/web/index.ts"];

/**
 * Modules that reach analysis storage or run analysis. Any of them being reachable from Web means
 * the Worker could query D1/R2 directly, or drag the executor into its bundle.
 */
const BACKEND_ONLY = [
  "lib/sec-d1.ts",
  "lib/sec-public-api.ts",
  "lib/sec-feed.ts",
  "lib/sec-pipeline.ts",
  "lib/sec-runtime.ts",
  "lib/fundamentals-d1.ts",
  "lib/fundamentals-api.ts",
  "lib/fundamental-sync.ts",
  "lib/yahoo-fundamentals-client.ts",
  "lib/company-analysis/repository.ts",
  "lib/company-analysis/api.ts",
  "lib/company-analysis/packet.ts",
  "lib/company-analysis/feature-engine.ts",
  "db/schema.ts",
  "db/fundamentals-schema.ts",
];

/**
 * The admin/control routes legitimately hold `SEC_REFRESH_KEY` and forward to the Pipeline Worker.
 * That is the control plane, not data access, and it predates this refactor. They are allowed to
 * reach `lib/sec-runtime.ts` and `lib/sec-api.ts`, and nothing else on the list.
 */
const CONTROL_PLANE_ENTRIES = new Set([
  "app/api/v1/admin/companies/[ticker]/refresh/route.ts",
  "app/api/v1/admin/companies/[ticker]/backfill/route.ts",
  "app/api/internal/sec/refresh/[ticker]/route.ts",
]);
const CONTROL_PLANE_ALLOWED = new Set(["lib/sec-runtime.ts", "lib/sec-api.ts"]);

type Chain = string[];

test("no Web entry point can reach analysis storage or the analysis executor", async () => {
  const violations: string[] = [];
  for (const entry of await webEntryPoints()) {
    const allowed = CONTROL_PLANE_ENTRIES.has(entry) ? CONTROL_PLANE_ALLOWED : new Set<string>();
    for (const chain of await reachableBackendModules(entry, allowed)) {
      violations.push(chain.join(" -> "));
    }
  }
  assert.deepEqual(violations, [], `Web must not reach analysis storage:\n${violations.join("\n")}`);
});

/**
 * The shared contract is the one thing both sides may import, so it has to stay genuinely
 * runtime-neutral — no repository, no database binding, no Next.js, no model provider.
 */
test("the shared contract module imports nothing that reaches storage or a framework", async () => {
  const contractFiles = (await readdir(join(ROOT, "lib/analysis-contract")))
    .filter((entry) => entry.endsWith(".ts"))
    .map((entry) => join("lib/analysis-contract", entry));
  const forbidden = [...BACKEND_ONLY, "next", "react", "cloudflare:workers", "drizzle-orm"];
  for (const file of contractFiles) {
    for (const specifier of await importsOf(file)) {
      const resolved = resolveSpecifier(file, specifier);
      const subject = resolved ?? specifier;
      assert.equal(
        forbidden.some((entry) => subject === entry || subject.startsWith(`${entry}/`)),
        false,
        `${file} imports ${subject}`,
      );
    }
  }
});

/**
 * A binding removed from the config but left in the ambient types is a boundary that only holds by
 * accident: the next edit that writes `env.DB` in Web would typecheck cleanly and fail at runtime.
 */
test("Web's ambient and entry-point types declare no analysis storage either", async () => {
  // Comments may explain what was removed; only declarations must not bring it back.
  const ambient = stripComments(await readFile(join(ROOT, "workers/web/worker-configuration.d.ts"), "utf8"));
  const entry = stripComments(await readFile(join(ROOT, "workers/web/index.ts"), "utf8"));
  for (const [label, source] of [["ambient types", ambient], ["Worker entry", entry]] as const) {
    assert.doesNotMatch(source, /DB\s*[?]?:\s*D1Database/, `${label} still declares a D1 binding`);
    assert.doesNotMatch(source, /R2Bucket/, `${label} still declares an R2 binding`);
  }

  // And the backend's generated types are regenerated from its real config: they carry the
  // bindings it actually has, and no reverse binding pointing back at Web.
  const backendTypes = await readFile(join(ROOT, "workers/pipeline/worker-configuration.d.ts"), "utf8");
  assert.match(backendTypes, /DB\?: D1Database/);
  assert.match(backendTypes, /ANALYSIS_READ_RATE_LIMIT: RateLimit/);
  assert.doesNotMatch(backendTypes, /WEB_APP_ORIGIN|WEB\?: Fetcher/);
});

test("the deployed Web config binds no analysis storage", async () => {
  const config = JSON.parse(stripComments(await readFile(join(ROOT, "workers/web/wrangler.jsonc"), "utf8"))) as {
    d1_databases?: unknown[];
    r2_buckets?: unknown[];
    services?: Array<{ binding: string }>;
  };
  assert.equal(config.d1_databases, undefined, "the Web Worker must not bind D1");
  assert.equal(config.r2_buckets, undefined, "the Web Worker must not bind R2");
  assert.ok(config.services?.some((binding) => binding.binding === "PIPELINE"));
});

test("the backend Worker still owns the storage, the workflows and the schedule", async () => {
  const source = await readFile(join(ROOT, "workers/pipeline/wrangler.jsonc"), "utf8");
  const config = JSON.parse(stripComments(source)) as {
    d1_databases?: Array<{ binding: string; migrations_dir?: string; database_name?: string }>;
    r2_buckets?: Array<{ binding: string }>;
    workflows?: Array<{ class_name: string }>;
    triggers?: { crons?: string[] };
    services?: unknown[];
    env?: { staging?: { d1_databases?: unknown[]; r2_buckets?: Array<{ bucket_name: string }>; triggers?: { crons?: string[] } } };
  };
  assert.equal(config.d1_databases?.[0]?.binding, "DB");
  assert.equal(config.d1_databases?.[0]?.migrations_dir, "migrations");
  assert.equal(config.r2_buckets?.[0]?.binding, "SEC_FILINGS");
  assert.deepEqual(config.workflows?.map((workflow) => workflow.class_name).sort(), [
    "CompanyAnalysisBackfillWorkflow",
    "CompanyAnalysisWorkflow",
    "SecAnalysisWorkflow",
    "SecMemoryWorkflow",
  ]);
  // Cron is production configuration and this refactor does not touch it.
  assert.deepEqual(config.triggers?.crons, ["*/10 * * * *"]);
  // The dependency direction stays one-way: the backend has no binding pointing back at Web.
  assert.equal(config.services, undefined);

  // A21: staging must not be able to reach production storage.
  assert.equal(config.env?.staging?.d1_databases, undefined, "staging must not bind a D1 database");
  assert.equal(
    config.env?.staging?.r2_buckets?.every((bucket) => bucket.bucket_name.endsWith("-staging")),
    true,
  );
  assert.deepEqual(config.env?.staging?.triggers?.crons, []);
  assert.equal(source.includes("3c917a4c-3562-4de1-8b21-586fa384e63f"), true);
  assert.equal(
    source.split('"staging"')[1]?.includes("3c917a4c-3562-4de1-8b21-586fa384e63f"),
    false,
    "the production database id must not appear inside the staging environment",
  );
});

test("every backend Workflow class is still exported from the Worker entry point", async () => {
  const entry = await readFile(join(ROOT, "workers/pipeline/index.ts"), "utf8");
  for (const workflow of ["SecAnalysisWorkflow", "SecMemoryWorkflow", "CompanyAnalysisWorkflow", "CompanyAnalysisBackfillWorkflow"]) {
    assert.match(entry, new RegExp(`export class ${workflow}\\b`));
  }
  // The handler tested in tests/analysis-integration.test.ts is the one this file actually deploys.
  assert.match(entry, /import worker from "\.\/worker\.ts";/);
  assert.match(entry, /export default worker;/);

  const handler = await readFile(join(ROOT, "workers/pipeline/worker.ts"), "utf8");
  assert.match(handler, /async scheduled\(/);
  // Reads claim /api/v1 before anything can fall through to a control handler.
  assert.ok(
    handler.indexOf("isAnalysisReadPath") < handler.indexOf("handleSecAnalysisRequest(request, env)"),
    "the read router must be matched before the control handler",
  );
});

/**
 * The check above only means something if the machinery can actually see a violation. This is its
 * negative control: the Pipeline Worker's own entry point genuinely does reach the repositories,
 * indirectly, and the walker has to find it. If this stops failing to be clean, the check above has
 * quietly become vacuous.
 */
test("the boundary walker detects a real violation when there is one", async () => {
  const chains = await reachableBackendModules("workers/pipeline/index.ts", new Set());
  assert.ok(chains.length > 0, "the walker found nothing in a file that certainly reaches storage");
  const flattened = chains.map((chain) => chain.join(" -> "));
  assert.ok(
    flattened.some((chain) => chain.includes("lib/sec-d1.ts")),
    `expected a chain reaching lib/sec-d1.ts, got:\n${flattened.join("\n")}`,
  );
  // And it must find it transitively, not only as a direct import of the entry point.
  assert.ok(
    chains.some((chain) => chain.length > 2),
    "the walker must follow indirect chains, not just direct imports",
  );

  // The resolver itself resolves both alias and relative forms.
  assert.equal(resolveSpecifier("app/page.tsx", "@/lib/sec-config"), "lib/sec-config.ts");
  assert.equal(resolveSpecifier("workers/pipeline/index.ts", "./core.ts"), "workers/pipeline/core.ts");
  assert.equal(resolveSpecifier("app/page.tsx", "next/navigation"), null);
});

async function webEntryPoints(): Promise<string[]> {
  const files: string[] = [...WEB_ENTRY_FILES];
  for (const directory of WEB_ENTRY_DIRECTORIES) {
    const entries = await readdir(join(ROOT, directory), { recursive: true, withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || ![".ts", ".tsx"].includes(extname(entry.name))) continue;
      files.push(relative(ROOT, join(entry.parentPath, entry.name)));
    }
  }
  return files.sort();
}

/** Walks the import graph from one entry point and returns a chain for each forbidden module hit. */
async function reachableBackendModules(entry: string, allowed: Set<string>): Promise<Chain[]> {
  const found: Chain[] = [];
  const seen = new Set<string>();

  async function walk(file: string, chain: Chain): Promise<void> {
    if (seen.has(file)) return;
    seen.add(file);
    for (const specifier of await importsOf(file)) {
      const resolved = resolveSpecifier(file, specifier);
      if (!resolved) continue;
      const next = [...chain, resolved];
      if (BACKEND_ONLY.includes(resolved) && !allowed.has(resolved)) {
        found.push(next);
        continue;
      }
      await walk(resolved, next);
    }
  }

  await walk(entry, [entry]);
  return found;
}

const importCache = new Map<string, string[]>();

async function importsOf(file: string): Promise<string[]> {
  const cached = importCache.get(file);
  if (cached) return cached;
  let source: string;
  try {
    source = await readFile(join(ROOT, file), "utf8");
  } catch {
    importCache.set(file, []);
    return [];
  }
  const specifiers = [
    // `import x from "y"`, `export … from "y"`, and both dynamic and type-only forms.
    ...source.matchAll(/(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*["']([^"']+)["']/g),
    ...source.matchAll(/(?:^|\n)\s*import\s*["']([^"']+)["']/g),
    ...source.matchAll(/import\s*\(\s*["']([^"']+)["']\s*\)/g),
  ].map((match) => match[1]!);
  const unique = [...new Set(specifiers)];
  importCache.set(file, unique);
  return unique;
}

/** Resolves a specifier to a repo-relative path, or null when it leaves the repository. */
function resolveSpecifier(fromFile: string, specifier: string): string | null {
  const raw = specifier.startsWith("@/")
    ? specifier.slice(2)
    : specifier.startsWith(".")
      ? relative(ROOT, resolve(ROOT, dirname(fromFile), specifier))
      : null;
  if (raw === null) return null;
  const withoutExtension = raw.replace(/\.(ts|tsx|js|jsx)$/, "");
  for (const candidate of [`${withoutExtension}.ts`, `${withoutExtension}.tsx`, `${withoutExtension}/index.ts`, raw]) {
    if (existsSyncCached(candidate)) return candidate;
  }
  return null;
}

const existenceCache = new Map<string, boolean>();

function existsSyncCached(candidate: string): boolean {
  const cached = existenceCache.get(candidate);
  if (cached !== undefined) return cached;
  let exists = false;
  try {
    exists = statSync(join(ROOT, candidate)).isFile();
  } catch {
    exists = false;
  }
  existenceCache.set(candidate, exists);
  return exists;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}
