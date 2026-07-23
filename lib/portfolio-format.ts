const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function money(value: number, sign = false) {
  const prefix = value < 0 ? "−" : sign && value > 0 ? "+" : "";
  return `${prefix}${currencyFormatter.format(Math.abs(value))}`;
}

export function percent(value: number, sign = false) {
  const prefix = value < 0 ? "−" : sign && value > 0 ? "+" : "";
  return `${prefix}${Math.abs(value).toFixed(2)}%`;
}

export function number(value: number, minimumFractionDigits = 0, maximumFractionDigits = 6) {
  const prefix = value < 0 ? "−" : "";
  return `${prefix}${new Intl.NumberFormat("en-US", {
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(Math.abs(value))}`;
}
