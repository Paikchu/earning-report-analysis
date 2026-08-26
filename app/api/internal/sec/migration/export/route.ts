import { getD1 } from "@/db";
import { hasInternalSecAccess } from "@/lib/sec-api";
import { isSecMigrationTable, readMigrationPage, writeMigrationRows, type MigrationRow } from "@/lib/sec-migration";
import { getSecRuntimeConfig } from "@/lib/sec-runtime";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const runtime = await getSecRuntimeConfig();
  const suppliedKey = request.headers.get("x-sec-migration-key") ?? "";
  const authorized = runtime.migrationKey && suppliedKey
    ? await hasInternalSecAccess(new Request(request.url, { headers: { "x-sec-refresh-key": suppliedKey } }), runtime.migrationKey)
    : false;
  if (!authorized) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const table = url.searchParams.get("table") ?? "";
  if (!isSecMigrationTable(table)) return Response.json({ error: "Unknown SEC migration table" }, { status: 400 });
  const page = await readMigrationPage(await getD1(), table, Number(url.searchParams.get("cursor") ?? 0), Number(url.searchParams.get("limit") ?? 50));
  return Response.json(page, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const runtime = await getSecRuntimeConfig();
  const suppliedKey = request.headers.get("x-sec-migration-key") ?? "";
  const authorized = runtime.migrationKey && suppliedKey
    ? await hasInternalSecAccess(new Request(request.url, { headers: { "x-sec-refresh-key": suppliedKey } }), runtime.migrationKey)
    : false;
  if (!authorized) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json() as { table?: string; rows?: MigrationRow[] };
  if (!body.table || !isSecMigrationTable(body.table)) return Response.json({ error: "Unknown SEC migration table" }, { status: 400 });
  if (!Array.isArray(body.rows)) return Response.json({ error: "Migration rows are required" }, { status: 400 });
  try {
    return Response.json({ table: body.table, imported: await writeMigrationRows(await getD1(), body.table, body.rows) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Migration import failed" }, { status: 400 });
  }
}
