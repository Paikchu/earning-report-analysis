import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";

import { handleSecAnalysisRequest, runSecMemorySweep, runSecRefresh, type CompanyAnalysisWorkflowParams, type SecMemoryWorkflowParams, type SecWorkflowParams } from "./core.ts";
import { executeCompanyAnalysisWorkflow } from "./company-analysis-workflow.ts";
import { executeSecMemoryWorkflow } from "./memory-workflow.ts";
import { createSecPipelineOperations, type SecPipelineEnv } from "./operations.ts";
import { retryDelayForAttempt } from "./retry-policy.ts";
import { executeSecAnalysisWorkflow, type WorkflowStepContextLike, type WorkflowStepLike } from "./workflow-core.ts";

const WORKFLOW_RETRY = {
  retries: {
    limit: 3,
    delay: ({ ctx }: { ctx: WorkflowStepContextLike }) => retryDelayForAttempt(ctx.attempt),
  },
  timeout: "5 minutes",
};

function durableSteps(step: WorkflowStep): WorkflowStepLike {
  const dynamicStep = step as unknown as {
    do<T>(name: string, config: typeof WORKFLOW_RETRY, callback: (context?: WorkflowStepContextLike) => Promise<T>): Promise<T>;
  };
  return {
    do<T>(name: string, callback: (context?: WorkflowStepContextLike) => Promise<T>): Promise<T> {
      return dynamicStep.do(name, WORKFLOW_RETRY, callback);
    },
  };
}

export class SecAnalysisWorkflow extends WorkflowEntrypoint<SecPipelineEnv, SecWorkflowParams> {
  async run(event: WorkflowEvent<SecWorkflowParams>, step: WorkflowStep) {
    return executeSecAnalysisWorkflow(event.payload, event.instanceId, durableSteps(step), createSecPipelineOperations(this.env));
  }
}

export class SecMemoryWorkflow extends WorkflowEntrypoint<SecPipelineEnv, SecMemoryWorkflowParams> {
  async run(event: WorkflowEvent<SecMemoryWorkflowParams>, step: WorkflowStep) {
    return executeSecMemoryWorkflow(event.payload, event.instanceId, durableSteps(step), this.env);
  }
}

export class CompanyAnalysisWorkflow extends WorkflowEntrypoint<SecPipelineEnv, CompanyAnalysisWorkflowParams> {
  async run(event: WorkflowEvent<CompanyAnalysisWorkflowParams>, step: WorkflowStep) {
    return executeCompanyAnalysisWorkflow(
      event.payload,
      event.instanceId,
      event.timestamp,
      step,
      this.env,
    );
  }
}

/**
 * `JSON.stringify` renders an Error as `{}`, so a rejection reason has to be read off it before it
 * reaches the log. The old handler logged the raw settled results and every failure it did report
 * arrived as `"reason":{}` — the one line meant to explain a broken run explained nothing.
 */
function describeSettled(result: PromiseSettledResult<unknown>) {
  return result.status === "fulfilled"
    ? { status: result.status, value: result.value }
    : { status: result.status, reason: result.reason instanceof Error ? result.reason.message : String(result.reason) };
}

const worker = {
  async fetch(request: Request, env: SecPipelineEnv) {
    if (new URL(request.url).pathname === "/health") {
      return Response.json({ status: "ok", executor: "workflow", modelConfigured: Boolean(env.AI_API_KEY), watchlistConfigured: Boolean(env.WEB_APP_ORIGIN?.trim() && env.SEC_REFRESH_KEY?.trim()) }, { headers: { "cache-control": "no-store" } });
    }
    return handleSecAnalysisRequest(request, env);
  },

  async scheduled(_controller: ScheduledController, env: SecPipelineEnv) {
    const results = await Promise.allSettled([runSecRefresh(env), runSecMemorySweep(env)]);
    const [analysis, memory] = results.map(describeSettled);
    const payload = JSON.stringify({ event: "sec-workflows", analysis, memory });
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    if (!rejected.length) {
      console.log(payload);
      return;
    }
    /**
     * `allSettled` never rejects, so a broken run used to finish as `outcome: ok` with nothing but
     * this one log line to show for it — the whole refresh sat dead for days behind that. The work
     * is awaited rather than handed to `waitUntil` so a rethrow lands on the invocation record,
     * which is the only part of a Cron run anything can alert on.
     */
    console.error(payload);
    throw new AggregateError(rejected.map((result) => result.reason), "SEC scheduled run failed");
  },
} satisfies ExportedHandler<SecPipelineEnv>;

export default worker;
