/** Vinext bakes this D1 id into the generated deploy config. `scripts/prepare-web-worker.ts`
 *  replaces it with the real one before deployment, and `scripts/check-web-worker-config.ts`
 *  refuses any config that still carries it. */
export const PLACEHOLDER_D1_DATABASE_ID = "00000000-0000-4000-8000-000000000000";

/** Where `vinext build` writes the Web Worker's Wrangler config. */
export const WEB_WORKER_CONFIG_PATH = "dist/server/wrangler.json";
