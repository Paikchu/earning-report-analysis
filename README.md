# MAX · 投资记录

私人投资账本。首页读取 IBKR 静态快照，个股详情按当前 ChatGPT 身份读取持仓计划、SEC 文件和 AI 解读。

## 数据边界

- `data/portfolio-snapshot.json`：IBKR 账户、持仓和成交快照，不是实时行情。
- `data/us-securities.json`：由 Nasdaq Trader 官方目录生成的美股与 ETF 搜索索引。
- `data/earnings-calendar.json`：未来 90 天 Nasdaq 财报日历快照；日期按美股市场日展示，并换算北京查看时段。
- D1 `DB`：按 `owner_email + ticker` 保存持仓原因和规划点位。
- D1 `DB`：缓存 SEC ticker/CIK、最近文件、清洗后的正文和 DeepSeek 中文解读。
- 客户端不提交 owner；服务端从 `oai-authenticated-user-email` 读取身份。
- SEC 定时任务只通过受保护的内部 API 写入 D1，不访问或修改 IBKR。

## 本地命令

```bash
npm install
npm run dev
npm test
npm run lint
npm run build
```

更新 IBKR 快照：

```bash
npm run snapshot:update -- --input /absolute/path/to/ibkr-export.json
```

更新证券目录：

```bash
npm run symbols:update
```

单独更新财报日历：

```bash
npm run earnings:update
```

修改 `db/schema.ts` 后生成迁移：

```bash
npm run db:generate
```

SEC 本地配置复制自 `.env.example`。`AI_API_KEY` 与 `SEC_REFRESH_KEY` 必须作为密钥保存；`SEC_USER_AGENT` 必须包含可联系的邮箱。

检查或部署 SEC 定时任务：

```bash
npm run sec-cron:check
npm run sec-cron:deploy
```

## 路由

- `/`：组合与按 ticker 聚合的投资账本。
- `/positions/[ticker]`：持仓构成、持仓原因和规划点位。
- `GET /api/sec/[ticker]/filings`：认证后的最近 5 份 SEC 文件与缓存 AI 解读。
- `GET /api/internal/sec/watchlist`：定时任务读取正股监控列表，要求 `x-sec-refresh-key`。
- `POST /api/internal/sec/refresh/[ticker]`：定时刷新单个 ticker，要求 `x-sec-refresh-key`。
- `GET /api/symbols?q=`：认证后的证券搜索，最多 10 条。
- `PUT /api/plans/[ticker]`：认证、同源校验后的计划保存接口。
