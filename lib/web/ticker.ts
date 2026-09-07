export function normalizeTrackedTicker(value: string | null | undefined): string {
  const ticker = String(value ?? "").trim().toUpperCase();
  return /^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker) ? ticker : "";
}
