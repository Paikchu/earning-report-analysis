# 部署

两个 Worker 独立部署。密钥用 `wrangler secret put` 单独写入，不进代码也不进 vars。

## Web Worker

部署配置由 `vinext build` 生成，不在仓库里。`web:prepare` 负责改名并填入真实 D1 id，`web:check` 会拦下占位 id、缺失的 `nodejs_compat`，以及和 Pipeline 漂移的兼容性日期。

```bash
export SEC_WEB_D1_DATABASE_ID="<real-d1-id>"
export SEC_WEB_D1_DATABASE_NAME="earning-report-analysis-sec-web"
export SEC_WEB_WORKER_NAME="earning-report-analysis-sec-web"
export SEC_PIPELINE_ORIGIN="https://earning-report-analysis-sec-pipeline.<subdomain>.workers.dev"
npm run web:deploy
```

`web:deploy` 等价于 build → `web:prepare` → `web:check` → `wrangler deploy --keep-vars`。需要手工分步（例如先跑 D1 迁移）时：

```bash
npm run build
npm run web:prepare
npm run web:check
npx wrangler d1 migrations apply "$SEC_WEB_D1_DATABASE_NAME" --remote --config dist/server/wrangler.json
npx wrangler deploy --config dist/server/wrangler.json --keep-vars
```

绕过 `web:deploy` 直接 `wrangler deploy` 之前一定要跑 `web:check`——生成配置里的 D1 id 默认是占位值。

密钥：

```bash
printf %s "$SEC_ADMIN_TOKEN" | npx wrangler secret put SEC_ADMIN_TOKEN --config dist/server/wrangler.json
printf %s "$SEC_REFRESH_KEY" | npx wrangler secret put SEC_REFRESH_KEY --config dist/server/wrangler.json
```

## Pipeline Worker

先部署关闭 Cron 的 staging（独立 Worker、Workflow 和 R2）：

```bash
npx wrangler deploy --config workers/sec-cron/wrangler.jsonc --env staging --keep-vars
printf %s "$SEC_REFRESH_KEY" | npx wrangler secret put SEC_REFRESH_KEY --config workers/sec-cron/wrangler.jsonc --env staging
printf %s "$AI_API_KEY" | npx wrangler secret put AI_API_KEY --config workers/sec-cron/wrangler.jsonc --env staging
```

staging 的 Cron 列表为空，只能通过显式 POST 打 canary。生产部署时手动写入白名单：

```bash
export SEC_TRACKED_TICKERS="MSFT,NVDA"
npx wrangler deploy --config workers/sec-cron/wrangler.jsonc --env="" --keep-vars --var "SEC_TRACKED_TICKERS:${SEC_TRACKED_TICKERS}"
```

`SEC_TRACKED_TICKERS` 只在 Pipeline Worker 的环境变量里维护；变更后重新部署，并观察 `/health` 返回的配置状态。

`npm run sec-cron:check` 是不落地的干跑，可以在部署前确认绑定解析正确。

## 回滚

两个 Worker 都用版本回滚，不重新构建：

```bash
npx wrangler rollback <version-id> --config dist/server/wrangler.json          # Web
npx wrangler rollback <version-id> --config workers/sec-cron/wrangler.jsonc    # Pipeline
```

Web Worker 的回滚依赖本地 `dist/`（构建产物，已 gitignore）。重新构建后需要先跑 `web:prepare` 填回真实 D1 id，配置才指向正确的库。

已发布的报告不随 Worker 回滚改变——它们在 D1 里，只有跨过门禁的分析才会写入。
