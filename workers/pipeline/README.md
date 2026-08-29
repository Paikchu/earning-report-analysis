# Pipeline Worker

Cloudflare Worker：`earning-report-analysis-sec-pipeline`

这个目录包含 Pipeline Worker 的完整部署单元：

- `wrangler.jsonc`：Worker、两个 Workflows、R2、Cron、staging 与 observability。
- `index.ts`：HTTP、Cron 与 Workflow entrypoints。
- `core.ts` / `operations.ts` / `workflow-core.ts` / `memory-workflow.ts`：任务编排。
- `worker-configuration.d.ts`：由 Pipeline Wrangler config 生成的 bindings type。
- `.dev.vars.example`：本地 secret 模板；真实 `.dev.vars` 不进入 Git。

Pipeline 会引用仓库根目录的共享 `lib/`，因此 Cloudflare Builds 的 Root directory 仍为
`/`。部署和非生产版本上传都必须显式使用 `workers/pipeline/wrangler.jsonc`。
