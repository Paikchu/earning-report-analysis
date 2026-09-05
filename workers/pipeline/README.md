# Pipeline Worker

Cloudflare Worker：`earning-report-analysis-sec-pipeline`

这个目录包含 Pipeline Worker 的完整部署单元：

- `wrangler.jsonc`：Worker、D1、两个 Workflows、R2、Cron、staging 与 observability。
  受版本控制、直接部署，没有生成步骤——D1 id 是 account 内的标识符，和同一份配置里的
  bucket 名、Worker 名一样可以提交。
- `index.ts`：HTTP、Cron 与 Workflow entrypoints。
- `core.ts` / `operations.ts` / `workflow-core.ts` / `memory-workflow.ts` /
  `company-analysis-workflow.ts` / `fundamentals.ts`：任务编排与 D1 读写。这个 Worker
  直接持有白名单（`SEC_TRACKED_TICKERS` runtime var）并直接读写 D1——它不问 Web 要任何
  东西，`wrangler.jsonc` 里也没有指向 Web 的绑定。
- `worker-configuration.d.ts`：由 Pipeline Wrangler config 生成的 bindings type。
- `.dev.vars.example`：本地 secret 模板；真实 `.dev.vars` 不进入 Git。

Pipeline 会引用仓库根目录的共享 `lib/`，因此 Cloudflare Builds 的 Root directory 仍为
`/`。部署和非生产版本上传都必须显式使用 `workers/pipeline/wrangler.jsonc`。
