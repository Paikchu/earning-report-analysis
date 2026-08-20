export type TradingViewChart = {
  symbol: string;
  label: string;
  description: string;
};

export const EQUITY_CHARTS: TradingViewChart[] = [
  { symbol: "AMEX:SPY", label: "SPY", description: "标普 500 ETF" },
  { symbol: "NASDAQ:QQQ", label: "QQQ", description: "纳斯达克 100 ETF" },
  { symbol: "AMEX:IWM", label: "IWM", description: "罗素 2000 ETF" },
];

export const BOND_CHARTS: TradingViewChart[] = [
  { symbol: "NASDAQ:SHY", label: "SHY", description: "1–3 年美债 ETF" },
  { symbol: "NASDAQ:IEF", label: "IEF", description: "7–10 年美债 ETF" },
  { symbol: "NASDAQ:TLT", label: "TLT", description: "20 年以上美债 ETF" },
];

const symbols = new Set([...EQUITY_CHARTS, ...BOND_CHARTS].map((item) => item.symbol));

export function buildTradingViewConfig(symbol: string) {
  if (!symbols.has(symbol)) throw new Error(`不支持的 TradingView symbol：${symbol}`);
  return {
    autosize: true,
    symbol,
    interval: "D",
    range: "12M",
    timezone: "exchange",
    theme: "light",
    backgroundColor: "rgba(243, 236, 223, 1)",
    gridColor: "rgba(23, 40, 59, 0.08)",
    style: "1",
    withdateranges: true,
    hide_side_toolbar: true,
    hide_top_toolbar: false,
    allow_symbol_change: false,
    save_image: false,
    studies: ["MASimple@tv-basicstudies", "StochasticRSI@tv-basicstudies", "ROC@tv-basicstudies"],
    locale: "zh_CN",
    calendar: false,
    details: false,
    hotlist: false,
    support_host: "https://www.tradingview.com",
  } as const;
}

export function tradingViewSymbolUrl(symbol: string): string {
  if (!symbols.has(symbol)) throw new Error(`不支持的 TradingView symbol：${symbol}`);
  return `https://www.tradingview.com/symbols/${symbol.replace(":", "-")}/`;
}
