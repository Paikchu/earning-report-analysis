import securities from "./securities.json" with { type: "json" };
export function findSecurity(ticker: string) { return securities.find(item => item.symbol === ticker.trim().toUpperCase()) ?? null; }
