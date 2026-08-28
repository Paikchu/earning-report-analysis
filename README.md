# earning-report-analysis

独立 SEC 财报分析站。前端只展示历史申报、EDGAR 原文和已经发布的 AI 解析；生成任务由 Pipeline Worker 的白名单驱动。

## 本地

```bash
npm ci
cp .env.example .env
cp workers/sec-cron/.dev.vars.example workers/sec-cron/.dev.vars
npm run build
npm run db:local:apply
npm run test:sec
```

`SEC_TRACKED_TICKERS` 只放需要自动生成或回填的股票代码，例如 `MSFT,NVDA`。解析会 trim、转大写、校验、去重；任意非法值会让整次 Pipeline 任务失败，空值不生成任何公司。

## Cloudflare

- Web Worker：Vinext SSR、`/api/v1` 公开读取接口、管理接口和 D1。
- Pipeline Worker：Cron、`SecAnalysisWorkflow`、`SecMemoryWorkflow`、模型调用和 R2。两个 Worker 通过 `SEC_REFRESH_KEY` 调用短内部桥接接口。
- 两个 Worker 都使用 `nodejs_compat`。Pipeline 的 `AI_API_KEY` 只配置为 Worker Secret，不进入 Web Worker。
- `npm run web:deploy` 会检查真实 `SEC_WEB_D1_DATABASE_ID` 后部署 Web Worker；Pipeline 使用 `npm run sec-cron:deploy`。不要直接部署带占位 D1 id 的生成配置——手工调用 `wrangler deploy` 前先跑 `npm run web:check`，它会拦下占位 id、缺失的 `nodejs_compat`，以及和 Pipeline 漂移的兼容性日期。
- 完整的部署序列、密钥写入和回滚见 [`docs/deploy.md`](docs/deploy.md)。

## API

- `GET /api/v1/search?q=MSFT`
- `GET /api/v1/companies/:ticker/filings?cursor=&limit=20`
- `GET /api/v1/companies/:ticker/filings/:accession`
- `POST /api/v1/admin/companies/:ticker/refresh`，`Authorization: Bearer $SEC_ADMIN_TOKEN`
- `POST /api/v1/admin/companies/:ticker/backfill`，`Authorization: Bearer $SEC_ADMIN_TOKEN`

非白名单股票只读已迁移报告；没有数据时返回空历史并显示“暂未收录”，不会触发生成。
