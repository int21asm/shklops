// Amounts are integer agorot. This is a single-month cash-flow scenario,
// independent of the current bank balance and of other selected months.
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

export function cardForecastForMonth(accounts, month, unavailableCards = false, transactions = []) {
  const monthKey = month.slice(0, 7);
  let amount = 0;
  let futureAmount = 0;
  let exactAccounts = 0;
  const dates = [];
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
      continue;
    }
    const posted = cardTransactions.filter(
      (tx) => tx.account_id === account.id && tx.processed_date?.slice(0, 7) === monthKey,
    );
    const signedTotal = [...posted, ...projected.filter((tx) => tx.account_id === account.id)]
      .reduce((sum, tx) => sum + tx.amount, 0);
    amount -= signedTotal;
    futureAmount -= signedTotal;
  }
  const complete = !unavailableCards && accounts.length > 0 && exactAccounts === accounts.length;
  return {
    amount,
    source: complete ? "scheduled" : "partial",
    dates: dates.sort(),
    knownFuture: futureAmount !== 0,
  };
}
