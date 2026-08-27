# SEC Workflow 架构

```mermaid
flowchart TD
    A["Cron / 管理员刷新"] --> B["公司白名单校验"]
    B --> C["发现 SEC filings"]
    C --> D{"文件类型"}

    D -->|"8-K / 6-K"| E["事件摘要"]
    E --> P["发布到 D1 / R2"]

    D -->|"10-K / 10-Q / 20-F"| F["准备原文与证据块"]
    F --> G["Router 选择证据"]
    G --> H["7 个结构化分析模块"]
    H --> I{"核心事实门禁"}
    I -->|"无核心事实或单位冲突"| X["失败，保留上一版报告"]
    I -->|"通过"| J["SecAnalysisBrief"]
    J --> K["Manager 规划分析节点"]
    K --> L["节点分析与有限修复"]
    L --> M["Claim Ledger"]
    M --> N["Synthesis 生成完整研报"]
    N --> O{"报告结构与完整性"}
    O -->|"缺少正文或核心结论"| X
    O -->|"通过"| P
    P --> Q["前端公开 API 与报告页"]
    P --> R["异步 Company Memory"]
```

- 已删除 Synthesis 后的确定性 Claim Check、Reverse Claim AI 和 Synthesis Repair。
- Claim Ledger 仅作为 Synthesis 的结构化输入和 R2 审计产物，不再阻止发布。
- 结构化模块仍限制证据来源，拒绝无核心事实、非法证据和同一定义 KPI 的单位冲突。
- Synthesis 仍必须生成正文、3–5 条核心结论和投资观点；缺失时保留上一版报告。
