import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

/**
 * This example used to borrow the app's `db/index.ts`. That module is gone: the Web Worker no
 * longer binds D1 at all — analysis data is read from the Pipeline Worker's read API — so a
 * standalone D1 example has to carry its own binding accessor. It is not wired into either Worker.
 */
export async function getDb() {
  return drizzle(await getD1(), { schema });
}

export async function getD1(): Promise<D1Database> {
  const { env } = await import("cloudflare:workers");
  const database = (env as unknown as { DB?: D1Database }).DB;
  if (!database) throw new Error("Cloudflare D1 binding `DB` is unavailable.");
  return database;
}
