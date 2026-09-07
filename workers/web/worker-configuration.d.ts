/// <reference types="@cloudflare/workers-types" />

/** `workers/pipeline/worker-configuration.d.ts` contributes the Pipeline Worker's bindings to the
 *  shared ambient `Cloudflare.Env`. The Web Worker deploys separately with its own config and has
 *  **no analysis-storage binding at all** — it reads through the Pipeline Worker's read API — so
 *  nothing is declared here. A `DB: D1Database` used to live in this namespace; leaving it would
 *  let a future edit write `env.DB` in Web and still typecheck, which is exactly the boundary
 *  `tests/analysis-boundary.test.ts` exists to hold. */
export {};
