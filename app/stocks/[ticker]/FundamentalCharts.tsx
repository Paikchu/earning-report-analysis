"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import {
  FundamentalComboChart,
  MetricSelector,
} from "@/components/fundamentals/FundamentalChart";
import {
  limitFundamentalMetricAxes,
  reconcileFundamentalMetricSelection,
  writeFundamentalPageState,
  type FundamentalPageState,
} from "@/lib/fundamental-page-state";
import {
  resolveFundamentalPresentation,
  sliceFundamentalsForChart,
  type ResolvedFundamentalPresentation,
} from "@/lib/fundamental-chart-plan";
import {
  FUNDAMENTAL_NOT_MEANINGFUL_HINT,
  FUNDAMENTAL_NOT_MEANINGFUL_LABEL,
  buildFundamentalChartModel,
  formatFundamentalChartPoint,
  formatFundamentalPeriod,
  type FundamentalChartPoint,
} from "@/lib/fundamental-chart";
import type { FundamentalMetricKey, FundamentalTransform } from "@/lib/fundamental-metrics";
import { FUNDAMENTALS_DEFAULT_PERIOD_COUNT, type PublicFundamentalsResponse } from "@/lib/analysis-contract/fundamentals";

// The panel reads as two questions: how the quarter went, and what the market
// paid for it. Grouping keeps seventeen rows scannable in a narrow column.
const SNAPSHOT_GROUPS: readonly { title: string; metricKeys: readonly FundamentalMetricKey[] }[] = [
  {
    title: "经营",
    metricKeys: [
      "total_revenue",
      "gross_profit",
      "gross_margin",
      "operating_income",
      "operating_margin",
      "net_income",
      "operating_cash_flow",
      "diluted_eps",
    ],
  },
  {
    title: "估值",
    metricKeys: [
      "market_cap",
      "enterprise_value",
      "pe_ratio",
      "forward_pe_ratio",
      "peg_ratio",
      "price_to_sales",
      "price_to_book",
      "ev_to_revenue",
      "ev_to_ebitda",
    ],
  },
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
  onRetry(): void;
};

const FUNDAMENTALS_PENDING_POLL_DELAYS_MS = [1_000, 2_000, 4_000, 8_000] as const;
/** Matches the width at which the metric picker becomes a full-screen sheet. */
const FUNDAMENTALS_SHEET_LAYOUT_QUERY = "(max-width: 700px)";

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
      periodCount: FUNDAMENTALS_DEFAULT_PERIOD_COUNT,
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
          `/api/v1/companies/${encodeURIComponent(ticker)}/fundamentals?periodCount=${FUNDAMENTALS_DEFAULT_PERIOD_COUNT}`,
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
  }, [retryVersion, ticker]);

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
  onRetry,
}: FundamentalChartsViewProps) {
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
          periodCount: FUNDAMENTALS_DEFAULT_PERIOD_COUNT,
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
  const snapshotGroups = useMemo(
    () => (data && data.status === "ready" && activePeriodEnd
      ? SNAPSHOT_GROUPS
        .map((group) => ({ title: group.title, rows: buildSnapshotRows(data, activePeriodEnd, group.metricKeys) }))
        .filter((group) => group.rows.length > 0)
      : []),
    [data, activePeriodEnd],
  );

  useEffect(() => {
    if (!selectorOpen) return;
    const dialog = selectorDialogRef.current;
    // The close button is the natural first stop, but it only exists in the
    // sheet layout; anchored as a dropdown the first checkbox takes the focus.
    const initialFocus = dialog?.querySelector<HTMLElement>("[data-bottom-sheet-initial-focus]");
    (initialFocus?.offsetParent ? initialFocus : dialog?.querySelector<HTMLElement>("input:not([disabled])"))?.focus();

    // Only the full-screen sheet layout takes the page's scroll; a dropdown
    // anchored to its trigger scrolls inside itself.
    if (!window.matchMedia(FUNDAMENTALS_SHEET_LAYOUT_QUERY).matches) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [selectorOpen]);

  const closeSelector = () => {
    // Focus moves back before React unmounts the panel; deferring it to a frame
    // loses focus to the body whenever the page is not compositing.
    selectorTriggerRef.current?.focus();
    setSelectorOpen(false);
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
      {/* Chart and snapshot sit side by side and read as one instrument: the
          chart picks a quarter, the panel beside it spells that quarter out.
          Nothing alternates any more, so the header carries only the section
          name and the request state. */}
      <header className="fundamentals-workbench__header">
        <div className="fundamentals-workbench__title">
          <h2 id="fundamentals-heading">基本面</h2>
        </div>
        <div className="fundamentals-workbench__header-actions">
          <RequestStatus requestState={requestState} data={data} error={error} />
        </div>
      </header>

      <div className="fundamentals-workbench__frame">
        <div className="fundamentals-workbench__toolbar" data-view="chart" aria-label="图表显示设置">
          {/* One control, not a wall of checkboxes: the picker names what is on
              the chart and opens the full list on demand. */}
          <div className="fundamentals-workbench__metric-picker">
            <button
              type="button"
              className="fundamentals-workbench__metric-trigger"
              ref={selectorTriggerRef}
              aria-haspopup="dialog"
              aria-expanded={selectorOpen}
              onClick={() => (selectorOpen ? closeSelector() : setSelectorOpen(true))}
            >
              叠加指标 <span>{summariseMetricSelection(selectedSeries)}</span>
            </button>
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
                      id="fundamental-metrics"
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
          </div>
        </div>

        <div className="fundamentals-workbench__split">
          <div className="fundamentals-workbench__chart" ref={chartRef} tabIndex={-1}>
            <ChartPanel
              data={data}
              error={error}
              requestState={requestState}
              seriesSpecs={seriesSpecs}
              presentation={effectivePresentation}
              selectedPeriodEnd={activePeriodEnd}
              onSelectPeriod={setSelectedPeriodEnd}
              onRetry={onRetry}
            />
          </div>
          <SnapshotPanel periodEnd={activePeriodEnd} groups={snapshotGroups} />
        </div>
      </div>

    </section>
  );
}

/**
 * 一格增速：显示什么、要不要展开解释、用哪种颜色。「—」和「NM」都不是数字，
 * 因此都不该沿用涨跌的绿红。
 */
type SnapshotDelta = {
  text: string;
  hint: string | null;
  tone: "down" | "muted" | undefined;
};

type SnapshotRow = {
  key: FundamentalMetricKey;
  label: string;
  value: string;
  qoq: SnapshotDelta;
  yoy: SnapshotDelta;
};

/**
 * The quarter the chart has picked, spelled out. Its heading names the period
 * so the panel still says what it is once the reader scrolls the chart away on
 * a narrow screen, where the two stack instead of sitting side by side.
 */
function SnapshotPanel({
  periodEnd,
  groups,
}: {
  periodEnd: string | null;
  groups: { title: string; rows: SnapshotRow[] }[];
}) {
  return (
    <section className="fundamentals-workbench__snapshot" aria-labelledby="fundamentals-snapshot-heading">
      <header className="fundamentals-workbench__snapshot-head">
        <h3 id="fundamentals-snapshot-heading">{periodEnd ? formatFundamentalPeriod(periodEnd) : "季度快照"}</h3>
        <p>点击图中任一季度可切换</p>
      </header>
      <div className="fundamentals-workbench__table" role="table" aria-label="基本面快照">
        {groups.length === 0
          ? <p className="fundamentals-workbench__table-empty">暂无该报告期的基本面数据。</p>
          : groups.map((group) => (
            <div className="fundamentals-workbench__table-col" key={group.title}>
              <div className="fundamentals-workbench__table-col-head">
                <span>{group.title}</span><span>本期</span><span>环比</span><span>同比</span>
              </div>
              {group.rows.map((row) => (
                <dl className="fundamentals-workbench__table-row" key={row.key}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                  <DeltaCell delta={row.qoq} />
                  <DeltaCell delta={row.yoy} />
                </dl>
              ))}
            </div>
          ))}
      </div>
    </section>
  );
}

/**
 * 缩写自己解释自己：<abbr> 让 NM 在悬停和读屏里都能展开成整句，而列宽只用付两个字母。
 */
function DeltaCell({ delta }: { delta: SnapshotDelta }) {
  return (
    <dd data-delta={delta.tone}>
      {delta.hint === null ? delta.text : <abbr title={delta.hint}>{delta.text}</abbr>}
    </dd>
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
      const unitSuffix = isPercent ? "pt" : "%";
      rows.push({
        key: metricKey,
        label: series.shortLabel,
        value: valueSeries ? formatFundamentalChartPoint(valuePoint, valueSeries) : "暂无数据",
        qoq: buildSnapshotDelta(qoqSeries?.points[periodIndex] ?? null, unitSuffix),
        yoy: buildSnapshotDelta(yoySeries?.points[periodIndex] ?? null, unitSuffix),
      });
    } catch {
      continue;
    }
  }
  return rows;
}

function buildSnapshotDelta(
  point: FundamentalChartPoint | null,
  unitSuffix: "%" | "pt",
): SnapshotDelta {
  // 基数为零或为负时算不出有意义的增速——扭亏为盈是好消息，和「这个季度缺数据」
  // 不该在同一列里长成同一个破折号，所以这里只让缺数据留破折号。
  if (point?.unavailableReason === "not_meaningful") {
    return {
      text: FUNDAMENTAL_NOT_MEANINGFUL_LABEL,
      hint: FUNDAMENTAL_NOT_MEANINGFUL_HINT,
      tone: "muted",
    };
  }
  const value = point?.value ?? null;
  if (value === null || !Number.isFinite(value)) return { text: "—", hint: null, tone: "muted" };
  const sign = value > 0 ? "+" : "";
  return {
    text: `${sign}${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 }).format(value)}${unitSuffix}`,
    hint: null,
    tone: value < 0 ? "down" : undefined,
  };
}

function ChartPanel({
  data,
  error,
  requestState,
  seriesSpecs,
  presentation,
  selectedPeriodEnd,
  onSelectPeriod,
  onRetry,
}: {
  data: PublicFundamentalsResponse | null;
  error: string | null;
  requestState: FundamentalsRequestState;
  seriesSpecs: { metricKey: FundamentalMetricKey }[];
  presentation: ResolvedFundamentalPresentation | null;
  selectedPeriodEnd: string | null;
  onSelectPeriod(periodEnd: string): void;
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
          selectedPeriodEnd={selectedPeriodEnd}
          onSelectPeriod={onSelectPeriod}
        />
      </div>
    );
  }

  // Every series draws with the mark its metric declares in the catalog, so the
  // fallback path is the same combo renderer the planned charts use.
  return (
    <FundamentalComboChart
      title="季度基本面叠加图"
      description="按报告期末对齐；不同颜色代表不同指标，单位不兼容时自动使用左右双轴。"
      data={data}
      series={seriesSpecs}
      selectedPeriodEnd={selectedPeriodEnd}
      onSelectPeriod={onSelectPeriod}
    />
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
  // A settled, healthy request says nothing: the chart itself is the evidence.
  return null;
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

/** Names the selection when it is short enough to read, counts it when it is not. */
function summariseMetricSelection(series: readonly { shortLabel: string }[]): string {
  if (series.length === 0) return "未选择";
  if (series.length <= 2) return series.map((item) => item.shortLabel).join("、");
  return `${series[0]!.shortLabel} 等 ${series.length} 项`;
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

