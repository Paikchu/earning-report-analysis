"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import {
  FundamentalBarChart,
  FundamentalComboChart,
  FundamentalLineChart,
  MetricSelector,
} from "@/components/fundamentals/FundamentalChart";
import {
  FUNDAMENTAL_PAGE_PERIOD_OPTIONS,
  limitFundamentalMetricAxes,
  reconcileFundamentalMetricSelection,
  writeFundamentalPageState,
  type FundamentalChartMode,
  type FundamentalPageState,
} from "@/lib/fundamental-page-state";
import {
  resolveFundamentalPresentation,
  sliceFundamentalsForChart,
  type ResolvedFundamentalPresentation,
} from "@/lib/fundamental-chart-plan";
import {
  buildFundamentalChartModel,
  formatFundamentalChartValue,
  formatFundamentalPeriod,
} from "@/lib/fundamental-chart";
import type { FundamentalMetricKey, FundamentalTransform } from "@/lib/fundamental-metrics";
import type { PublicFundamentalsResponse } from "@/lib/fundamentals-api";

const SNAPSHOT_METRICS_A: readonly FundamentalMetricKey[] = [
  "total_revenue",
  "gross_profit",
  "gross_margin",
  "operating_income",
];
const SNAPSHOT_METRICS_B: readonly FundamentalMetricKey[] = [
  "operating_margin",
  "net_income",
  "operating_cash_flow",
  "diluted_eps",
];

export type FundamentalsRequestState = "loading" | "ready" | "refreshing" | "error";

type FundamentalChartsProps = {
  ticker: string;
  companyName: string;
  initialState: FundamentalPageState;
  initialPreferenceSource?: "url" | "preset";
  initialAiPlan?: unknown;
};

type FundamentalChartsViewProps = {
  ticker: string;
  companyName: string;
  data: PublicFundamentalsResponse | null;
  pageState: FundamentalPageState;
  requestState: FundamentalsRequestState;
  error: string | null;
  presentation?: ResolvedFundamentalPresentation | null;
  onMetricKeysChange(metricKeys: FundamentalMetricKey[]): void;
  onChartChange(chart: FundamentalChartMode): void;
  onPeriodCountChange(periodCount: number): void;
  onRetry(): void;
};

const CHART_MODES: readonly { value: FundamentalChartMode; label: string }[] = [
  { value: "combo", label: "组合" },
  { value: "bar", label: "柱状" },
  { value: "line", label: "折线" },
];

const FUNDAMENTALS_PENDING_POLL_DELAYS_MS = [1_000, 2_000, 4_000, 8_000] as const;

export function FundamentalCharts({
  ticker,
  companyName,
  initialState,
  initialPreferenceSource = "preset",
  initialAiPlan,
}: FundamentalChartsProps) {
  const [pageState, setPageState] = useState(initialState);
  const [overrideSource, setOverrideSource] = useState<"url" | "user" | null>(
    initialPreferenceSource === "url" ? "url" : null,
  );
  const [data, setData] = useState<PublicFundamentalsResponse | null>(null);
  const dataRef = useRef<PublicFundamentalsResponse | null>(null);
  const [requestState, setRequestState] = useState<FundamentalsRequestState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [retryVersion, setRetryVersion] = useState(0);
  const presentation = useMemo(() => {
    if (!data || data.status !== "ready") return null;
    const override = {
      metricKeys: pageState.metricKeys,
      chart: pageState.chart,
      periodCount: pageState.periodCount,
    };
    return resolveFundamentalPresentation({
      data,
      userOverride: overrideSource === "user" ? override : null,
      urlOverride: overrideSource === "url" ? override : null,
      aiCandidate: initialAiPlan,
    });
  }, [data, initialAiPlan, overrideSource, pageState]);

  useEffect(() => {
    const controller = new AbortController();
    setRequestState(dataRef.current ? "refreshing" : "loading");
    setError(null);

    void (async () => {
      for (let attempt = 0; ; attempt += 1) {
        const response = await fetch(
          `/api/v1/companies/${encodeURIComponent(ticker)}/fundamentals?periodCount=${pageState.periodCount}`,
          { signal: controller.signal },
        );
        const payload = await response.json() as PublicFundamentalsResponse | { error?: string };
        if (!response.ok || !("status" in payload)) {
          throw new Error("error" in payload && payload.error ? payload.error : "基本面数据请求失败。");
        }
        dataRef.current = payload;
        setData(payload);
        if (payload.status === "pending") {
          const delay = FUNDAMENTALS_PENDING_POLL_DELAYS_MS[attempt];
          if (delay === undefined) {
            throw new Error("基本面同步未能及时完成，请稍后重试。");
          }
          setRequestState("refreshing");
          await waitForFundamentalsPoll(delay, controller.signal);
          continue;
        }
        setPageState((current) => {
          const availableMetricKeys = payload.series
            .filter((series) => series.available)
            .map((series) => series.metricKey);
          if (availableMetricKeys.length === 0) return current;
          const metricKeys = limitFundamentalMetricAxes(
            reconcileFundamentalMetricSelection(current.metricKeys, availableMetricKeys),
            payload.series,
          );
          return sameMetricKeys(metricKeys, current.metricKeys) ? current : { ...current, metricKeys };
        });
        setRequestState("ready");
        return;
      }
    })()
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : "基本面数据请求失败。");
        setRequestState(dataRef.current?.status === "ready" ? "ready" : "error");
      });

    return () => controller.abort();
  }, [pageState.periodCount, retryVersion, ticker]);

  useEffect(() => {
    if (!overrideSource) return;
    const url = new URL(window.location.href);
    url.search = writeFundamentalPageState(url.searchParams, pageState).toString();
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [overrideSource, pageState]);

  return (
    <FundamentalChartsView
      ticker={ticker}
      companyName={companyName}
      data={data}
      pageState={pageState}
      requestState={requestState}
      error={error}
      presentation={presentation}
      onMetricKeysChange={(metricKeys) => {
        if (metricKeys.length > 0) {
          setOverrideSource("user");
          setPageState((current) => ({ ...current, metricKeys }));
        }
      }}
      onChartChange={(chart) => {
        setOverrideSource("user");
        setPageState((current) => ({ ...current, chart }));
      }}
      onPeriodCountChange={(periodCount) => {
        setOverrideSource("user");
        setPageState((current) => ({ ...current, periodCount }));
      }}
      onRetry={() => setRetryVersion((version) => version + 1)}
    />
  );
}

export function FundamentalChartsView({
  // ticker/companyName stay on the props so callers are unchanged; the section
  // heading no longer repeats the company, which the page header already names.
  data,
  pageState,
  requestState,
  error,
  presentation,
  onMetricKeysChange,
  onChartChange,
  onPeriodCountChange,
  onRetry,
}: FundamentalChartsViewProps) {
  const [viewMode, setViewMode] = useState<"chart" | "table">("chart");
  const [selectedPeriodEnd, setSelectedPeriodEnd] = useState<string | null>(null);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const selectorTriggerRef = useRef<HTMLButtonElement>(null);
  const selectorDialogRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const selectedSeries = useMemo(
    () => data?.series.filter((series) => pageState.metricKeys.includes(series.metricKey)) ?? [],
    [data, pageState.metricKeys],
  );
  const seriesSpecs = useMemo(
    () => selectedSeries.map((series) => ({ metricKey: series.metricKey })),
    [selectedSeries],
  );
  const effectivePresentation = useMemo(() => {
    if (presentation || !data || data.status !== "ready") return presentation ?? null;
    try {
      return resolveFundamentalPresentation({
        data,
        urlOverride: {
          metricKeys: pageState.metricKeys,
          chart: pageState.chart,
          periodCount: pageState.periodCount,
        },
      });
    } catch {
      return null;
    }
  }, [data, pageState, presentation]);
  const selectorLegend = effectivePresentation?.source === "preset" || effectivePresentation?.source === "ai"
    ? "自定义叠加（操作后接管）"
    : "选择叠加指标";

  const periodOptions = useMemo(
    () => (data && data.status === "ready" ? [...data.periods].reverse() : []),
    [data],
  );
  const activePeriodEnd = useMemo(() => {
    if (selectedPeriodEnd && periodOptions.some((period) => period.periodEnd === selectedPeriodEnd)) {
      return selectedPeriodEnd;
    }
    return periodOptions[0]?.periodEnd ?? null;
  }, [periodOptions, selectedPeriodEnd]);
  const snapshotRowsA = useMemo(
    () => (data && data.status === "ready" && activePeriodEnd ? buildSnapshotRows(data, activePeriodEnd, SNAPSHOT_METRICS_A) : []),
    [data, activePeriodEnd],
  );
  const snapshotRowsB = useMemo(
    () => (data && data.status === "ready" && activePeriodEnd ? buildSnapshotRows(data, activePeriodEnd, SNAPSHOT_METRICS_B) : []),
    [data, activePeriodEnd],
  );

  useEffect(() => {
    if (!selectorOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    selectorDialogRef.current?.querySelector<HTMLElement>("[data-bottom-sheet-initial-focus]")?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [selectorOpen]);

  const closeSelector = () => {
    setSelectorOpen(false);
    window.requestAnimationFrame(() => {
      selectorTriggerRef.current?.focus();
      chartRef.current?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
    });
  };

  const handleDialogKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeSelector();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...(selectorDialogRef.current?.querySelectorAll<HTMLElement>(
      "button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex='-1'])",
    ) ?? [])];
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <section className="fundamentals-workbench" aria-labelledby="fundamentals-heading">
      {/* One header line carries the section name, the period being read and the
          table/chart switch, so both views open on the same baseline instead of
          each bringing its own toolbar. */}
      <header className="fundamentals-workbench__header">
        <div className="fundamentals-workbench__title">
          <h2 id="fundamentals-heading">基本面</h2>
          {viewMode === "table" && periodOptions.length > 0 ? (
            <label className="fundamentals-workbench__period-select">
              <span className="sr-only">报告期</span>
              <select
                className="fundamentals-workbench__quarter-select"
                aria-label="选择报告期"
                value={activePeriodEnd ?? ""}
                onChange={(event) => setSelectedPeriodEnd(event.currentTarget.value)}
              >
                {periodOptions.map((period) => (
                  <option value={period.periodEnd} key={period.periodEnd}>{formatFundamentalPeriod(period.periodEnd)}</option>
                ))}
              </select>
            </label>
          ) : null}
          <span className="fundamentals-workbench__eyebrow">Yahoo Finance · 季度数据</span>
        </div>
        <div className="fundamentals-workbench__header-actions">
          <div className="fundamentals-workbench__status-group">
            <PresentationStatus presentation={effectivePresentation} />
            <RequestStatus requestState={requestState} data={data} error={error} />
          </div>
          <div className="fundamentals-workbench__view-toggle" role="group" aria-label="表格或图表视图">
            <button type="button" aria-pressed={viewMode === "table"} onClick={() => setViewMode("table")}>表格</button>
            <button type="button" aria-pressed={viewMode === "chart"} onClick={() => setViewMode("chart")}>图表</button>
          </div>
        </div>
      </header>

      <div className="fundamentals-workbench__frame">
      {viewMode === "table" ? (
        <div className="fundamentals-workbench__table" role="table" aria-label="基本面快照">
          <SnapshotColumn rows={snapshotRowsA} />
          <SnapshotColumn rows={snapshotRowsB} />
          {snapshotRowsA.length === 0 && snapshotRowsB.length === 0 && (
            <p className="fundamentals-workbench__table-empty">暂无该报告期的基本面数据。</p>
          )}
        </div>
      ) : (
        <>
          <div className="fundamentals-workbench__toolbar" aria-label="图表显示设置">
            <div className="fundamentals-workbench__mode" role="radiogroup" aria-label="图表类型">
              {CHART_MODES.map((mode) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={pageState.chart === mode.value}
                  data-active={pageState.chart === mode.value ? "true" : "false"}
                  key={mode.value}
                  onClick={() => onChartChange(mode.value)}
                >
                  {mode.label}
                </button>
              ))}
            </div>
            <label className="fundamentals-workbench__period-control">
              <span>报告期</span>
              <select
                aria-label="显示季度数"
                value={pageState.periodCount}
                onChange={(event) => onPeriodCountChange(Number(event.currentTarget.value))}
              >
                {FUNDAMENTAL_PAGE_PERIOD_OPTIONS.map((periodCount) => (
                  <option value={periodCount} key={periodCount}>{periodCount} 季度</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="fundamentals-workbench__mobile-selector-trigger"
              ref={selectorTriggerRef}
              aria-haspopup="dialog"
              aria-expanded={selectorOpen}
              onClick={() => setSelectorOpen(true)}
            >
              指标 <span>{pageState.metricKeys.length}</span>
            </button>
          </div>

          <div className="fundamentals-workbench__grid">
            <aside className="fundamentals-workbench__selector" aria-label="基本面指标">
              {data?.series.length ? (
                <MetricSelector
                  id="desktop-fundamental-metrics"
                  availableSeries={data.series}
                  selectedMetricKeys={pageState.metricKeys}
                  onChange={onMetricKeysChange}
                  minSelection={1}
                  legend={selectorLegend}
                />
              ) : <SelectorPlaceholder />}
            </aside>
            <div className="fundamentals-workbench__chart" ref={chartRef} tabIndex={-1}>
              <ChartPanel
                data={data}
                error={error}
                requestState={requestState}
                chart={pageState.chart}
                seriesSpecs={seriesSpecs}
                presentation={effectivePresentation}
                onRetry={onRetry}
              />
            </div>
          </div>
        </>
      )}
      </div>

      {selectorOpen ? (
        <div className="fundamentals-bottom-sheet" data-state="open">
          <button
            type="button"
            className="fundamentals-bottom-sheet__backdrop"
            aria-label="关闭指标选择"
            onClick={closeSelector}
          />
          <div
            className="fundamentals-bottom-sheet__dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="fundamentals-selector-title"
            ref={selectorDialogRef}
            onKeyDown={handleDialogKeyDown}
          >
            <header>
              <div>
                <span>图表设置</span>
                <h3 id="fundamentals-selector-title">叠加指标</h3>
              </div>
              <button type="button" data-bottom-sheet-initial-focus onClick={closeSelector}>完成</button>
            </header>
            {data?.series.length ? (
              <MetricSelector
                id="mobile-fundamental-metrics"
                availableSeries={data.series}
                selectedMetricKeys={pageState.metricKeys}
                onChange={onMetricKeysChange}
                minSelection={1}
                legend={selectorLegend}
              />
            ) : <SelectorPlaceholder />}
          </div>
        </div>
      ) : null}
    </section>
  );
}

type SnapshotRow = {
  key: FundamentalMetricKey;
  label: string;
  value: string;
  qoq: string;
  qoqDown: boolean;
  yoy: string;
  yoyDown: boolean;
};

function SnapshotColumn({ rows }: { rows: SnapshotRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="fundamentals-workbench__table-col">
      <div className="fundamentals-workbench__table-col-head">
        <span>指标</span><span>本期</span><span>环比</span><span>同比</span>
      </div>
      {rows.map((row) => (
        <dl className="fundamentals-workbench__table-row" key={row.key}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
          <dd data-delta={row.qoqDown ? "down" : undefined}>{row.qoq}</dd>
          <dd data-delta={row.yoyDown ? "down" : undefined}>{row.yoy}</dd>
        </dl>
      ))}
    </div>
  );
}

function buildSnapshotRows(
  data: PublicFundamentalsResponse,
  periodEnd: string,
  metricKeys: readonly FundamentalMetricKey[],
): SnapshotRow[] {
  const periodIndex = data.periods.findIndex((period) => period.periodEnd === periodEnd);
  if (periodIndex < 0) return [];
  const rows: SnapshotRow[] = [];
  for (const metricKey of metricKeys) {
    const series = data.series.find((candidate) => candidate.metricKey === metricKey);
    if (!series || !series.available) continue;
    const isPercent = series.unitFamily === "percent";
    const qoqTransform: FundamentalTransform = isPercent ? "qoq_change" : "qoq_growth";
    const yoyTransform: FundamentalTransform = isPercent ? "yoy_change" : "yoy_growth";
    try {
      const model = buildFundamentalChartModel(data.periods, data.series, [
        { metricKey, transform: "value" },
        { metricKey, transform: qoqTransform },
        { metricKey, transform: yoyTransform },
      ]);
      const [valueSeries, qoqSeries, yoySeries] = model.series;
      const valuePoint = valueSeries?.points[periodIndex] ?? null;
      const qoqValue = qoqSeries?.points[periodIndex]?.value ?? null;
      const yoyValue = yoySeries?.points[periodIndex]?.value ?? null;
      rows.push({
        key: metricKey,
        label: series.shortLabel,
        value: valueSeries ? formatFundamentalChartValue(valuePoint?.value ?? null, valueSeries) : "暂无数据",
        qoq: formatDelta(qoqValue, isPercent ? "pt" : "%"),
        qoqDown: (qoqValue ?? 0) < 0,
        yoy: formatDelta(yoyValue, isPercent ? "pt" : "%"),
        yoyDown: (yoyValue ?? 0) < 0,
      });
    } catch {
      continue;
    }
  }
  return rows;
}

function formatDelta(value: number | null, unitSuffix: "%" | "pt"): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 }).format(value)}${unitSuffix}`;
}

function ChartPanel({
  data,
  error,
  requestState,
  chart,
  seriesSpecs,
  presentation,
  onRetry,
}: {
  data: PublicFundamentalsResponse | null;
  error: string | null;
  requestState: FundamentalsRequestState;
  chart: FundamentalChartMode;
  seriesSpecs: { metricKey: FundamentalMetricKey }[];
  presentation: ResolvedFundamentalPresentation | null;
  onRetry(): void;
}) {
  if (!data && requestState === "error") {
    return (
      <div className="fundamentals-workbench__request-message" role="alert">
        <span>基本面数据暂时不可用</span>
        <p>{error ?? "请稍后重试。SEC 文件仍可在右侧独立查看。"}</p>
        <button type="button" onClick={onRetry}>重新获取</button>
      </div>
    );
  }
  if (!data) return <ChartSkeleton />;
  if (data.status === "pending" && requestState === "error") {
    return (
      <div className="fundamentals-workbench__request-message" role="alert">
        <span>基本面同步未完成</span>
        <p>{error ?? "请稍后重试。SEC 文件仍可在右侧独立查看。"}</p>
        <button type="button" onClick={onRetry}>重新获取</button>
      </div>
    );
  }

  if (presentation && data.status === "ready") {
    // A plan carries exactly one chart, so this reads the chart instead of mapping
    // a list the type no longer allows to grow.
    const [plannedChart] = presentation.plan.charts;
    return (
      <div
        className="fundamentals-workbench__chart-stack"
        data-presentation-source={presentation.source}
        data-company-classification={presentation.profile.classification}
      >
        <FundamentalComboChart
          title={plannedChart.title}
          description={plannedChart.insight}
          data={sliceFundamentalsForChart(data, plannedChart.periodCount)}
          series={plannedChart.series}
        />
      </div>
    );
  }

  const props = {
    title: "季度基本面叠加图",
    description: "按报告期末对齐；不同颜色代表不同指标，单位不兼容时自动使用左右双轴。",
    data,
    series: seriesSpecs,
  };
  if (chart === "bar") return <FundamentalBarChart {...props} />;
  if (chart === "line") return <FundamentalLineChart {...props} />;
  return <FundamentalComboChart {...props} />;
}

function PresentationStatus({
  presentation,
}: {
  presentation: ResolvedFundamentalPresentation | null;
}) {
  if (!presentation) return null;
  const labels: Record<ResolvedFundamentalPresentation["source"], string> = {
    preset: "规则预设",
    ai: "AI 方案",
    url: "链接视图",
    user: "自定义",
  };
  const rejectedAi = presentation.rejectedAiIssues.length > 0;
  return (
    <span
      className="fundamentals-workbench__presentation-status"
      data-source={presentation.source}
      data-tone={rejectedAi ? "warning" : undefined}
      title={rejectedAi ? `AI 方案未通过校验：${presentation.rejectedAiIssues[0]?.message ?? "未知原因"}` : undefined}
    >
      {rejectedAi ? "AI 已回退 · " : ""}{labels[presentation.source]} · {presentation.plan.charts.length} 图
    </span>
  );
}

function RequestStatus({
  requestState,
  data,
  error,
}: {
  requestState: FundamentalsRequestState;
  data: PublicFundamentalsResponse | null;
  error: string | null;
}) {
  if (requestState === "loading") return <span className="fundamentals-workbench__request-status">载入中</span>;
  if (requestState === "refreshing" && data?.status === "pending") {
    return <span className="fundamentals-workbench__request-status">同步中</span>;
  }
  if (requestState === "refreshing") return <span className="fundamentals-workbench__request-status">更新中</span>;
  if (error && data?.status === "ready") return <span className="fundamentals-workbench__request-status" data-tone="warning">刷新失败 · 显示上次结果</span>;
  if (requestState === "error") return <span className="fundamentals-workbench__request-status" data-tone="warning">获取失败</span>;
  if (data?.status === "pending") return <span className="fundamentals-workbench__request-status">同步中</span>;
  return <span className="fundamentals-workbench__request-status" data-tone="ready">已连接</span>;
}

function ChartSkeleton() {
  return (
    <div className="fundamentals-workbench__skeleton" role="status">
      <span className="sr-only">正在载入基本面趋势</span>
      <div />
      <div />
      <div />
      <div />
    </div>
  );
}

function SelectorPlaceholder() {
  return (
    <div className="fundamentals-workbench__selector-placeholder" aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
    </div>
  );
}

function sameMetricKeys(left: readonly FundamentalMetricKey[], right: readonly FundamentalMetricKey[]) {
  return left.length === right.length && left.every((metricKey, index) => metricKey === right[index]);
}

function waitForFundamentalsPoll(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const handleAbort = () => {
      window.clearTimeout(timeout);
      reject(signal.reason);
    };
    const timeout = window.setTimeout(() => {
      signal.removeEventListener("abort", handleAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", handleAbort, { once: true });
  });
}

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}
