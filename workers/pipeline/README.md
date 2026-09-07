# Pipeline：财报分析微服务

`src/` 包含所有分析实现、读 API、本地写命令及 Workflow。`migrations/` 与 `src/db/` 归本服务；`drizzle.config.ts` 生成迁移。共享代码仅限 `shared/analysis-contract/` 的公开协议。

Pipeline 不导入 Web，不回调 Web。`SEC_TRACKED_TICKERS`、D1、R2、模型与工作流由自身拥有。

`wrangler.jsonc` 是源配置；正式部署先通过 `scripts/prepare-config.ts` 注入真实数据库 id 和白名单。参见 [部署文档](../../docs/deploy.md)。
