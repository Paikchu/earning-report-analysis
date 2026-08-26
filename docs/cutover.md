# Cloudflare 切换门禁

## Web Worker

```bash
export SEC_WEB_D1_DATABASE_ID="<new-d1-id>"
export SEC_WEB_D1_DATABASE_NAME="earning-report-analysis-sec-web"
export SEC_WEB_WORKER_NAME="earning-report-analysis-sec-web"
export SEC_PIPELINE_ORIGIN="https://earning-report-analysis-sec-pipeline.<subdomain>.workers.dev"
export SEC_TRACKED_TICKERS="MSFT,NVDA"
npm run build
npm run web:prepare
npx wrangler d1 migrations apply "$SEC_WEB_D1_DATABASE_NAME" --remote --config dist/server/wrangler.json
npx wrangler deploy --config dist/server/wrangler.json --keep-vars
```

`web:deploy` 会重新构建 Vinext、检查并替换生成配置中的占位 D1 id，写入 `nodejs_compat` 和公开 Pipeline origin。密钥单独写入 Web Worker：

```bash
printf %s "$SEC_ADMIN_TOKEN" | npx wrangler secret put SEC_ADMIN_TOKEN --config dist/server/wrangler.json
printf %s "$SEC_REFRESH_KEY" | npx wrangler secret put SEC_REFRESH_KEY --config dist/server/wrangler.json
printf %s "$SEC_MIGRATION_KEY" | npx wrangler secret put SEC_MIGRATION_KEY --config dist/server/wrangler.json
```

## Pipeline Worker

先部署关闭 Cron 的 staging（独立 Worker、Workflow 和 R2）：

```bash
npx wrangler deploy --config workers/sec-cron/wrangler.jsonc --env staging --keep-vars
printf %s "$SEC_REFRESH_KEY" | npx wrangler secret put SEC_REFRESH_KEY --config workers/sec-cron/wrangler.jsonc --env staging
printf %s "$AI_API_KEY" | npx wrangler secret put AI_API_KEY --config workers/sec-cron/wrangler.jsonc --env staging
```

staging 的 Cron 列表为空，只允许通过显式 POST canary。确认 D1 对账和 R2 manifest 一致后，在生产部署时手动写入白名单变量：

```bash
export SEC_TRACKED_TICKERS="MSFT,NVDA"
npx wrangler deploy --config workers/sec-cron/wrangler.jsonc --env="" --keep-vars --var "SEC_TRACKED_TICKERS:${SEC_TRACKED_TICKERS}"
```

`SEC_TRACKED_TICKERS` 只在 Pipeline Worker 环境变量中维护；变更后重新部署并观察 `/health` 的配置状态。

## 双站读取契约

旧 MAX 站的 SEC 列表和报告详情必须改为请求新 Web Worker 的 `/api/v1/companies/:ticker/filings` 和 `/api/v1/companies/:ticker/filings/:accession`，不再写旧 D1。旧站保留最后冻结快照，旧 Cron、内部写入路由和双写逻辑全部停用。

## 回滚

关闭 Pipeline Cron，恢复旧 MAX 站的冻结读取源；新 D1/R2 保留以便重放。重新切换前必须重复全量行数、主键和 SHA-256 对账。
