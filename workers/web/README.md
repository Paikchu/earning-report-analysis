# Web：展示与 BFF

页面位于根 `app/`、`components/`，Web 实现位于 `lib/web/`。`analysis-client.ts` 是唯一的分析服务 transport。

`wrangler.jsonc` 仅声明一个 `ANALYSIS_SERVICE`，不绑定分析数据库或 Workflow。Vinext 生成 `dist/server/wrangler.json`，`scripts/prepare-config.ts` 与 `check-config.ts` 准备、校验该配置。

Web 只保留用户侧管理鉴权，分析白名单和任务控制属于 Pipeline。参见 [架构](../../docs/service-architecture.md) 与 [部署](../../docs/deploy.md)。
