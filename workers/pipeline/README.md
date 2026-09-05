# Pipeline Worker — the analysis backend

Cloudflare Worker：`earning-report-analysis-sec-pipeline`

这个 Worker 是**财务分析后端**：它拥有分析数据模型、migrations、Workflows、Cron，以及对外
的只读结果 API。Web Worker 是它的一个客户端，其他服务可以通过 HTTPS 成为另一个客户端。
"分析后端"是职责名称，不是重命名——Worker 名、Workflow 名、D1 名、bucket 名都没有变。

架构决策、完整 API 契约、凭据流程与上线/回滚手册见
[`../../docs/analysis-backend.md`](../../docs/analysis-backend.md)。

## 目录内容

- `wrangler.jsonc`：Worker、D1（含 `migrations_dir`）、四个 Workflows、R2、rate limit、Cron、
  staging 与 observability。受版本控制、直接部署，没有生成步骤——D1 id 是 account 内的标识符，
  和同一份配置里的 bucket 名、Worker 名一样可以提交。
- `migrations/`：分析数据模型的 migrations，连同 Drizzle 的 `meta/_journal.json`。它们从
  `workers/web/migrations/` 迁移到这里，**文件名和内容逐字节未变**——Wrangler 按文件名记录已
  应用的 migration，所以已经迁移过的数据库不会重跑任何一条。用 `npm run db:generate` 生成新的。
- `index.ts`：Workflow entrypoints，并把 `worker.ts` 作为 default export 交给 Wrangler。
- `worker.ts`：`fetch` 路由（只读 API / 控制面 / `/health` / `/ready`）与 Cron handler。
  它不 import `cloudflare:workers`，所以可以在 Node 里直接测试。
- `read-api/`：只读 API——`router.ts`（路由、校验、缓存、错误映射）与 `auth.ts`（读凭据）。
  Service Binding 与公网 HTTPS 走的是同一份 handler；传输方式不构成任何身份证明。
- `core.ts` / `operations.ts` / `workflow-core.ts` / `memory-workflow.ts` /
  `company-analysis-workflow.ts` / `fundamentals.ts` / `fundamentals-sweep.ts`：任务编排与
  D1 读写。白名单（`SEC_TRACKED_TICKERS` runtime var）只住在这里。
- `scripts/check-migrations.ts`：部署前向远端 D1 确认这份构建带的 migration 全部 apply 过。
- `worker-configuration.d.ts`：由 Pipeline Wrangler config 生成的 bindings type。
- `.dev.vars.example`：本地 secret 模板；真实 `.dev.vars` 不进入 Git。

## 只读 API

```text
GET /api/v1/companies/:ticker/filings              scope filings:read
GET /api/v1/companies/:ticker/filings/:accession   scope filings:read
GET /api/v1/companies/:ticker/analysis             scope analysis:read
GET /api/v1/companies/:ticker/fundamentals         scope fundamentals:read
GET /api/v1/openapi.json                           公开
GET /health                                        存活探针
GET /ready                                         依赖就绪探针
```

**读取路径绝不写入**：不调模型、不抓 SEC/Yahoo、不起 Workflow、不排刷新、不写业务数据。
认证用 `Authorization: Bearer <keyId>.<secret>`，凭据来自 `ANALYSIS_READ_KEYS` runtime
secret；没配置就**全部拒绝**（503），不会退化成开放访问。读凭据永远无法触发 refresh /
backfill —— 那些仍然只认 `SEC_REFRESH_KEY`。

Pipeline 会引用仓库根目录的共享 `lib/`，因此 Cloudflare Builds 的 Root directory 仍为
`/`。部署和非生产版本上传都必须显式使用 `workers/pipeline/wrangler.jsonc`。
