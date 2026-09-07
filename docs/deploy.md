# 部署与所有权切换

架构见 [service-architecture.md](service-architecture.md)。本次目录迁移不自动创建数据库，不复制数据，也不执行线上部署。

## 本地开发

```bash
npm ci
cp workers/web/.dev.vars.example workers/web/.dev.vars
cp workers/pipeline/.dev.vars.example workers/pipeline/.dev.vars
npm run db:local:apply
npm run worker:pipeline:dev
# 另一个终端
npm run dev
```

两个本地进程通过 `ANALYSIS_SERVICE` 连接；两个 `.dev.vars` 的 `SEC_REFRESH_KEY` 必须一致。Pipeline 的 `SEC_TRACKED_TICKERS` 只填写测试需要的代码。基础面 API 仅对白名单缺失或过期数据发起后台同步。

## Pipeline

`workers/pipeline/wrangler.jsonc` 是部署源。源配置的 D1 id 是占位值，dry-run 可以使用；正式部署脚本先生成 `.wrangler/deploy/pipeline.json`（staging 为 `pipeline-staging.json`）。入口、schema 和迁移路径转为绝对路径，避免临时配置目录改变解析结果。

生产构建变量：

- `SEC_PIPELINE_D1_DATABASE_ID`：**现有分析 D1 的真实 id**。本次不改数据库内容或名称。
- `SEC_TRACKED_TICKERS`：从旧 Web runtime 迁移的实际白名单。准备脚本拒绝缺失配置。
- staging 使用独立的 `SEC_PIPELINE_STAGING_D1_DATABASE_ID`，禁止指向生产数据库。

Runtime secrets：`SEC_REFRESH_KEY`、`AI_API_KEY`。如使用 `SEC_REASONING_MODEL`，仍由 Pipeline 管理。

```bash
npm run worker:pipeline:check
npm run worker:pipeline:prepare
# 只有确实需要补齐数据库迁移时执行；不会由 deploy 自动运行
npx wrangler d1 migrations apply earning-report-analysis-sec-web --remote --config .wrangler/deploy/pipeline.json
npm run worker:pipeline:deploy
```

Staging：`npm run worker:pipeline:deploy:staging`，自有 D1、R2、Workflows，Cron 默认关闭。`worker:pipeline:version[:staging]` 只上传版本，不等于上线。

## Web

构建：`npm run build`。部署：`npm run web:deploy`。已有构建可用 `npm run worker:web:deploy:built`。

Web 不再需要 `SEC_WEB_D1_DATABASE_ID`、分析 migrations 或白名单。`worker:web:prepare` 配置唯一的 `ANALYSIS_SERVICE`，`worker:web:check` 拒绝意外的 D1 binding。

- 可选 Build variable：`SEC_WEB_WORKER_NAME`，默认生产 Web 名称。
- 可选 Build variable：`SEC_PIPELINE_WORKER_NAME`，默认生产 Pipeline 名称。staging Web 必须设为 `earning-report-analysis-sec-pipeline-staging`。
- Runtime secrets：`SEC_REFRESH_KEY` 与所指向的 Pipeline 一致；`SEC_ADMIN_TOKEN` 只属于 Web。
- `SEC_PIPELINE_ORIGIN` 仅供显式无 binding 的客户端环境使用；配置了 binding 时优先 binding，不在故障时悄悄切换公共 HTTP。

Web 与 Pipeline 的兼容性日期各自管理，不再强制同步。

## 首次生产切换顺序

1. 在 staging 完成同一提交的两端验证；确认 D1 id、R2 和服务 binding 均指向 staging。
2. 临时暂停旧 Pipeline Cron/手动生成入口，等待正在运行的三个 Workflow 排空，备份现有 D1。旧 Workflow 的持久步骤可能缓存 Web 桥接结果，不应在本次边界变更时强行穿插升级。
3. 将白名单和分析 D1 id 配置到 Pipeline，保持旧 `SEC_REFRESH_KEY`。先部署 Pipeline；它直接使用现有数据库，不再请求 Web。旧 Web 此时仍能读原有数据，原 `/jobs` 和 `/backfill` 兼容入口仍可处理旧版手动请求。
4. 部署 Web，确认它仅有 `ANALYSIS_SERVICE`，移除旧 Web Dashboard 上的 `SEC_TRACKED_TICKERS`、D1 配置和 `SEC_PIPELINE_ORIGIN`。不要从其他用途的服务中删除无关配置。
5. 检查证券搜索、披露分页、财报详情 SSR、公司分析、基本面图表；验证未授权刷新被拒绝、白名单刷新返回 202。用一家公司验证 report → Memory → company analysis 的完整执行，并确认 Pipeline 没有 Web 出站请求，再恢复日常调度。

本次保留历史迁移文件名和顺序，已应用迁移无需重跑。数据库名 `earning-report-analysis-sec-web` 可继续使用，实际所有者由 binding 决定。不要为了名称整洁创建空库或导入旧 JSON 覆盖生产数据。

## 回滚

回滚需要成对处理：先恢复旧 Web 版本及其 DB、白名单和桥接路由，再恢复旧 Pipeline 版本（含 `WEB_APP_ORIGIN`），最后恢复调度。数据库没有本次新增或破坏性 schema 迁移，因此不需要反向数据迁移；不要回滚或重放早期清理旧业务表的历史 SQL。
