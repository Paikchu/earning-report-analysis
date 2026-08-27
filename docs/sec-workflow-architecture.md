# SEC Workflow 架构

```mermaid
flowchart TD
    A["Cron / 管理员刷新"] --> B["公司白名单校验"]
    B --> C["发现 SEC filings"]
    C --> D{"文件类型"}

    D -->|"8-K / 6-K"| E["事件摘要"]
    E --> P["发布到 D1 / R2"]

    D -->|"10-K / 10-Q / 20-F"| F["准备：原文、章节、证据块、XBRL"]
    F --> G["读取 D1 上下文（1 次桥接调用）"]
    G --> H["确定性组装 SecAnalysisBrief"]
    H --> I{"核心事实门禁"}
    I -->|"无 XBRL 序列或单位冲突"| X["失败，保留上一版报告"]
    I -->|"通过"| J["Manager 规划分析节点"]
    J --> K["节点分析：叙述 + 结构化 facts"]
    K --> L["Manager Review + 至多 1 轮修复"]
    L --> M["Synthesis 生成完整研报"]
    M --> N{"报告结构与完整性"}
    N -->|"缺少正文或核心结论"| X
    N -->|"通过"| P
    P --> Q["前端公开 API 与报告页"]
    P --> R["异步 Company Memory"]
```

## 数字从哪来

- **本期数值、同比与环比全部来自 SEC XBRL Company Facts**（`SEC_CANONICAL_SERIES_REGISTRY`）。
  `buildSecAnalysisBrief` 只挑选 `endDate` 落在申报期末 10 天内、口径与 `periodScope` 匹配的观测值，
  比较在同一序列内部完成，因此单位、币种和基准天然可比。
- **分部收入、管理层 KPI、指引和一次性项目由分析节点产出**。节点在写叙述的同时输出 `facts`，
  `metricKey` 优先取 `allowedMetricKeys`，自定义 KPI 用 `business_kpi` 加原文 `definition`，
  每条必须引用节点实际读到的 `ev:` 证据块。
- **Synthesis 不接触 filing 原文**，只看 Brief、完成节点和 Manager Review。
  `keyMetrics` 会按 `allowedMetricKeys` 过滤，超出词表的指标被丢弃。

## R2 布局

`prepare` 写三个对象，读的人只取自己需要的那份：

| 键 | 内容 | 谁读 |
| --- | --- | --- |
| `filings/<ticker>/<accession>/meta.json` | filing、periodId、outline、blockIds | Brief、Manager、Review、Synthesis |
| `filings/<ticker>/<accession>/text.json` | 正文与全部证据块 | 节点分析、事件简析、发布 |
| `filings/<ticker>/<accession>/history.json` | XBRL Company Facts | Context、Brief |

`PreparedSecFilingMeta` 与 `PreparedSecFiling` 是两个类型，把"这一步不需要正文"变成类型约束。

## 跨 Worker 调用

每篇 filing 现在是：1 次任务查询 + 1 次 context + 1 次 job start + N 次证据块批量 + 1 次终稿发布 + 1 次 job complete。
job 的中间 stage 不再写 D1——Cloudflare Workflow 已经持久化了每个 step 的名字和 attempt，失败时的 stage 记录在失败行里。

## 已经删除的环节

- Router 与 7 个结构化模块：它们抽取的核心财务数字 XBRL 已经提供，且更准确。
- 跨来源比较（模型抽取值 vs XBRL）：单位与量纲无法可靠对齐，改为 XBRL 序列内部比较。
- Claim Ledger：不再拦截发布之后，它只是把 Synthesis 的输入复制了一遍。
- Synthesis 后的确定性 Claim Check、Reverse Claim AI 和 Synthesis Repair。
- `buildWorkflowTrace` 与前端「全部 Workflow 节点」：改由 `dataQuality` 暴露真实的分析完整性。
- 第二次 context 调用、每阶段的 job stage 写入、证据分片里重复的 report 载荷。

## 仍然生效的门禁

- Brief 必须带有 XBRL 历史序列；同一序列、同一期间出现两种单位视为硬失败。
- 节点 facts 不能引用节点未读到的证据块。
- Synthesis 必须生成正文、3–5 条核心结论和投资观点；缺失时保留上一版报告。
- `keyMetrics` 先经 `canonicalMetricKey` 别名归一；仍无法核验的单条丢弃并记 warning，不再整篇失败。
  只有完全没有事实来源时才标记 `failed`，此时不覆盖已发布版本。
- 修复循环上限为 1 轮 × 3 个节点，按 materiality 从高到低取。
  想放宽就改 `MAX_REPAIR_ROUNDS`——先看 R2 里 `manager-review/round-*.json` 的 coverageScore 提升值不值这个成本。
