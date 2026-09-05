# 部署

两个 Worker 独立部署。仓库入口、Cloudflare Dashboard 字段和 watch paths 总表见
[`../workers/README.md`](../workers/README.md)。密钥用 `wrangler secret put` 单独写入，
不进代码也不进 vars。

## Web Worker

受版本控制的源配置是 `workers/web/wrangler.jsonc`。`vinext build` 根据它生成
`dist/server/wrangler.json`；`worker:web:prepare` 会**剥掉**生成器可能写进去的任何 D1
binding 并确认 `PIPELINE` service binding 存在，`worker:web:check` 会拒绝任何仍带 D1/R2
binding、缺 `PIPELINE` binding、缺 `nodejs_compat`，或与 Pipeline 兼容性日期漂移的配置。

这个 Worker 已经没有数据库，所以也没有 migration 门禁了——那道门跟着数据所有权搬到了
Pipeline（`npm run worker:pipeline:check:migrations`）。

```bash
export SEC_WEB_WORKER_NAME="earning-report-analysis-sec-web"
export SEC_PIPELINE_ORIGIN="https://earning-report-analysis-sec-pipeline.<subdomain>.workers.dev"
npm run web:deploy
```

`web:deploy` 等价于 build → `worker:web:prepare` → `worker:web:check` →
`wrangler deploy --keep-vars`。需要手工分步时：

```bash
npm run build
npm run worker:web:prepare
npm run worker:web:check
npx wrangler deploy --config dist/server/wrangler.json --keep-vars
```

密钥：

```bash
printf %s "$SEC_ADMIN_TOKEN" | npx wrangler secret put SEC_ADMIN_TOKEN --config dist/server/wrangler.json
printf %s "$SEC_REFRESH_KEY" | npx wrangler secret put SEC_REFRESH_KEY --config dist/server/wrangler.json
# 这个 Worker 读分析数据用的读凭据，格式 <keyId>.<secret>，对应后端 ANALYSIS_READ_KEYS 里的一条。
printf %s "$ANALYSIS_READ_TOKEN" | npx wrangler secret put ANALYSIS_READ_TOKEN --config dist/server/wrangler.json
```

## Pipeline Worker

受版本控制的源配置是 `workers/pipeline/wrangler.jsonc`，部署直接用它，没有生成步骤。这个 Worker
是**分析后端**：它是 D1 的唯一读者和唯一写者，migrations 也归它所有
（`workers/pipeline/migrations/`，`migrations_dir: "migrations"`）。D1 id 就写在配置里，和同一份
文件里的 bucket 名、Worker 名一样是 account 内的标识符，不是凭据。所以 Pipeline 不需要任何
Build variable。

部署前会先跑 `worker:pipeline:check:migrations`，向远端 D1 确认这份构建带的 migration 全部
apply 过。漏掉一条会让新代码撞上旧 schema：catalog v2 的 `multiple` 单位族撞 `unit_family`
CHECK 约束，就曾让每一次基本面同步失败整整一天。

只读 API 的凭据是 runtime secret `ANALYSIS_READ_KEYS`；**没有配置它，只读 API 会拒绝所有请求**
（503 `READ_AUTH_NOT_CONFIGURED`），不会退化成开放访问。创建、轮换与吊销见
[`analysis-backend.md`](analysis-backend.md#3-credentials)。

```bash
printf %s '<keyId>:<secret>:*' | npx wrangler secret put ANALYSIS_READ_KEYS --config workers/pipeline/wrangler.jsonc --env=""
```

先部署关闭 Cron 的 staging（独立 Worker、Workflow 和 R2）：

```bash
npm run worker:pipeline:deploy:staging
printf %s "$SEC_REFRESH_KEY" | npx wrangler secret put SEC_REFRESH_KEY --config workers/pipeline/wrangler.jsonc --env staging
printf %s "$AI_API_KEY" | npx wrangler secret put AI_API_KEY --config workers/pipeline/wrangler.jsonc --env staging
```

**staging 没有 D1 绑定**，因为它绝不能写生产库，而它自己还没有库。它的 Cron 列表为空，正常不会
走到基本面同步；显式 POST 的 canary 如果走到，会拿到明确的 "Pipeline has no D1 binding" 报错，
而不是静默写错地方。要让 staging 具备这个能力，先建一个 staging D1，再给 `env.staging` 补上
绑定。

```bash
npm run worker:pipeline:deploy
```

## 白名单

`SEC_TRACKED_TICKERS` **只配置在 Pipeline Worker 上**，作为一个 runtime variable（不进
`wrangler.jsonc`，不进代码，也不是 Build variable）。Pipeline 自己决定分析谁——它不该问上层要
这个答案，Web 也不再持有这份数据。

直接在 Cloudflare Dashboard 的 Pipeline Worker → Settings → Variables and Secrets 里编辑这一个
值即可，不需要重新构建或部署；`--keep-vars` 保证之后的部署不会覆盖它。加一个股票代码就是改这一
个值。也可以用命令行：

```bash
npx wrangler secret put SEC_TRACKED_TICKERS --config workers/pipeline/wrangler.jsonc
```

（用 `secret` 而非普通 var 只是因为这是 Wrangler 唯一能不触发部署直接改运行时值的命令；ticker
列表本身不敏感，值就是明文的股票代码，跟 `SEC_REFRESH_KEY` 那种真正的密钥不是一回事。）

Web 侧不再做任何白名单校验——`admin/*/refresh`、`admin/*/backfill` 这两个转发路由把请求原样
转给 Pipeline，Pipeline 的 `handleSecAnalysisRequest` 会在真正起 workflow 之前自己检查一遍
（`workers/pipeline/core.ts` 的 `assertTrackedTicker`）。403 的来源从 Web 换到了 Pipeline，这是
故意的：判断"该不该分析"的权力现在完全在下层。

探针分成两个：`/health` 只报存活（`{"status":"ok"}`），`/ready` 报依赖就绪——只读绑定和配置
**是否存在**的布尔值，不发查询、不做写入、不回显任何值。读取路径不需要模型凭据，所以
`AI_API_KEY` 缺失不会让 `/ready` 变红。

`SEC_ANALYSIS_MODEL` 是所有阶段的主模型。可选的 `SEC_REASONING_MODEL` 只接管 Manager 规划、Manager Review 和 Synthesis——节点抽取、事件简析和 Memory 提取仍走主模型。不设置就是单模型，行为与之前一致；重试降级到 `hy3` 始终优先于这两者：

```bash
npx wrangler deploy --config workers/pipeline/wrangler.jsonc --env="" --keep-vars --var "SEC_REASONING_MODEL:<model>"
```

`npm run worker:pipeline:check` 是不落地的干跑，可以在部署前确认绑定解析正确。旧的
`sec-cron:check` / `sec-cron:deploy` scripts 只作为兼容别名保留。

## 依赖方向

Pipeline 是下层，Web 是上层：依赖只能从 Web 指向 Pipeline，反过来不允许。这不是靠约定维持
的——Pipeline 的 `wrangler.jsonc` 里没有任何指向 Web 的 `services` 绑定，代码里也没有
`WEB_APP_ORIGIN`，物理上就调不到 Web。Pipeline 需要的一切要么来自自己的配置（`SEC_TRACKED_TICKERS`），
要么直接读写 D1，要么自己去抓外部数据源（EDGAR、Yahoo）。

Web 仍然可以调用 Pipeline，这是允许的控制面方向，现在有两类：

- 手动触发分析/回填：`admin/*/refresh`、`admin/*/backfill`、`internal/sec/refresh/[ticker]`
  转发到 Pipeline 的 `/jobs/:ticker` / `/backfill/:ticker`。
- 读分析数据：Web 的 `/api/v1/*` 兼容代理和 SSR 页面调用后端的只读 API，携带服务端持有的
  `ANALYSIS_READ_TOKEN`。走 Service Binding 不构成身份证明，后端只认 `Authorization`。

按需刷新基本面这条路径**已经删除**：读取不再触发刷新，改由后端 Cron 巡检和受认证的
`/fundamentals/refresh/:ticker` 负责。

上面几类都走 `services: [{ binding: "PIPELINE", ... }]` 这个 Service Binding，不直接打公网
域名——两个 Worker 在同一个 workers.dev 子域下，公网域名互相调用会在边缘被拒（404）。

## 回滚

两个 Worker 都用版本回滚，不重新构建：

```bash
npx wrangler rollback <version-id> --config dist/server/wrangler.json    # Web
npx wrangler rollback <version-id> --config workers/pipeline/wrangler.jsonc  # Pipeline
```

Web Worker 的回滚依赖本地 `dist/`（构建产物，已 gitignore）。回滚到**本次重构之前**的 Web 版本
会重新引入它对 D1 的直接访问，那个版本需要 `DB` binding 才能工作——这是一次刻意的、临时的
暴露，滚回新版本后必须立刻把 binding 去掉。详见
[`analysis-backend.md` §6.4](analysis-backend.md#64-rollback)。Pipeline 用的是受版本控制的
配置，回滚是无条件安全的：旧版本仍然拥有数据库和全部控制端点，只是少了只读 API，此时 Web 的
代理会返回 503 `ANALYSIS_BACKEND_UNAVAILABLE`。

本次重构**没有任何 schema 变更**，因此没有需要向下迁移的东西，也不会删除任何已发布结果。

已发布的报告不随 Worker 回滚改变——它们在 D1 里，只有跨过门禁的分析才会写入。
