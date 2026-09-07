# Worker 部署入口

Web 与 Pipeline 独立拥有实现和部署配置，共用根 `package.json`。Cloudflare Builds 的 Root directory 均为 `/`。

| 服务 | 源配置 | Build | Deploy |
| --- | --- | --- | --- |
| Web | `workers/web/wrangler.jsonc` | `npm run build` | `npm run worker:web:deploy:built` |
| Pipeline | `workers/pipeline/wrangler.jsonc` | `npm run worker:pipeline:check` | `npm run worker:pipeline:deploy` |

非生产版本上传分别用 `worker:web:version:built` / `worker:pipeline:version`。这些命令显式选择配置，避免 Wrangler 自动发现到另一服务的构建产物。

Web watch paths：`app/*`、`components/*`、`lib/web/*`、`data/*`、`public/*`、`workers/web/*`、`shared/analysis-contract/*`、Vite/Next/PostCSS/TS 配置与根 package/lock。

Pipeline watch paths：`workers/pipeline/*`、`shared/analysis-contract/*`、根 TS 配置与 package/lock。Pipeline 内部改动不需要重建 Web。

Pipeline 拥有分析 D1、迁移、白名单、R2、Cron 和三条 Workflow；Web 只使用一个分析服务 binding。配置变量与首次切换步骤见 [部署文档](../docs/deploy.md)，后续微服务路线见 [架构文档](../docs/service-architecture.md)。
