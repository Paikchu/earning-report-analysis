# Cloudflare Workers

这个目录是仓库内唯一的 Cloudflare Worker 部署入口索引。两个 Worker 是独立的
Cloudflare 项目，但共享根目录的 `package.json` 与 `lib/`，所以 Cloudflare Builds 的
Root directory 都设置为 `/`；不要让 Wrangler 自动猜测配置文件。

| Cloudflare Worker | 仓库目录 | 源配置 | 生产部署命令 |
| --- | --- | --- | --- |
| `earning-report-analysis-sec-web` | [`web/`](web/) | `workers/web/wrangler.jsonc` | `npm run worker:web:deploy:built` |
| `earning-report-analysis-sec-pipeline` | [`pipeline/`](pipeline/) | `workers/pipeline/wrangler.jsonc` | `npm run worker:pipeline:deploy` |

## Cloudflare Dashboard

两个 Cloudflare Worker 分别连接同一个 GitHub repository，并使用下面的配置。

### Web Worker

```text
Root directory: /
Build command: npm run build
Deploy command: npm run worker:web:deploy:built
Non-production branch deploy command: npm run worker:web:version:built
```

Build variables 至少配置：

- `SEC_WEB_D1_DATABASE_ID`：Web Worker 使用的真实 D1 database id。
- `SEC_WEB_D1_DATABASE_NAME`：建议为 `earning-report-analysis-sec-web`。
- `SEC_WEB_WORKER_NAME`：`earning-report-analysis-sec-web`。
- `SEC_PIPELINE_ORIGIN`：Pipeline Worker 的生产 URL。
- `SEC_TRACKED_TICKERS`：需要生成报告的股票白名单。

### Pipeline Worker

```text
Root directory: /
Build command: npm run worker:pipeline:check
Deploy command: npm run worker:pipeline:deploy
Non-production branch deploy command: npm run worker:pipeline:version
```

Pipeline 的 `SEC_REFRESH_KEY` 与 `AI_API_KEY` 是 Worker runtime secrets，不是 Build
variables。生产部署命令使用 `--keep-vars`，避免覆盖 Dashboard 中现有 runtime vars。

## Build watch paths

两个 Worker 都会使用 `lib/` 和根依赖；共享路径有改动时必须同时构建。

Web Worker：

```text
app/*
components/*
data/*
db/*
lib/*
public/*
workers/web/*
next.config.ts
postcss.config.mjs
tsconfig.json
vite.config.ts
package.json
package-lock.json
```

Pipeline Worker：

```text
lib/*
workers/pipeline/*
tsconfig.json
package.json
package-lock.json
```

详细的密钥、迁移、staging 与回滚顺序见 [`../docs/deploy.md`](../docs/deploy.md)。
