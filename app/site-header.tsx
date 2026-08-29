"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import type { SecurityType } from "@/lib/symbol-directory";

type SearchResult = { symbol: string; name: string; exchange: string; type: SecurityType };

export function SiteHeader({ initialQuery = "" }: { initialQuery?: string }) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searchActive, setSearchActive] = useState(false);

  useEffect(() => {
    const value = query.trim();
    if (!value || !searchActive) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      const response = await fetch(`/api/v1/search?q=${encodeURIComponent(value)}`, { signal: controller.signal });
      if (response.ok) setResults((await response.json() as { results?: SearchResult[] }).results ?? []);
    }, 120);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, searchActive]);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const match = results[0];
    const ticker = (match?.symbol ?? query.trim()).toUpperCase().replace(/[^A-Z0-9.-]/g, "");
    if (ticker) {
      setResults([]);
      setSearchActive(false);
      router.push(`/stocks/${encodeURIComponent(ticker)}`);
    }
  }

  return (
    <header className="site-header sec-site-header">
      <form className="sec-search-form" onSubmit={submit} role="search">
        <label className="sr-only" htmlFor="sec-company-search">搜索股票代码或公司名称</label>
        <span className="sec-search-icon" aria-hidden="true">⌕</span>
        <input
          id="sec-company-search"
          autoComplete="off"
          value={query}
          onChange={(event) => {
            const nextQuery = event.target.value;
            setQuery(nextQuery);
            setSearchActive(true);
            if (!nextQuery.trim()) setResults([]);
          }}
          placeholder="搜索股票代码或公司名称"
        />
        <kbd>↵</kbd>
        {searchActive && results.length > 0 && (
          <div className="sec-search-results" role="listbox">
            {results.map((result) => (
              <button type="button" key={result.symbol} onClick={() => {
                setQuery(result.symbol);
                setResults([]);
                setSearchActive(false);
                router.push(`/stocks/${encodeURIComponent(result.symbol)}`);
              }}>
                <strong>{result.symbol}</strong><span>{result.name}</span>
              </button>
            ))}
          </div>
        )}
      </form>
    </header>
  );
}
