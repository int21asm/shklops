const dayMs = 86400000;
const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
const serial = (date) => Date.parse(`${date}T12:00:00Z`);
const dayDistance = (left, right) => Math.round((serial(left) - serial(right)) / dayMs);
const normalize = (description) => String(description || "").normalize("NFKC").toLowerCase()
  .replace(/\b(?:[a-z]*\d[a-z\d]{6,}|order\s+\d+|cc\d{6,})\b/gi, " ")
  .replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
const knownService = /(?:openai|chatgpt|anthropic|claude|cursor|lovable|netflix|spotify|youtube|google one|google cloud|icloud|apple music|apple com bill|microsoft|adobe|dropbox|github|dynadot|namecheap|freetv|free tv|פרי\s*טי?\s*וי|פריטיוי|פרטנר|סלקום|פלאפון|בזק|הוט|yes|חברת החשמל|ארנונה|ביטוח|הפניקס|מנורה מבטחים)/iu;
const categoryHint = new Set(["מנויים", "בית וחשבונות", "ביטוח ופיננסים"]);
const excluded = /(?:טפחות\s*[-–—־]?\s*לווים|משכנת|הלווא|שכר דירה|העברה|משיכת מזומ|\bbit\b|\bpaybox\b)/iu;
const bankSettlement = /(?:ישראכרט|כרטיס|ויזה|כאל|לאומי קארד|מקס איט|\bmax\b|\bamex\b|אמריקן אקספרס)/iu;
const installmentMemo = /(?:תשלום|תשלומים)\s*\d+\s*(?:מתוך|\/|מ־|מ-)/u;

function shiftMonths(date, count) {
  const [year, month, day] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + count, 1, 12));
  const lastDay = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 0)).getUTCDate();
  shifted.setUTCDate(Math.min(day, lastDay));
  return shifted.toISOString().slice(0, 10);
}

function cadence(rows, strong) {
  const possibilities = [1, 2, 12].flatMap((months) => {
    let first = rows.length - 1;
    while (first > 0 && Math.abs(dayDistance(rows[first].date, shiftMonths(rows[first - 1].date, months))) <= 9) first--;
    const evidence = rows.slice(first);
    const minimum = months === 12 || strong ? 2 : 3;
    return evidence.length >= minimum ? [{ months, evidence }] : [];
  });
  return possibilities.sort((a, b) => b.evidence.length - a.evidence.length || a.months - b.months)[0];
}

// Local, read-only detection. Use purchase dates to find a merchant's renewal
// cadence rather than the card's shared monthly settlement date. Amounts are minor units.
export function recurringPayments(transactions, accounts, providers, today) {
  const selected = new Map(accounts.filter((account) => account.enabled !== false && account.enabled !== 0).map((account) => [account.id, account]));
  const groups = new Map(), seen = new Set();
  for (const tx of transactions) {
    const account = selected.get(tx.account_id);
    const kind = providers[tx.provider || account?.provider]?.kind;
    const date = tx.date || tx.processed_date;
    if (!account || !["bank", "card"].includes(kind) || tx.status !== "completed" || tx.projected ||
        !Number.isFinite(tx.amount) || tx.amount >= 0 || !dateOnly.test(date || "") ||
        !Number.isFinite(serial(date)) || date > today ||
        tx.installment_total > 1 || tx.installment_number > 1 || tx.installment_group ||
        installmentMemo.test(tx.memo || "") || installmentMemo.test(tx.description || "") ||
        excluded.test(tx.description || "") || (kind === "bank" && bankSettlement.test(tx.description || ""))) continue;
    if (tx.id && seen.has(tx.id)) continue;
    if (tx.id) seen.add(tx.id);
    const merchant = normalize(tx.description);
    if (!merchant) continue;
    const strong = knownService.test(merchant);
    if (!strong && !categoryHint.has(tx.category)) continue;
    const key = JSON.stringify([account.id, tx.currency, merchant]);
    if (!groups.has(key)) groups.set(key, { key, merchant, account, strong, rows: [] });
    groups.get(key).rows.push({ ...tx, date, amount: -tx.amount });
  }
  const detected = [], candidates = [], inactive = [];
  function item(group, rows, pattern) {
    const latest = rows.at(-1);
    const evidence = pattern?.evidence || rows;
    const amounts = evidence.map((row) => row.amount);
    const nextDate = pattern ? shiftMonths(latest.date, pattern.months) : null;
    return {
      id: `${group.key}:${rows[0].id || rows[0].date}`,
      description: latest.description, category: latest.category, account: group.account,
      currency: latest.currency, amount: latest.amount, lastDate: latest.date,
      months: pattern?.months || null, nextDate,
      monthlyAmount: pattern ? Math.round(latest.amount / pattern.months) : null,
      overdue: nextDate ? nextDate < today : false,
      variable: Math.max(...amounts) - Math.min(...amounts) > Math.max(100, latest.amount * 0.05),
      minAmount: Math.min(...amounts), maxAmount: Math.max(...amounts),
      evidence: evidence.map((row) => ({ id: row.id, date: row.date, description: row.description, amount: row.amount })),
    };
  }
  for (const group of groups.values()) {
    const rows = group.rows.sort((a, b) => a.date.localeCompare(b.date) || String(a.id).localeCompare(String(b.id)));
    const wholePattern = cadence(rows, group.strong);
    let series = wholePattern ? [{ rows, pattern: wholePattern }] : [];
    if (!wholePattern) {
      // Multiple products billed by the same merchant stay separate when their
      // amounts differ. Never collapse all GOOGLE purchases into one subscription.
      const clusters = [];
      for (const row of [...rows].reverse()) {
        let cluster = clusters.find((entries) => Math.abs(entries[0].amount - row.amount) <= Math.max(100, entries[0].amount * 0.15));
        if (!cluster) { cluster = []; clusters.push(cluster); }
        cluster.push(row);
      }
      series = clusters.flatMap((cluster) => {
        cluster.reverse();
        const pattern = cadence(cluster, group.strong);
        return pattern ? [{ rows: cluster, pattern }] : [];
      });
    }
    for (const entry of series) {
      const result = item(group, entry.rows, entry.pattern);
      const graceDays = result.months === 12 ? 35 : result.months === 2 ? 21 : 14;
      (dayDistance(today, result.nextDate) > graceDays ? inactive : detected).push(result);
    }
    if (!series.length && (group.strong || rows.at(-1).category === "מנויים") && dayDistance(today, rows.at(-1).date) <= 370)
      candidates.push(item(group, rows));
  }
  detected.sort((a, b) => a.nextDate.localeCompare(b.nextDate) || a.description.localeCompare(b.description));
  candidates.sort((a, b) => b.lastDate.localeCompare(a.lastDate));
  inactive.sort((a, b) => b.lastDate.localeCompare(a.lastDate));
  const totals = new Map();
  for (const row of detected) totals.set(row.currency, (totals.get(row.currency) || 0) + row.monthlyAmount);
  return { detected, candidates, inactive, totals: [...totals].map(([currency, amount]) => ({ currency, amount })) };
}
