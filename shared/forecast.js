// Amounts are integer agorot. This is a single-month cash-flow scenario,
// independent of other selected months.
export function monthlyCashflow({ income, mortgage, cardPayments, cardComplete }) {
  if (!Number.isFinite(income) || !Number.isFinite(mortgage))
    return { amount: null, partial: !cardComplete };
  if (!cardComplete && !cardPayments)
    return { amount: null, partial: true };
  return {
    amount: income - mortgage - (cardPayments ?? 0),
    partial: !cardComplete,
  };
}

// Each selected month starts from the latest bank balance. The monthly net
// flow is not carried forward from any earlier forecast month.
export function estimatedClosingBalance({ openingBalance, income, mortgage, cardPayments, cardComplete, bankComplete = true }) {
  const net = monthlyCashflow({ income, mortgage, cardPayments, cardComplete });
  return {
    amount: Number.isFinite(openingBalance) && net.amount !== null
      ? openingBalance + net.amount : null,
    net: net.amount,
    partial: net.partial || !bankComplete || !Number.isFinite(openingBalance),
  };
}

const mortgageDescription = /טפחות\s*[-–—־]\s*לווים/i;

// The same mortgage debit can appear twice after overlapping bank snapshots.
// Keep distinct debits, but count an identical debit on the same account and
// day only once in the recurring estimate.
export function mortgageEstimateForMonth(transactions, month) {
  const matching = transactions.filter((tx) =>
    tx.currency === "ILS" && tx.status !== "pending" && tx.amount < 0 &&
    tx.date?.slice(0, 7) === month.slice(0, 7) &&
    mortgageDescription.test(tx.description || ""));
  const seen = new Set();
  const entries = [];
  let duplicates = 0;
  for (const tx of matching) {
    const key = JSON.stringify([
      tx.account_id, tx.date, tx.amount,
      tx.description.trim().replace(/\s+/g, " "),
    ]);
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    entries.push({ date: tx.date, description: tx.description, amount: -tx.amount });
  }
  return {
    amount: entries.length ? entries.reduce((sum, entry) => sum + entry.amount, 0) : null,
    entries,
    duplicates,
  };
}

// A full next bill applies only to its dated month. Later months can include
// known future charges and the remaining payments of observed installments,
// but must stay partial because new card purchases are unknowable.
function shiftDateMonths(value, months) {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 0)).getUTCDate();
  shifted.setUTCDate(Math.min(day, lastDay));
  return shifted.toISOString().slice(0, 10);
}

export function projectedInstallmentsForMonth(transactions, month) {
  const monthKey = month.slice(0, 7);
  const latest = new Map();
  const postedGroups = new Set();
  for (const tx of transactions) {
    if (tx.status !== "completed" || !tx.account_id || !tx.installment_group ||
        !Number.isInteger(tx.installment_number) || !Number.isInteger(tx.installment_total) ||
        tx.installment_number < 1 || tx.installment_number > tx.installment_total ||
        !/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(tx.processed_date || "")) continue;
    const txMonth = tx.processed_date.slice(0, 7);
    if (txMonth > monthKey) continue;
    const key = `${tx.account_id}:${tx.installment_group}`;
    if (txMonth === monthKey) postedGroups.add(key);
    const previous = latest.get(key);
    if (!previous || tx.installment_number > previous.installment_number ||
        (tx.installment_number === previous.installment_number && tx.processed_date > previous.processed_date))
      latest.set(key, tx);
  }
  const [targetYear, targetMonth] = monthKey.split("-").map(Number);
  return [...latest].flatMap(([key, tx]) => {
    if (postedGroups.has(key)) return [];
    const [year, monthNumber] = tx.processed_date.slice(0, 7).split("-").map(Number);
    const monthsAhead = (targetYear - year) * 12 + targetMonth - monthNumber;
    const nextNumber = tx.installment_number + monthsAhead;
    if (monthsAhead <= 0 || nextNumber > tx.installment_total) return [];
    return [{
      ...tx,
      id: `projected:${key}:${monthKey}`,
      date: shiftDateMonths(tx.date || tx.processed_date, monthsAhead),
      processed_date: shiftDateMonths(tx.processed_date, monthsAhead),
      installment_number: nextNumber,
      status: "projected",
      projected: true,
      memo: null,
    }];
  });
}

// Isracard/Amex "balance" is credit-line usage, not an upcoming debit.
// Show only a dated charge returned by the scraper or a clearly partial sum
// of completed transactions for the earliest upcoming billing date.
export function nextKnownCardPayment(account, transactions, today) {
  if (
    Number.isFinite(account.next_charge) &&
    typeof account.next_charge_date === "string" &&
    account.next_charge_date >= today
  ) {
    return {
      amount: Math.max(0, account.next_charge),
      date: account.next_charge_date,
      estimated: false,
    };
  }
  const upcoming = transactions.filter(
    (tx) =>
      tx.account_id === account.id &&
      tx.status === "completed" &&
      tx.currency === account.currency &&
      Number.isFinite(tx.amount) &&
      typeof tx.processed_date === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(tx.processed_date) &&
      tx.processed_date >= today,
  );
  if (!upcoming.length) return null;
  const date = upcoming.reduce(
    (earliest, tx) =>
      tx.processed_date < earliest ? tx.processed_date : earliest,
    upcoming[0].processed_date,
  );
  const amount = upcoming
    .filter((tx) => tx.processed_date === date)
    .reduce((sum, tx) => sum - tx.amount, 0);
  return { amount: Math.max(0, amount), date, estimated: true };
}

// The dashboard lists one next debit per enabled card. A dated issuer total
// takes precedence over its component transactions, and cards without a known
// debit stay outside the sum instead of silently contributing zero.
export function upcomingCardCharges(accounts, transactions, today) {
  const cards = accounts.filter((account) => account.enabled !== false);
  const charges = cards.flatMap((account) => {
    const payment = nextKnownCardPayment(account, transactions, today);
    return payment ? [{ account, ...payment }] : [];
  }).sort((a, b) => a.date.localeCompare(b.date) ||
    String(a.account.number || "").localeCompare(String(b.account.number || "")));
  const totals = new Map();
  for (const charge of charges)
    totals.set(charge.account.currency,
      (totals.get(charge.account.currency) || 0) + charge.amount);
  return {
    charges,
    totals: [...totals].map(([currency, amount]) => ({ currency, amount })),
    unknownCount: cards.length - charges.length,
    partial: cards.length > charges.length || charges.some((charge) => charge.estimated),
  };
}

export function cardForecastForMonth(accounts, month, unavailableCards = false, transactions = []) {
  const monthKey = month.slice(0, 7);
  let amount = 0;
  let futureAmount = 0;
  let exactAccounts = 0;
  const dates = [];
  const breakdown = [];
  const accountIds = new Set(accounts.map((account) => account.id));
  const cardTransactions = transactions.filter(
    (tx) => accountIds.has(tx.account_id) && tx.currency === "ILS" && tx.status === "completed",
  );
  const projected = projectedInstallmentsForMonth(cardTransactions, monthKey);
  for (const account of accounts) {
    if (Number.isFinite(account.next_charge) && account.next_charge_date?.slice(0, 7) === monthKey) {
      amount += account.next_charge;
      dates.push(account.next_charge_date);
      exactAccounts++;
      breakdown.push({ accountId: account.id, amount: account.next_charge, source: "scheduled", date: account.next_charge_date, count: 1 });
      continue;
    }
    const posted = cardTransactions.filter(
      (tx) => tx.account_id === account.id && tx.processed_date?.slice(0, 7) === monthKey,
    );
    // The issuer's dated rows are the best available snapshot of that bill.
    // Projecting old installment rows on top of them can count purchases that
    // the issuer has already included, and can grossly inflate next month's
    // charge when installment identifiers change between monthly snapshots.
    const rows = posted.length
      ? posted
      : projected.filter((tx) => tx.account_id === account.id);
    const signedTotal = rows
      .reduce((sum, tx) => sum + tx.amount, 0);
    amount -= signedTotal;
    futureAmount -= signedTotal;
    breakdown.push({ accountId: account.id, amount: -signedTotal,
      source: posted.length ? "dated" : rows.length ? "projected" : "unknown",
      date: posted[0]?.processed_date || rows[0]?.processed_date || null,
      count: rows.length });
  }
  const complete = !unavailableCards && accounts.length > 0 && exactAccounts === accounts.length;
  return {
    amount,
    source: complete ? "scheduled" : "partial",
    dates: dates.sort(),
    knownFuture: futureAmount !== 0,
    breakdown,
  };
}
