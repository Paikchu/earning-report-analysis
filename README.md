# MAX · 投资记录

私人投资账本。首页读取 IBKR 静态快照，个股详情按当前 ChatGPT 身份读取和保存持仓计划。

## 数据边界

- `data/portfolio-snapshot.json`：IBKR 账户、持仓和成交快照，不是实时行情。
- `data/us-securities.json`：由 Nasdaq Trader 官方目录生成的美股与 ETF 搜索索引。
- D1 `DB`：按 `owner_email + ticker` 保存持仓原因和规划点位。
- 客户端不提交 owner；服务端从 `oai-authenticated-user-email` 读取身份。

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

修改 `db/schema.ts` 后生成迁移：

```bash
npm run db:generate
```

## 路由

- `/`：组合与按 ticker 聚合的投资账本。
- `/positions/[ticker]`：持仓构成、持仓原因和规划点位。
- `GET /api/symbols?q=`：认证后的证券搜索，最多 10 条。
- `PUT /api/plans/[ticker]`：认证、同源校验后的计划保存接口。
