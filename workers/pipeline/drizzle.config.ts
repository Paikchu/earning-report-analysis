import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./workers/pipeline/migrations",
  schema: "./workers/pipeline/src/db/schema.ts",
  dialect: "sqlite",
});
