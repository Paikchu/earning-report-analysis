# 8-K 简介优化方案：抓取 Exhibit 附件

## 结论

**能解析到。** 已用真实 SEC 数据 + 项目真实解析代码端到端验证。

8-K 主体的实际内容只有 3–4 KB 纯文本，且全部是监管样板（注册地、地址、合规 checkbox、签署人）——
真正的业绩数据在 Exhibit 99.1 里，目前**完全没有被抓取**。

| 公司 | 现在（仅主体） | 附件（目前丢失） | 文本增益 |
| --- | --- | --- | --- |
| TSLA | 3.2 KB / 10 blocks | 40.8 KB / 20 blocks | 12.9x |
| NVDA | 3.9 KB / 13 blocks | 42.2 KB / 43 blocks | 10.8x |
| ORCL | 3.7 KB / 9 blocks | 48.9 KB / 74 blocks | 13.3x |
| AAPL | 3.5 KB / 8 blocks | 10.6 KB / 9 blocks | 3.1x |

---

## 一、截图里那些元信息是怎么来的

对 `TSLA 8-K 0001628280-26-049213`（2026-07-22）逐项溯源：

| 截图显示 | 主体原文出处 |
| --- | --- |
| 文件形式：Exhibit 99.1 / Item 2.02 | `Item 2.02 Results of Operations...` + `Exhibit 99.1` |
| 报告日期 / 德克萨斯州奥斯汀 | `Date of report: July 22, 2026` + `Austin, Texas 78725` |
| 签署人 Brandon Ehrhart | `By: /s/ Brandon Ehrhart / General Counsel and Corporate Secretary` |

模型没有出错——它拿到的 3,343 字符里只有这些。输入决定了输出。

---

## 二、数据源选型：不能用 index.json

两个候选数据源都测了：

| 数据源 | 结论 |
| --- | --- |
| `Archives/.../<accession>/index.json` | **不可靠**。NVDA（2026-08-26 提交）和 ORCL 的 index.json 里根本没有 EX-99.1 文件。近几天新提交的 filing 索引尚未同步。 |
| `Archives/.../<accession>/<accession>.txt` | **权威**。含 SEC 官方 `<TYPE>` 语义标记，立即可用。 |

`.txt` 用 `<DOCUMENT>` 分块，每块带 `<TYPE>` / `<SEQUENCE>` / `<FILENAME>` / `<TEXT>`：

```
8-K        主体（元信息）        Tesla 3,343 字符
EX-99.1    业绩附件              Tesla 42,616 字符   ← 真正的内容
EX-99.2    CFO 评论              NVDA 21,971 字符
EX-101.*   XBRL taxonomy         噪音
GRAPHIC    图片 base64 ×33       噪音（占 Tesla 5.28MB 的绝大部分）
XML/JSON/ZIP  XBRL viewer 生成物  噪音
```

**关键：`<TYPE>` 解决了文件名不统一的问题。** 各公司附件命名毫无规律，靠文件名正则会漏：

| 公司 | 附件文件名 | `ex`/`99` 正则命中 |
| --- | --- | --- |
| Tesla | `exhibit991.htm` | 命中 |
| Apple | `a8-kex991q3202606272026.htm` | 命中 |
| Cloudflare | `q226exhibit991.htm` | 命中 |
| Oracle | `orcl-ex99_1.htm` | 命中 |
| **NVIDIA** | `q2fy27pr.htm` | **漏** |

而 `<TYPE>EX-99.1` 对所有公司都是同一个值。

### 体积问题与解法

`.txt` 因内嵌图片 base64 可达 5.28 MB（Tesla），不能直接下载。用流式解析边下边丢：

| 公司 | 下载量 | 保留文本 | 峰值缓冲 |
| --- | --- | --- | --- |
| TSLA | 5.28 MB | 77.9 KB | 357 KB |
| NVDA | 0.76 MB | 609.7 KB | 325 KB |
| ORCL | 2.13 MB | 1,965.9 KB | 1,895 KB |

已用 Node 流式原型验证可行（`res.body.getReader()` 按 `</DOCUMENT>` 边界切块，GRAPHIC/XBRL 块不缓存）。

内嵌 base64 图片无需额外处理：现有 `htmlToSecDocument` 的 `<[^>]+>` 替换已经能剥离
（ORCL 1,911 KB HTML → 48.9 KB 文本，压缩比 39:1）。

---

## 三、第二个问题：光加附件还不够

`summarizePreparedSecEvent`（`lib/sec-pipeline.ts:260`）只取 `blocks.slice(0, 12)`。
附件块排在主体块之后的话，前 12 个仍然几乎全是样板。

实测对比：

| 策略 | 附件块占比 | 样板文字 | 平均数字密度 | 拿到的内容 |
| --- | --- | --- | --- | --- |
| TSLA 现有 `slice(0,12)` | 2/12 | 3/12 | 116 | `UNITED STATES`、`1 Tesla Road` |
| TSLA 附件优先+密度排序 | **12/12** | 0/12 | **202** | `FINANCIAL STATEMENTS`、业务数据 |
| ORCL 现有 `slice(0,12)` | 3/12 | 2/12 | 80 | `2300 Oracle Way, Austin, Texas` |
| ORCL 附件优先+密度排序 | **12/12** | 0/12 | **368 (4.6x)** | `REVENUES BY OFFERINGS`、`OPERATING INCOME`、`NET INCOME` |

**抓取和选择必须一起改。**

---

## 四、改动清单

### P0 — 核心（缺一不可）

**1. `lib/sec.ts` — 新增流式附件发现**

新增 `streamSecFilingDocuments(cik, accessionNumber, fetcher)`：
- 请求 `<accession>.txt`，用 `res.body.getReader()` 流式读取
- 按 `</DOCUMENT>` 边界切块，只读 `<TYPE>`/`<FILENAME>`/`<TEXT>`
- 保留 `KEEP = /^(8-K|6-K|8-K\/A|6-K\/A|EX-(?!101)\S+)$/i`
- 丢弃 `GRAPHIC|XML|JSON|ZIP|EX-101.*`（不进内存）
- 返回 `Array<{ type, filename, text }>`

**2. `lib/sec-analysis.ts` — `FilingBlock` 增加来源标记**

```ts
source?: "body" | "exhibit";
exhibitType?: string;   // "EX-99.1"
```

**3. `lib/sec-pipeline.ts:109` `prepareSecFiling` — 8-K/6-K 走新路径**

- 表单匹配 `/^(8-K|6-K)(\/A)?$/` 时调用 `streamSecFilingDocuments`
- 主体与各附件分别调 `htmlToSecDocument` + `buildFilingBlocks`，打上 `source`/`exhibitType`
- 拼接时**主体在前、附件在后**（保持现有顺序语义）
- 10-K/10-Q/20-F 保持现有逻辑不变
- 失败时回退到现有单文档路径，不阻断发布

**4. `lib/sec-pipeline.ts:247` `summarizePreparedSecEvent` — 改 block 选择**

`blocks.slice(0, 12)` 换成 `selectEventBlocks(blocks, 12)`：
1. 剔除匹配样板正则的块（注册地、地址、合规 checkbox、签署人等）
2. `source === "exhibit"` 优先于 `"body"`
3. 组内按 `numericDensity` 降序，`table_like` 加权
4. 取前 12

### P1 — 质量保障

**5. `lib/sec-pipeline.ts:429` `eventSummarySystemPrompt` 重写**

- 明确：`headline` 与 `bullets` 只允许来自附件实际披露的内容
- 禁止：签署人、办公地点、Commission File Number、IRS Employer ID、Item 编号、filing date
- 无具体数字时输出事件定性，不要复述表单结构

**6. `lib/sec.ts:223` `normalizeSecSummary` 加质量门禁**

检测到 bullets 全部命中样板词（签署人 / `General Counsel` / `Austin, Texas` / `Item 2.02` / `Commission File`）时标记低质量，
配合现有重试机制触发重生成。

### P2 — 体验增强（已实施）

- `SecFilingSummary` 增 `eventCategory`（`earnings_update` / `guidance` / `m&a` / `executive` / `legal` / `other`），由模型在 outputSchema 里给出，`normalizeSecSummary` 校验白名单，缺失或非法时事件摘要判定不完整并重试
- 8-K 也启用 `summary.report` 字段承载附件核心摘要（prompt 要求 300–600 字连贯输出）
- `SEC_SUMMARY_VERSION: 5` → `6`。**D1 无需迁移**：`sec_filing_summaries.payload` 是 JSON blob，新字段随 payload 存储，版本号随 payload 一起写入
- 存量 8-K 重生成：事件类作业的 `analysisVersion` 追加 `+summary-v6`（`jobAnalysisVersionFor`），版本升级后作业查询未命中，自动走一遍新管线
- `isSummaryRetryDue` 对事件摘要增加版本比对，旧摘要（无版本号）标记为需再生
- `SecFilingsSection.tsx` 按 eventCategory 差异化展示：类别徽章 + report 段落（业绩更新/指引标"业绩要点"，其余标"事件详情"）

---

## 五、风险与边界

| 风险 | 说明 | 处理 |
| --- | --- | --- |
| `.txt` 体积 | 极端 filing 可能远超 5 MB | 流式解析已限制峰值缓冲；可加下载上限告警 |
| 6-K 差异 | 外国发行人结构略有不同 | 同一 `<TYPE>` 机制适用，已用 TSM 验证存在附件 |
| 附件可能内联 | 少数 filing 无独立 EX-99 | 无附件时回退主体，行为同现状 |
| SEC 速率限制 | 10 req/s | 每个 filing 仍是 1 次请求，与现状相同 |
| Worker CPU | 流式解析增加少量 CPU | 无额外网络往返，总体持平 |

---

## 六、验证脚本

`scripts/verify-8k-exhibits.ts` —— 用项目真实 `htmlToSecDocument` + `buildFilingBlocks` 处理实时 SEC 数据，
同时验证流式发现、解析质量和 block 选择策略。

```bash
node --experimental-strip-types scripts/verify-8k-exhibits.ts
```

实测输出（2026-08-28）：

| 公司 | 主体（现状） | 附件（丢失） | 增益 | 现状 block 选择 | 附件优先 |
| --- | --- | --- | --- | --- | --- |
| TSLA | 3.2 KB / 10 | 40.8 KB / 20 | 12.9x | 2/12 附件，密度 116 | 12/12，密度 202 |
| NVDA | 3.9 KB / 13 | 42.2 KB / 43 | 10.8x | **0/12 附件**，密度 114 | 12/12，密度 242 |
| ORCL | 3.7 KB / 9 | 48.9 KB / 74 | 13.3x | 3/12 附件，密度 80 | 12/12，密度 364 |
| AAPL | 3.5 KB / 8 | 10.6 KB / 9 | 3.1x | 4/12 附件，密度 132 | 9/12，密度 242 |

NVDA 现状为 0/12，因为它的附件不在 index.json 里、且主体块数已超过 12。
