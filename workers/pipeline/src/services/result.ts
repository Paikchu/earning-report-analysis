import type { AnalysisDataEnv } from "./types.ts";
/** Local application command; never traverses a Worker or HTTP boundary. */
export async function runCommand<T = Record<string, unknown>>(command: (input: unknown, env: AnalysisDataEnv) => Promise<Response>, env: AnalysisDataEnv, input: unknown): Promise<T> {
  const response = await command(input, env);
  if (!response.ok) throw new Error(`Analysis command failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
  return response.json() as Promise<T>;
}
