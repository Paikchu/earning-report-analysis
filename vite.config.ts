import vinext from "vinext";
import { defineConfig } from "vite";

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      // There used to be a `cloudflareArtifacts()` plugin here that copied the Web Worker's D1
      // migrations into `dist/migrations`. The Web Worker has no D1 binding and no migrations any
      // more — both belong to the analysis backend — so the plugin only produced an empty
      // directory on every build, and it is gone.
      cloudflare({
        configPath: "workers/web/wrangler.jsonc",
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
      }),
    ],
  };
});
