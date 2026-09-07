# 服务架构与演进路线

## 当前实现

Web 是展示层与 BFF（浏览器的服务端入口），Pipeline 是独立的财报分析服务。两者共享根依赖管理，但不共享业务实现。根目录 `app/` 保留 Vinext 的框架约定，避免同时迁移构建根目录。

```mermaid
flowchart LR
  Browser[浏览器] --> Web[Web · SSR / 搜索 / 页面 / 管理鉴权]
  Web -->|一个 ANALYSIS_SERVICE HTTP binding| Pipeline[Pipeline · 版本化分析 API]
  Web -.类型.-> Contract[shared/analysis-contract]
  Pipeline -.类型.-> Contract
  Cron[Cron] --> Pipeline
  Pipeline --> WF[SEC / Memory / Company Analysis Workflows]
  WF --> DB[(Pipeline D1)]
  WF --> R2[(Pipeline R2)]
  WF --> Sources[SEC / Yahoo / AI]
  Pipeline --> DB
  Web -.未来独立适配器.-> Other[其他微服务]
```

```text
app/、components/                  Web 页面、交互和薄 API 路由
lib/web/                          Web 数据适配、图表、证券搜索、analysis-client
shared/analysis-contract/         公开 DTO、错误与 API 版本；无网络、数据库或业务实现
workers/web/                     Web 配置与部署脚本
workers/pipeline/
  src/
    sec/                         SEC 采集、分析、Memory、repository
    fundamentals/                Yahoo 数据获取、规范化、repository、读模型
    company-analysis/            输入 packet、指标计算、分析与发布
    services/                    Pipeline 本地持久化命令与校验
    db/                          Pipeline 数据模型
    read-api.ts                  版本化服务入口
    *workflow*.ts                三条持久化 Workflow
  migrations/                    完整历史迁移链
  scripts/                       Pipeline 部署配置准备
  wrangler.jsonc
```

## 必须保持的边界

- Pipeline 只能依赖自身、分析契约和第三方库；不能 import Web、证券搜索目录或根 `lib/`，不能回调 Web。
- Web 不能 import Pipeline，包括 `import type`；不能绑定分析 D1、R2 或 Workflow。
- Web 的 `lib/web/analysis-client.ts` 集中处理 service binding、可选 HTTP transport、凭证、超时、响应转发与服务失败。页面与 API 不知道 Pipeline 的内部类或存储结构。
- `SEC_TRACKED_TICKERS` 是 Pipeline 的采集策略。Cron、手动刷新、回填及后台基本面刷新使用同一个所有者；非白名单仍可读取已有数据。Web 不维护白名单副本。
- 本地 commands 是 Pipeline 内部的函数调用；HTTP 不暴露 feed/context/jobs/publish/memory/packet 等写入命令。模型调用不经过 Web。
- 各服务拥有自己的数据库、迁移、定时任务和部署配置。生产分析数据库原名仍可包含 `sec-web`，资源名不等于所有权；Web 配置已移除 DB binding。

`npm run check:architecture` 检查所有生产 TS 文件的 import、re-export、动态 import 和类型 import。契约禁止函数、类、网络实现与平台存储类型。`npm run lint`、`npm test` 都会运行边界门禁。

## 契约与调用粒度

当前契约只有四个文件：`filings.ts`、`fundamentals.ts`、`company-analysis.ts`、`version.ts`。公开的已发布报告结构本身有一定复杂度，保留页面需要的证据与质量说明；不把数据库行、Memory lease、Manager plan/repair state、Workflow 参数塞入契约。客户端属于 Web。

Web 的公开路径保留：证券搜索由 Web 提供，filings、filing detail、fundamentals、analysis 和两个管理命令转发 Pipeline 的 `/api/v1`。浏览器只访问 Web 同源地址。报告详情的 SSR 也使用同一个客户端，不向 Web 自己发 HTTP 请求。

Pipeline 请求使用 `x-sec-refresh-key` 认证；Web 管理路由先校验独立的 `SEC_ADMIN_TOKEN`，再通过服务端凭证调用 Pipeline。API 路径、超时与凭证细节只存在客户端中。仅为已有调用方兼容，Pipeline 保留已认证的 `/jobs/:ticker` 与 `/backfill/:ticker` 别名。

本次公开 SEC summary 不再透出 `plan`、`managerReview`，页面未使用这两个内部字段；`nodes`、正文、指标、已发布报告的质量说明仍保留。若有仓库外客户端使用了上述内部字段，应在切换前改为使用公开报告质量字段。

一个 binding 已是两个 Worker 私有通信的最小数量。没有必要为 SEC、Memory、基本面和公司分析各建一个 binding，也不需要为三个并行加载的页面区域立刻加聚合层。未来有测量证据表明首屏往返成为瓶颈，再增加页面级只读快照端点；不要让 Web 编排后端分析步骤。

## 后续路线

| 阶段 | 触发条件 | 动作 | 完成标准 |
| --- | --- | --- | --- |
| 1：当前代码边界 | 本次迁移 | 后端代码、D1、白名单和写命令归 Pipeline；一个 Web 客户端 | 边界检查、DB 回归、Web build、Pipeline dry-run 通过 |
| 2：生产切换 | 准备发布本次变更 | 按部署文档切换 D1 所有者和凭证；验证脱离 Web 的完整分析 | Web 离线时 Cron → 报告 → Memory → 公司分析正常；前端读取成功 |
| 3：新增服务 | 第一个其他微服务有明确业务需求 | 新建 `workers/<service>/src`、自有存储和契约；Web 新增专属 adapter 与一个 binding | 新服务无需读取 Pipeline/Web 内部模块或数据库 |
| 4：独立工程化 | 依赖、发布节奏或团队权限开始分化 | 迁到 `apps/web`、`apps/pipeline`、`packages/<service>-contract`，拆 package/lock/build | 某服务内部改动不触发其他服务构建；契约保持版本兼容 |
| 5：对外开放契约 | 出现第二种语言或仓库外调用方 | 选择唯一 schema 源，生成 OpenAPI 和客户端，增加兼容性校验 | schema、DTO 与实际响应一致；支持至少一个旧版本迁移窗口 |

不提前添加 Gateway、Queue、服务注册中心或通用 Repository。Web 负责聚合展示；跨服务业务依赖应显式通过服务 API 表达。只有出现独立重试、吞吐削峰或多个订阅者需求，才采用异步事件。

Cloudflare HTTP service binding 的平台依据：[官方文档](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/http/)。本仓库使用 fetch 协议而不共享 Worker RPC 类类型，降低对实现代码的编译耦合。

## 本地验证记录

本次改造通过 229 项测试（含真实 SQLite 的事件发布、周期报告发布与 Memory 领取、Web service binding 读取），以及根项目、Web 和 Pipeline 的独立 TypeScript 检查、ESLint、架构门禁、Web production build。两端部署包完成 dry-run，Pipeline staging 也完成 dry-run。Web 打包配置仅包含一个 `ANALYSIS_SERVICE`，没有分析 D1；Web JS 产物未包含 D1 repository、Memory 表或模型 endpoint。

这些是本地验证结果，不代表生产切换或真实模型长流程已在线验证。上线仍按部署文档执行。
