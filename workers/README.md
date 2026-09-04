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

Web 不再持有白名单——它对 D1 里的分析数据只读，`SEC_TRACKED_TICKERS` 只配在 Pipeline
上，见下方 Pipeline Worker 一节。

### Pipeline Worker

```text
Root directory: /
Build command: npm run worker:pipeline:check
Deploy command: npm run worker:pipeline:deploy
Non-production branch deploy command: npm run worker:pipeline:version
```

Pipeline 不需要 Build variables：它直接从 committed 的 `wrangler.jsonc` 部署，D1 id 就写在里面
（account 内的标识符，不是凭据，和同一份配置里的 bucket 名、Worker 名同级）。

Pipeline 的 `SEC_REFRESH_KEY`、`AI_API_KEY`、`SEC_TRACKED_TICKERS` 都是 Worker runtime
secrets/vars，不是 Build variables，直接在 Dashboard 或用 `wrangler secret put` 配置。
`SEC_TRACKED_TICKERS` 就是白名单——Pipeline 自己决定分析谁，不问 Web 要这份名单，改一个
股票代码只需要改这一个值，不需要重新部署。生产部署命令使用 `--keep-vars`，避免覆盖
Dashboard 中现有 runtime vars/secrets。

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
workers/web/migrations/*
workers/web/scripts/check-migrations.ts
tsconfig.json
package.json
package-lock.json
```

Pipeline 也监听 migrations 目录：它绑定 D1 之后，部署前要跑同一套 migration 门禁，构建里带的
migration 列表必须跟 Web 一致。

详细的密钥、迁移、staging 与回滚顺序见 [`../docs/deploy.md`](../docs/deploy.md)。
