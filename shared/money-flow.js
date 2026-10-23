import { normalizeCurrency } from "./currency.js";
import { cardCategoryColor } from "./categories.js";

const issuerRules = [
  ["visaCal", /כאל|ויזה\s*כאל|\bcal\b/iu],
  ["isracard", /ישראכרט|\bisracard\b/iu],
  ["amex", /אמריקן\s*אקספרס|\bamex\b|american express/iu],
  ["max", /מקס\s*(?:איט|אשראי)|לאומי\s*קארד|\bmax\b/iu],
];
const dayDistance = (a, b) => Math.abs(Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86400000;
const categoryOf = (row) => row.category_source === "chatgpt" && row.category_description === row.description
  ? row.category : "טרם סווג עם ChatGPT";
const nameKey = (value) => String(value).trim().replace(/\s+/g, " ");
const colors = { income: "#53a58f", hub: "#7259d9", card: "#7a6cd6", mortgage: "#dcac50", loan: "#b9859b", transfer: "#6d9bb1", investment: "#789b6b", insurance: "#bc8aab", bank: "#9f8eba", surplus: "#53a58f", deficit: "#d77970", unmatched: "#aaa1b6" };

function issuer(description) {
  return issuerRules.find(([, expression]) => expression.test(description))?.[0] || null;
}
function isCardPayment(row) {
  return issuer(row.description) || /כרטיסי?\s*אשראי|ויזה|מסטרקארד/iu.test(row.description);
}
function bankExpense(row) {
  const description = row.description || "";
  if (/טפחות\s*[-–—־]\s*לווים|משכנת/iu.test(description)) return ["mortgage", "משכנתא"];
  if (/הלווא/iu.test(description)) return ["loan", "החזרי הלוואות"];
  if (/ביטוח|הפניקס|איילון|הראל|מנורה/iu.test(description)) return ["insurance", "ביטוחים בבנק"];
  if (/העבר|העב\./iu.test(description)) return ["transfer", "העברות מהבנק"];
  if (/פיקדון|פקדון|קניית|רכישת|השקעה/iu.test(description)) return ["investment", "השקעות ופיקדונות"];
  return ["bank", row.category && row.category !== "כללי" ? row.category : nameKey(description) || "חיוב בנק ללא תיאור"];
}

// Actual movements, never a forecast. Card purchases explain matched bank
// settlements; they never become additional bank expenses.
export function moneyFlow(transactions, accounts, providers, month, today) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Invalid billing month");
  const endOfMonth = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0, 12)).toISOString().slice(0, 10);
  const start = `${month}-01`, end = endOfMonth < today ? endOfMonth : today;
  const enabled = new Map(accounts.filter((account) => account.enabled !== false && account.enabled !== 0).map((account) => [account.id, account]));
  const seen = new Set();
  const rows = transactions.filter((row) => {
    if (!enabled.has(row.account_id) || row.status !== "completed" || row.projected || !Number.isFinite(row.amount) ||
        normalizeCurrency(row.currency) !== "ILS" || !row.amount || (row.id && seen.has(row.id))) return false;
    if (row.id) seen.add(row.id);
    return true;
  });
  const kind = (row) => providers[row.provider || enabled.get(row.account_id)?.provider]?.kind;
  const bank = rows.filter((row) => kind(row) === "bank" && row.date >= start && row.date <= end);
  const credits = bank.filter((row) => row.amount > 0), debits = bank.filter((row) => row.amount < 0);
  const income = credits.reduce((sum, row) => sum + row.amount, 0), expense = debits.reduce((sum, row) => sum - row.amount, 0);
  const total = Math.max(income, expense), surplus = Math.max(0, income - expense), deficit = Math.max(0, expense - income);
  const cardDebits = debits.filter(isCardPayment);
  const bills = new Map();
  for (const row of rows.filter((row) => kind(row) === "card" && /^\d{4}-\d{2}-\d{2}$/.test(row.processed_date || "") && row.processed_date <= today)) {
    const key = `${row.account_id}:${row.processed_date}`;
    if (!bills.has(key)) bills.set(key, { id: key, provider: row.provider || enabled.get(row.account_id).provider, date: row.processed_date, rows: [], amount: 0 });
    const bill = bills.get(key); bill.rows.push(row); bill.amount -= row.amount;
  }
  const billGroups = [...bills.values()].filter((bill) => bill.amount > 0);
  const combined = new Map();
  for (const bill of billGroups) {
    const key = `${bill.provider}:${bill.date}`;
    if (!combined.has(key)) combined.set(key, []);
    combined.get(key).push(bill);
  }
  const choices = [...billGroups.map((bill) => [bill]), ...[...combined.values()].filter((group) => group.length > 1)];
  const candidates = cardDebits.map((row) => ({ row, choices: choices.filter((group) => issuer(row.description) === group[0].provider &&
    dayDistance(row.date, group[0].date) <= 4 && group.reduce((sum, bill) => sum + bill.amount, 0) === -row.amount) }));
  const usage = new Map();
  for (const entry of candidates) for (const group of entry.choices) for (const bill of group) {
    if (!usage.has(bill.id)) usage.set(bill.id, new Set());
    usage.get(bill.id).add(entry.row.id);
  }
  const matched = [], unmatched = [];
  for (const entry of candidates) {
    const group = entry.choices[0];
    let reason = !entry.choices.length ? "לא נמצא פירוט כרטיסים עם סכום מדויק ומועד תואם." : "קיימת יותר מהתאמה אפשרית אחת; לא בוצעה הקצאה משוערת.";
    if (entry.choices.length === 1 && group.every((bill) => usage.get(bill.id).size === 1)) {
      const categories = new Map();
      for (const row of group.flatMap((bill) => bill.rows)) {
        const name = categoryOf(row);
        if (!categories.has(name)) categories.set(name, { amount: 0, rows: [] });
        categories.get(name).amount -= row.amount; categories.get(name).rows.push(row);
      }
      if ([...categories.values()].every((category) => category.amount >= 0)) {
        matched.push({ bankRow: entry.row, categories }); continue;
      }
      reason = "זיכוי יצר קטגוריה בסכום שלילי; פירוט זה אינו מפוצל לרצועות חיוב.";
    }
    unmatched.push({ row: entry.row, reason });
  }
  const nodes = [], links = [];
  const addNode = (key, label, column, value, color, entries = [], explanation = "") => {
    const node = { key, label, column, value, color, entries, explanation };
    nodes.push(node); return node;
  };
  const entry = (row, contribution, extra = {}) => ({ ...row, contribution, account_number: row.account_number || enabled.get(row.account_id)?.number || "", ...extra });
  if (total) {
    addNode("hub", "חלוקת הכסף בחודש", 1, total, colors.hub, [], "הרצועות מאזנות בין הכסף שנכנס, תשלומי הבנק והפרש החודש. סכומי כרטיסים אינם מתווספים להוצאות הבנק.");
    const sources = new Map();
    for (const row of credits) {
      const label = nameKey(row.description) || "זיכוי בבנק";
      if (!sources.has(label)) sources.set(label, []);
      sources.get(label).push(row);
    }
    for (const [label, sourceRows] of sources) {
      const key = `income:${label}`, amount = sourceRows.reduce((sum, row) => sum + row.amount, 0);
      addNode(key, label, 0, amount, colors.income, sourceRows.map((row) => entry(row, row.amount)), "זיכויים והעברות שנכנסו לבנק. לא כל זיכוי הוא משכורת או הכנסה מעבודה.");
      links.push({ source: key, target: "hub", value: amount });
    }
    if (deficit) {
      addNode("deficit", "הוצאות מעבר לנכנס", 0, deficit, colors.deficit,
        [...debits.map((row) => entry(row, -row.amount)), ...credits.map((row) => entry(row, -row.amount))],
        "הוצאות הבנק פחות זיכויי הבנק. זהו הפרש מחושב, לא הכנסה נוספת ולא זיהוי של מקור המימון.");
      links.push({ source: "deficit", target: "hub", value: deficit });
    }
    const expenses = new Map();
    for (const row of debits.filter((row) => !isCardPayment(row))) {
      const [type, label] = bankExpense(row);
      if (!expenses.has(label)) expenses.set(label, { type, rows: [] });
      expenses.get(label).rows.push(row);
    }
    for (const [label, group] of expenses) {
      const key = `expense:${label}`, amount = group.rows.reduce((sum, row) => sum - row.amount, 0);
      addNode(key, label, 2, amount, colors[group.type], group.rows.map((row) => entry(row, -row.amount)), "חיובי בנק שסווגו לפי תיאור התנועה. תשלומי כרטיסים מופיעים בנפרד.");
      links.push({ source: "hub", target: key, value: amount });
    }
    if (cardDebits.length) {
      const amount = cardDebits.reduce((sum, row) => sum - row.amount, 0);
      addNode("cards", "תשלומי כרטיסים בבנק", 2, amount, colors.card, cardDebits.map((row) => entry(row, -row.amount)), "חיובי הסליקה שנגבו בבנק, פעם אחת בלבד. פירוט בתי העסק משמש להסבר סכום זה, לא כהוצאה נוספת.");
      links.push({ source: "hub", target: "cards", value: amount });
      const cardCategories = new Map();
      for (const match of matched) for (const [name, category] of match.categories) {
        if (!cardCategories.has(name)) cardCategories.set(name, { value: 0, rows: [] });
        const group = cardCategories.get(name); group.value += category.amount;
        group.rows.push(...category.rows.map((row) => entry(row, -row.amount, { matchedBankId: match.bankRow.id, matchedBankDate: match.bankRow.date })));
      }
      for (const [label, group] of cardCategories) if (group.value > 0) {
        const key = `card-category:${label}`;
        addNode(key, label, 3, group.value, cardCategoryColor(label), group.rows, "פירוט כרטיסים שהותאם באופן ייחודי לחיוב בנק לפי סכום מדויק, אותו ספק ומרווח של עד ארבעה ימים. זיכויים מקטינים את הקטגוריה שלהם.");
        links.push({ source: "cards", target: key, value: group.value });
      }
      if (unmatched.length) {
        const value = unmatched.reduce((sum, item) => sum - item.row.amount, 0);
        addNode("unmatched", "פירוט כרטיסים שלא הותאם", 3, value, colors.unmatched, unmatched.map((item) => entry(item.row, -item.row.amount, { matchReason: item.reason })), "הסכום נכלל בהוצאות הבנק, אך אין לו פירוט כרטיסים שניתן להתאים בבטחה. ייתכן שחסרים כרטיסים, תנועות או מועדי חיוב.");
        links.push({ source: "cards", target: "unmatched", value });
      }
    }
    if (surplus) {
      addNode("surplus", "נשאר מהכסף שנכנס", 2, surplus, colors.surplus,
        [...credits.map((row) => entry(row, row.amount)), ...debits.map((row) => entry(row, row.amount))],
        "זיכויי הבנק פחות חיובי הבנק בחודש. זהו עודף תזרימי בתקופה, לא יתרת החשבון הנוכחית ולא הפקדה מאומתת לחיסכון.");
      links.push({ source: "hub", target: "surplus", value: surplus });
    }
  }
  return { month, start, end, income, expense, net: income - expense, total, surplus, deficit, nodes, links,
    matchedPayments: matched.length, unmatchedPayments: unmatched.length, cardPayments: cardDebits.reduce((sum, row) => sum - row.amount, 0),
    matchedAmount: matched.reduce((sum, match) => sum - match.bankRow.amount, 0), unmatchedAmount: unmatched.reduce((sum, item) => sum - item.row.amount, 0) };
}

// Common pixels-per-agora keeps every ribbon to the same scale. Small node
// labels get room without assigning their flows invented minimum amounts.
export function layoutMoneyFlow(flow) {
  const width = 1420, barWidth = 14, scale = flow.total ? 360 / flow.total : 0, gap = 18;
  const columns = [0, 1, 2, 3].map((column) => flow.nodes.filter((node) => node.column === column).sort((a, b) => b.value - a.value || a.key.localeCompare(b.key)));
  const columnHeight = (nodes) => nodes.reduce((sum, node) => sum + Math.max(48, node.value * scale), 0) + Math.max(0, nodes.length - 1) * gap;
  const height = Math.max(480, ...columns.map((column) => columnHeight(column) + 100));
  const nodes = columns.flatMap((column, index) => {
    let cursor = (height - columnHeight(column)) / 2;
    return column.map((node) => {
      const band = Math.max(48, node.value * scale), nodeHeight = node.value * scale;
      const result = { ...node, x: [1210, 880, 550, 190][index], y: cursor + (band - nodeHeight) / 2, height: nodeHeight };
      cursor += band + gap; return result;
    });
  });
  const byKey = new Map(nodes.map((node) => [node.key, node]));
  const sourceOffsets = new Map(), targetOffsets = new Map();
  for (const node of nodes) {
    let source = 0, target = 0;
    for (const link of flow.links.filter((link) => link.source === node.key).sort((a, b) => byKey.get(a.target).y - byKey.get(b.target).y)) {
      sourceOffsets.set(link, source); source += link.value * scale;
    }
    for (const link of flow.links.filter((link) => link.target === node.key).sort((a, b) => byKey.get(a.source).y - byKey.get(b.source).y)) {
      targetOffsets.set(link, target); target += link.value * scale;
    }
  }
  const links = flow.links.map((link, index) => {
    const source = byKey.get(link.source), target = byKey.get(link.target);
    const x0 = source.x, x1 = target.x + barWidth, middle = (x0 + x1) / 2;
    const y0 = source.y + sourceOffsets.get(link), y1 = target.y + targetOffsets.get(link), h = link.value * scale;
    return { ...link, id: index, sourceNode: source, targetNode: target, height: h,
      path: `M ${x0} ${y0} C ${middle} ${y0} ${middle} ${y1} ${x1} ${y1} L ${x1} ${y1 + h} C ${middle} ${y1 + h} ${middle} ${y0 + h} ${x0} ${y0 + h} Z` };
  });
  return { width, height, barWidth, nodes, links };
}
