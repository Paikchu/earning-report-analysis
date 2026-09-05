# earning-report-analysis

独立 SEC 财报分析站。前端只展示历史申报、EDGAR 原文和已经发布的 AI 解析；生成任务由 Pipeline Worker 的白名单驱动。

## 本地

```bash
npm ci
cp workers/web/.dev.vars.example workers/web/.dev.vars
cp workers/pipeline/.dev.vars.example workers/pipeline/.dev.vars
npm run build
npm run db:local:apply
npm run test:sec
```

`SEC_TRACKED_TICKERS` 只放需要自动生成或回填的股票代码，例如 `MSFT,NVDA`。解析会 trim、转大写、校验、去重；任意非法值会让整次 Pipeline 任务失败，空值不生成任何公司。

生产环境里这个变量**只配置在 Pipeline Worker 上**，作为 runtime var/secret，不进代码也不进
`wrangler.jsonc`。Pipeline 自己决定分析谁；Web 不再持有、也不再校验白名单。改白名单不需要
部署任何一个 Worker，直接在 Cloudflare Dashboard 改这一个值即可。

## Cloudflare

- Worker 总入口见 [`workers/README.md`](workers/README.md)。Web 与 Pipeline 都使用仓库根依赖，但部署命令始终显式选择各自配置。
- Web Worker（[`workers/web/`](workers/web/)）：Vinext SSR、`/api/v1` 公开读取接口、管理接口，对 D1 严格只读——它只服务已经写好的分析数据，不生成任何东西。
- Pipeline Worker（[`workers/pipeline/`](workers/pipeline/)）：Cron、`SecAnalysisWorkflow`、`SecMemoryWorkflow`、模型调用、R2，以及 D1 的全部写入。它直接读写同一个 D1 数据库，不经过 Web 转手。
- 依赖只朝一个方向：Web 可以调 Pipeline（管理员触发分析/回填、按需刷新基本面，都走 `SEC_REFRESH_KEY` 签名的控制面请求），Pipeline 配置里没有任何指向 Web 的绑定或地址，物理上调不回去。
- 两个 Worker 都使用 `nodejs_compat`。Pipeline 的 `AI_API_KEY` 只配置为 Worker Secret，不进入 Web Worker。
- `npm run web:deploy` 会检查真实 `SEC_WEB_D1_DATABASE_ID` 后部署 Web Worker；Pipeline 使用 `npm run worker:pipeline:deploy`。不要直接部署带占位 D1 id 的生成配置——手工调用 `wrangler deploy` 前先跑 `npm run worker:web:check`，它会拦下占位 id、缺失的 `nodejs_compat`，以及和 Pipeline 漂移的兼容性日期；再跑 `npm run worker:web:check:migrations`，它会拒绝把本次构建的 migration 还没 apply 的 D1 当作部署目标。
- 完整的部署序列、密钥写入和回滚见 [`docs/deploy.md`](docs/deploy.md)。

## API

- `GET /api/v1/search?q=MSFT`，默认只返回普通股；`types=stock,etf,fund,preferred,bond,etn` 可放开其他证券类别
- `GET /api/v1/companies/:ticker/filings?cursor=&limit=20`
- `GET /api/v1/companies/:ticker/filings/:accession`
- `POST /api/v1/admin/companies/:ticker/refresh`，`Authorization: Bearer $SEC_ADMIN_TOKEN`
- `POST /api/v1/admin/companies/:ticker/backfill`，`Authorization: Bearer $SEC_ADMIN_TOKEN`

非白名单股票只读已迁移报告；没有数据时返回空历史并显示“暂未收录”，不会触发生成。
