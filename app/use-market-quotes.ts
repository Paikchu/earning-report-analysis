"use client";

import { useEffect, useState } from "react";

import type { MarketQuoteMap } from "@/lib/yahoo-quotes";

export type QuoteLoadStatus = "loading" | "ready" | "unavailable";

export function useMarketQuotes(symbols: string, enabled = true) {
  const [quotes, setQuotes] = useState<MarketQuoteMap>({});
  const [status, setStatus] = useState<QuoteLoadStatus>("loading");

  useEffect(() => {
    if (!enabled || !symbols) return;
    const controller = new AbortController();

    void (async () => {
      try {
        const response = await fetch(`/api/quotes?symbols=${encodeURIComponent(symbols)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error();
        const body = await response.json() as { quotes: MarketQuoteMap };
        setQuotes(body.quotes);
        setStatus("ready");
      } catch (error) {
        if ((error as Error).name !== "AbortError") setStatus("unavailable");
      }
    })();

    return () => controller.abort();
  }, [enabled, symbols]);

  return { quotes, status };
}
