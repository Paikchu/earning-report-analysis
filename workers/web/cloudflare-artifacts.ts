import { access, cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import type { Plugin } from "vite";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

// Packages D1 migrations after Vite finishes compiling.
export function cloudflareArtifacts(): Plugin {
  let root = process.cwd();

  return {
    name: "cloudflare-artifacts",
    apply: "build",
    configResolved(config) {
      root = config.root;
    },
    async closeBundle() {
      // Keep migrations next to, rather than inside, the server bundle. prepare-config.ts
      // rewrites the generated DB binding to `../migrations` before deploy.
      const outputDirectory = resolve(root, "dist", "migrations");
      const legacyOutputDirectory = resolve(root, "dist", ".openai");
      const drizzleSource = resolve(root, "workers", "web", "migrations");

      await rm(outputDirectory, { recursive: true, force: true });
      await rm(legacyOutputDirectory, { recursive: true, force: true });
      await mkdir(outputDirectory, { recursive: true });

      if (await exists(drizzleSource)) await cp(drizzleSource, outputDirectory, { recursive: true });
    },
  };
}
