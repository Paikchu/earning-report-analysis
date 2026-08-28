/// <reference types="@cloudflare/workers-types" />

/** `workers/sec-cron/worker-configuration.d.ts` contributes the Pipeline Worker's bindings to
 *  the shared ambient `Cloudflare.Env`. The Web Worker deploys separately with its own config,
 *  so its D1 binding is declared here — `db/index.ts` reads `env.DB` through it. */
declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
  }
}
