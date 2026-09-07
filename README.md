# earning-report-analysis

独立 SEC 财报分析站。前端只展示历史申报、EDGAR 原文和已经发布的 AI 解析；生成任务由 Pipeline Worker 的白名单驱动。

项目范围包括证券搜索、SEC 申报与 AI 报告、公司分析和基本面图表。`data/` 仅保留证券目录 `us-securities.json`，通过 `scripts/update-symbol-directory.ts` 更新。

历史数据库迁移保留原有顺序，包括旧业务表的清理迁移，以兼容已有数据库升级。

## 本地

```bash
npm ci
cp workers/web/.dev.vars.example workers/web/.dev.vars
cp workers/pipeline/.dev.vars.example workers/pipeline/.dev.vars
npm run db:local:apply
npm test
```

`SEC_TRACKED_TICKERS` 只放需要自动生成或回填的股票代码，例如 `MSFT,NVDA`。解析会 trim、转大写、校验、去重；任意非法值会让整次 Pipeline 任务失败，空值不生成任何公司。

生产环境中 `SEC_TRACKED_TICKERS` 只配置在 **Pipeline Worker**。Pipeline 自主采集、分析和发布；Web 通过唯一的 `ANALYSIS_SERVICE` 读取结果与发起受保护的管理命令。

## 架构与部署

- `app/`、`components/`、`lib/web/`：Web 展示、搜索与服务适配。
- `workers/pipeline/src/`：财报分析微服务，拥有 D1、R2、白名单、Cron、Workflows 及迁移。
- `shared/analysis-contract/`：薄通信协议；不包含客户端、数据库或业务实现。
- `npm run check:architecture`：检查双向代码边界及禁止回调 Web 的规则。
- [架构与后续微服务路线](docs/service-architecture.md)
- [Worker 部署入口](workers/README.md) / [首次切换与回滚](docs/deploy.md)

## API

- `GET /api/v1/search?q=MSFT`，默认只返回普通股；`types=stock,etf,fund,preferred,bond,etn` 可放开其他证券类别
- `GET /api/v1/companies/:ticker/filings?cursor=&limit=20`
- `GET /api/v1/companies/:ticker/filings/:accession`
- `GET /api/v1/companies/:ticker/fundamentals`
- `GET /api/v1/companies/:ticker/analysis`
- `POST /api/v1/admin/companies/:ticker/refresh`，`Authorization: Bearer $SEC_ADMIN_TOKEN`
- `POST /api/v1/admin/companies/:ticker/backfill`，`Authorization: Bearer $SEC_ADMIN_TOKEN`

非白名单股票只读已迁移报告；没有数据时返回空历史并显示“暂未收录”，不会触发生成。
