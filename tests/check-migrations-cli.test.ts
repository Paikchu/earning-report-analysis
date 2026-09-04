import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const projectRoot = new URL("../", import.meta.url);

type Fixture = { configPath: string; wranglerPath: string };

async function buildFixture(bundled: string[], wranglerScript: string): Promise<Fixture> {
  const directory = await mkdtemp(join(tmpdir(), "check-migrations-"));
  const migrationsDirectory = join(directory, "migrations");
  const serverDirectory = join(directory, "server");
  await Promise.all([mkdir(migrationsDirectory), mkdir(serverDirectory)]);

  const configPath = join(serverDirectory, "wrangler.json");
  const wranglerPath = join(directory, "wrangler-stub.sh");
  await Promise.all([
    ...bundled.map((name) => writeFile(join(migrationsDirectory, name), "SELECT 1;")),
    // A meta directory sits beside the SQL files in a real build and must not be counted.
    mkdir(join(migrationsDirectory, "meta")),
    writeFile(configPath, JSON.stringify({
      name: "earning-report-analysis-sec-web",
      d1_databases: [{
        binding: "DB",
        database_id: "3c917a4c-3562-4de1-8b21-586fa384e63f",
        database_name: "test-db",
        migrations_dir: "../migrations",
      }],
    })),
    writeFile(wranglerPath, wranglerScript),
  ]);
  await chmod(wranglerPath, 0o755);
  return { configPath, wranglerPath };
}

function appliedStub(applied: string[]): string {
  const payload = JSON.stringify([{ results: applied.map((name) => ({ name })), success: true }]);
  return `#!/bin/sh\necho '▲ [WARNING] Proxy environment variables detected.' >&2\ncat <<'JSON'\n${payload}\nJSON\n`;
}

function runCheck({ configPath, wranglerPath }: Fixture) {
  return execFileAsync(process.execPath, [
    "--experimental-strip-types",
    "workers/web/scripts/check-migrations.ts",
  ], {
    cwd: projectRoot,
    env: { ...process.env, SEC_WEB_WRANGLER_CONFIG: configPath, SEC_WEB_WRANGLER_BIN: wranglerPath },
  });
}

test("passes when the database has applied every migration in the build", async () => {
  const fixture = await buildFixture(
    ["0000_first.sql", "0001_second.sql"],
    appliedStub(["0000_first.sql", "0001_second.sql"]),
  );

  const result = await runCheck(fixture);
  const summary = JSON.parse(result.stdout) as Record<string, unknown>;
  assert.equal(summary.databaseName, "test-db");
  assert.equal(summary.bundledMigrations, 2);
  assert.equal(summary.appliedMigrations, 2);
  assert.equal(summary.latestMigration, "0001_second.sql");
});

test("refuses a deploy whose migrations the database has not applied", async () => {
  const fixture = await buildFixture(
    ["0000_first.sql", "0001_second.sql"],
    appliedStub(["0000_first.sql"]),
  );

  const error = await runCheck(fixture).then(() => null, (reason: { stderr: string }) => reason);
  assert.ok(error, "the check must fail when the database is behind the build");
  assert.match(error.stderr, /behind this build by 1 migration\(s\): 0001_second\.sql/);
  assert.match(error.stderr, /wrangler d1 migrations apply test-db --remote/);
});

test("refuses a build that predates migrations the database already ran", async () => {
  const fixture = await buildFixture(
    ["0000_first.sql"],
    appliedStub(["0000_first.sql", "0001_second.sql"]),
  );

  const error = await runCheck(fixture).then(() => null, (reason: { stderr: string }) => reason);
  assert.ok(error, "the check must fail when the build is older than the database");
  assert.match(error.stderr, /does not carry: 0001_second\.sql/);
});

test("treats a database with no bookkeeping table as having applied nothing", async () => {
  const fixture = await buildFixture(
    ["0000_first.sql"],
    "#!/bin/sh\necho 'ERROR: no such table: d1_migrations' >&2\nexit 1\n",
  );

  const error = await runCheck(fixture).then(() => null, (reason: { stderr: string }) => reason);
  assert.ok(error, "an unmigrated database is still drift");
  assert.match(error.stderr, /behind this build by 1 migration\(s\): 0000_first\.sql/);
});

test("reports a broken lookup instead of reading it as an empty database", async () => {
  const fixture = await buildFixture(
    ["0000_first.sql"],
    "#!/bin/sh\necho 'ERROR: Authentication error [code: 10000]' >&2\nexit 1\n",
  );

  const error = await runCheck(fixture).then(() => null, (reason: { stderr: string }) => reason);
  assert.ok(error, "an unreadable database must not pass the check");
  assert.match(error.stderr, /Could not read applied migrations from test-db/);
  assert.match(error.stderr, /Authentication error/);
});
