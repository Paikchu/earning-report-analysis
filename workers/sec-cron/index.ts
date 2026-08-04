import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";

import { handleSecAnalysisRequest, runSecRefresh, type SecWorkflowParams } from "./core.ts";
import { createSecPipelineOperations, type SecPipelineEnv } from "./operations.ts";
import { executeSecAnalysisWorkflow } from "./workflow-core.ts";

type ExecutionContext = { waitUntil(promise: Promise<unknown>): void };

export class SecAnalysisWorkflow extends WorkflowEntrypoint<SecPipelineEnv, SecWorkflowParams> {
  async run(event: WorkflowEvent<SecWorkflowParams>, step: WorkflowStep) {
    return executeSecAnalysisWorkflow(event.payload, event.instanceId, step, createSecPipelineOperations(this.env));
  }
}

const worker = {
  async fetch(request: Request, env: SecPipelineEnv) {
    if (new URL(request.url).pathname === "/health") {
      return Response.json({ status: "ok", executor: "workflow", modelConfigured: Boolean(env.DEEPSEEK_API_KEY) }, { headers: { "cache-control": "no-store" } });
    }
    return handleSecAnalysisRequest(request, env);
  },

  async scheduled(_controller: unknown, env: SecPipelineEnv, context: ExecutionContext) {
    context.waitUntil(runSecRefresh(env).then((result) => console.log(JSON.stringify({ event: "sec-workflows", ...result }))));
  },
};

export default worker;
