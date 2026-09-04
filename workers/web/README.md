# Web Worker

Cloudflare Worker：`earning-report-analysis-sec-web`

这个目录归属 Web Worker 的部署边界：

- `wrangler.jsonc`：受版本控制的源配置，供 Vite/Cloudflare 插件读取。
- `index.ts`：Vinext App Router Worker 入口。
- `migrations/`：仅属于 Web Worker 的 D1 migrations。
- `drizzle.config.ts`：生成上述 migrations 的 Drizzle 配置。
- `worker-configuration.d.ts`：Web Worker 的 D1 ambient type。
- `.dev.vars.example`：Web Worker 本地 runtime variables/secrets 模板。
- `scripts/`：把构建生成的 `dist/server/wrangler.json` 准备成可部署配置并执行门禁。

Vinext 会把源配置转换为 `dist/server/wrangler.json`。Cloudflare Builds 的 deploy 和
non-production branch deploy 命令必须使用根目录 `package.json` 中的
`worker:web:*:built` scripts；不要直接部署源 `wrangler.jsonc`，也不要使用不带
`--config` 的默认 Wrangler 命令。

源配置中的 D1 id 故意使用不可部署的占位值。`prepare-config.ts` 只从 Build variable
`SEC_WEB_D1_DATABASE_ID` 注入真实 id，`check-config.ts` 会在部署前拒绝占位值或配置漂移，
`check-migrations.ts` 会拒绝 migration 落后于本次构建的 D1。
