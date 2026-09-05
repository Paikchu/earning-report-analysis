# Web Worker

Cloudflare Worker：`earning-report-analysis-sec-web`

这个 Worker 是**分析后端的一个客户端**，不是数据的拥有者。它没有 D1 绑定，也没有 R2 绑定：
所有财务分析读取——包括服务端渲染——都通过 `PIPELINE` Service Binding 调用 Pipeline Worker
的只读 API，并携带一个服务端持有的读凭据（`ANALYSIS_READ_TOKEN`）。

服务边界、API 契约与凭据流程见
[`../../docs/analysis-backend.md`](../../docs/analysis-backend.md)。

## 目录内容

- `wrangler.jsonc`：受版本控制的源配置，供 Vite/Cloudflare 插件读取。包含 `PIPELINE`
  Service Binding 和公开 API 的 rate limit binding，**不包含任何 D1 或 R2 绑定**。
- `index.ts`：Vinext App Router Worker 入口。
- `worker-configuration.d.ts`：Web Worker 的 ambient bindings type。
- `.dev.vars.example`：Web Worker 本地 runtime variables/secrets 模板。
- `scripts/`：把构建生成的 `dist/server/wrangler.json` 准备成可部署配置并执行门禁。

D1 migrations 和 Drizzle 配置已经随数据所有权迁到
[`../pipeline/migrations/`](../pipeline/migrations/) 和
[`../pipeline/drizzle.config.ts`](../pipeline/drizzle.config.ts)。

Vinext 会把源配置转换为 `dist/server/wrangler.json`。Cloudflare Builds 的 deploy 和
non-production branch deploy 命令必须使用根目录 `package.json` 中的
`worker:web:*:built` scripts；不要直接部署源 `wrangler.jsonc`，也不要使用不带
`--config` 的默认 Wrangler 命令。

`prepare-config.ts` 会**剥掉**生成配置里的任何 D1 binding（Vinext 的生成器可能仍会写入
一个），并确认 `PIPELINE` binding 存在；`check-config.ts` 会拒绝任何仍带 D1/R2 binding、
缺少 `PIPELINE` binding、缺 `nodejs_compat`，或与 Pipeline 兼容性日期漂移的配置。
Web 侧不再有 migration 门禁——它没有数据库可以落后。
