"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type SearchResult = { symbol: string; name: string; exchange: string; type: "stock" | "etf"; isHeld: boolean };

export function AddPlanDialog() {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [directoryUpdatedAt, setDirectoryUpdatedAt] = useState("");

  useEffect(() => {
    const text = query.trim();
    if (!text) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setMessage("");
      setDirectoryUpdatedAt("");
      try {
        const response = await fetch(`/api/symbols?q=${encodeURIComponent(text)}`, { signal: controller.signal });
        if (!response.ok) throw new Error();
        const body = await response.json() as { results: SearchResult[]; directoryUpdatedAt: string };
        setResults(body.results);
        setDirectoryUpdatedAt(body.directoryUpdatedAt);
        if (body.results.length === 0) setMessage("没有找到匹配的标的，请检查 ticker 或公司名称。");
      } catch (error) {
        if ((error as Error).name !== "AbortError") setMessage("搜索暂时不可用，请稍后重试。");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query]);

  const open = () => {
    setQuery("");
    setResults([]);
    setMessage("");
    setDirectoryUpdatedAt("");
    setLoading(false);
    dialogRef.current?.showModal();
  };

  const updateQuery = (value: string) => {
    const hasQuery = Boolean(value.trim());
    setQuery(value);
    setResults([]);
    setMessage("");
    setDirectoryUpdatedAt("");
    setLoading(hasQuery);
  };

  return (
    <>
      <button className="add-plan-button" type="button" onClick={open}>＋ 添加持仓计划</button>
      <dialog className="plan-dialog" ref={dialogRef} onClick={(event) => { if (event.target === dialogRef.current) dialogRef.current?.close(); }}>
        <div className="dialog-card">
          <div className="dialog-heading"><h2>添加持仓计划</h2><button type="button" onClick={() => dialogRef.current?.close()} aria-label="关闭">×</button></div>
          <label className="search-field"><span>搜索 ticker 或公司</span><input value={query} onChange={(event) => updateQuery(event.target.value)} placeholder="AAPL / Apple" autoFocus /></label>
          <div className="search-results" aria-live="polite">
            {!query.trim() && <p className="search-help">输入美股 ticker 或公司名称，选择后进入独立详情页。</p>}
            {loading && (
              <div className="search-skeleton" aria-label="正在搜索" role="status">
                {[0, 1, 2].map((row) => <span key={row}><i /><b /></span>)}
              </div>
            )}
            {!loading && message && <p className="search-message">{message}</p>}
            {!loading && results.map((result) => (
              <button
                className="search-result"
                key={result.symbol}
                onClick={() => {
                  dialogRef.current?.close();
                  router.push(`/positions/${encodeURIComponent(result.symbol)}`);
                }}
                type="button"
              >
                <span><strong>{result.symbol}</strong><small>{result.name}</small></span>
                <span><i>{result.isHeld ? "当前持仓" : result.type === "etf" ? "ETF" : "股票"}</i><small>{result.exchange}</small></span>
              </button>
            ))}
            {!loading && directoryUpdatedAt && <p className="directory-timestamp">证券目录更新于 {new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(new Date(directoryUpdatedAt))}</p>}
          </div>
        </div>
      </dialog>
    </>
  );
}
