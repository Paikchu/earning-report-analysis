import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./workers/web/migrations",
  schema: "./db/schema.ts",
  dialect: "sqlite",
});
