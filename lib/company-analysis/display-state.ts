import type { AnalysisRunSummary } from "../analysis-contract/filings.ts";

export function companyAnalysisNotice(run: AnalysisRunSummary | undefined, hasOverview = false): string {
  const missingData = run?.errorCode === "yahoo_target_period_missing" || run?.errorCode === "INSUFFICIENT_DATA";
  if (run?.state === "queued" || missingData) {
    return hasOverview
      ? "最新季度的 Yahoo 数据尚待对齐，当前展示上一版业务判断。"
      : "正在等待 Yahoo 补齐目标季度数据；数据对齐后将自动生成业务分析。";
  }
  if (run?.state === "running") {
    return hasOverview ? "最新业务分析正在生成，当前展示上一版已发布结论。" : "数据已就绪，正在生成和校验业务分析。";
  }
  if (run?.state === "failed") {
    const message = run.errorCode === "RECOVERY_EXHAUSTED"
      ? "业务分析多次生成失败，自动重试已暂停，需维护人员处理。"
      : "业务分析暂时生成失败，系统将按重试策略自动恢复。";
    return hasOverview ? `${message}当前保留上一版已发布结论。` : message;
  }
  if (hasOverview) return "";
  if (run?.state === "unknown") return "暂时无法确认业务分析的生成状态，请稍后重新读取。";
  return "业务分析尚未生成，将在周期报告与 Yahoo 数据就绪后自动启动。";
}

export function shouldPollCompanyAnalysis(run: AnalysisRunSummary | undefined): boolean {
  return Boolean(run && (run.state === "queued" || run.state === "running"
    || (run.state === "failed" && run.errorCode !== "RECOVERY_EXHAUSTED")));
}
