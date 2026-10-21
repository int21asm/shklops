export function parseShekelBalance(value) {
  if (typeof value !== "string") return null;
  let text = value
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069\s]/g, "")
    .replace(/−/g, "-");
  const parentheses = text.startsWith("(") && text.endsWith(")");
  if (parentheses) text = text.slice(1, -1);
  const match = text.match(
    /^₪?([+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)₪?$/,
  );
  if (!match || (parentheses && /^[+-]/.test(match[1]))) return null;
  const amount = Number(match[1].replaceAll(",", "")) * (parentheses ? -1 : 1);
  return Number.isFinite(amount) ? amount : null;
}

function tableDate(value) {
  const match = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match.map(Number);
  const fullYear = year < 100 ? year + 2000 : year;
  const date = new Date(Date.UTC(fullYear, month - 1, day));
  if (
    date.getUTCFullYear() !== fullYear ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return null;
  return date.toISOString().slice(0, 10);
}

export function latestTransactionBalance(rows) {
  const dated = rows
    .map((row) => ({ ...row, date: tableDate(row.date) }))
    .filter((row) => row.date);
  if (!dated.length) return null;
  const latest = dated.reduce(
    (date, row) => (row.date > date ? row.date : date),
    dated[0].date,
  );
  const candidates = dated.filter((row) => row.date === latest);
  const ascending = dated[0].date < dated.at(-1).date;
  const descending = dated[0].date > dated.at(-1).date;
  // A single day's rows with no known ordering cannot establish its closing
  // balance unless they all agree. Never guess among different balances.
  if (
    !ascending &&
    !descending &&
    new Set(candidates.map((row) => parseShekelBalance(row.balance))).size > 1
  )
    return null;
  const row = ascending ? candidates.at(-1) : candidates[0];
  const balance = parseShekelBalance(row.balance);
  return balance === null ? null : { balance, balanceDate: latest };
}

export async function readMizrahiBalance(page) {
  let latest = null;
  for (const frame of page.frames()) {
    if (
      frame !== page.mainFrame() &&
      !/^https:\/\/mto\.mizrahi-tefahot\.co\.il\//.test(frame.url())
    )
      continue;
    let content;
    try {
      content = await frame.evaluate(() => {
        const normalize = (value) => (value || "").replace(/[\s"'״׳₪]/g, "");
        const headers = [...document.querySelectorAll(".balance .thin")]
          .filter((label) => normalize(label.textContent) === "יתרתעוש")
          .map(
            (label) =>
              label.parentElement.querySelector("h6")?.textContent || "",
          );
        const tables = [];
        for (const table of document.querySelectorAll("table")) {
          const headings = [...table.querySelectorAll("th")].filter(
            (cell) => cell.closest("table") === table,
          );
          const dateColumn = headings.findIndex(
            (cell) => normalize(cell.textContent) === "תאריך",
          );
          const balanceColumn = headings.findIndex((cell) =>
            /^יתרה(?:ב?שח)?$/.test(normalize(cell.textContent)),
          );
          if (dateColumn < 0 || balanceColumn < 0) continue;
          tables.push(
            [...table.querySelectorAll("tr")]
              .filter((row) => row.closest("table") === table)
              .map((row) => ({
                date: row.cells[dateColumn]?.textContent?.trim() || "",
                balance: row.cells[balanceColumn]?.textContent?.trim() || "",
              })),
          );
        }
        return { headers, tables };
      });
    } catch {
      continue; // A detached optional frame must not discard valid transactions.
    }
    for (const text of content.headers) {
      const balance = parseShekelBalance(text);
      if (balance !== null) return { balance };
    }
    for (const rows of content.tables) {
      const candidate = latestTransactionBalance(rows);
      if (candidate && (!latest || candidate.balanceDate > latest.balanceDate))
        latest = candidate;
    }
  }
  return latest;
}

export function addMizrahiBalanceFallback(
  scraper,
  readBalance = readMizrahiBalance,
) {
  // These methods belong to the pinned scraper version. Capture the account's
  // balance before its pending-transactions navigation leaves the ledger page.
  const fetchAccount = scraper.fetchAccount;
  const getPendingTransactions = scraper.getPendingTransactions;
  if (
    typeof fetchAccount !== "function" ||
    typeof getPendingTransactions !== "function"
  )
    throw new Error("Unsupported Mizrahi scraper version");
  scraper.fetchAccount = async function (...args) {
    let fallback = null;
    this.getPendingTransactions = async function (...pendingArgs) {
      try {
        fallback = await readBalance(this.page);
      } catch {
        /* Keep missing balances unavailable. */
      }
      return getPendingTransactions.apply(this, pendingArgs);
    };
    try {
      const account = await fetchAccount.apply(this, args);
      return Number.isFinite(account.balance) ||
        !Number.isFinite(fallback?.balance)
        ? account
        : { ...account, ...fallback };
    } finally {
      this.getPendingTransactions = getPendingTransactions;
    }
  };
  return scraper;
}
