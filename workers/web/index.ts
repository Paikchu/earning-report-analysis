/** Cloudflare Worker entry point. Static assets are served by the platform before this
 *  runs, so every request that reaches here belongs to the Vinext App Router. */
import handler from "vinext/server/app-router-entry";

interface Env {
  /** The analysis backend. Every financial read this Worker performs goes through it; there is
   *  deliberately no database binding here to fall back to. */
  PIPELINE?: { fetch: typeof fetch };
  /** Only present when the generated config declares an `assets.binding`. The App Router
   *  handler treats it as optional and serves without it. */
  ASSETS?: { fetch(request: Request): Promise<Response> | Response };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handler.fetch(request, env, ctx);
  },
};

export default worker;
