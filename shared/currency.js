export function normalizeCurrency(value) {
  const currency = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (
    !currency ||
    ["₪", "ILS", "NIS", "שח"].includes(currency.replace(/[\s"'״׳]/g, ""))
  )
    return "ILS";
  return currency;
}

export function formatMoney(minor = 0, currency = "ILS") {
  const code = normalizeCurrency(currency);
  const options = { maximumFractionDigits: 2, minimumFractionDigits: 0 };
  if (/^[A-Z]{3}$/.test(code))
    return new Intl.NumberFormat("he-IL", {
      ...options,
      style: "currency",
      currency: code,
    }).format(minor / 100);
  // Preserve unknown units instead of inventing an ILS conversion or throwing
  // an Intl RangeError that would unmount the entire dashboard.
  return `${new Intl.NumberFormat("he-IL", options).format(minor / 100)} ${code}`;
}
