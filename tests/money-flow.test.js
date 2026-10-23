import { test } from "node:test";
import assert from "node:assert/strict";
import { moneyFlow, layoutMoneyFlow } from "../shared/money-flow.js";

const providers = { mizrahi: { kind: "bank" }, visaCal: { kind: "card" }, isracard: { kind: "card" } };
const accounts = [{ id: "bank", provider: "mizrahi", number: "1886", enabled: true, balance: 192140 },
  { id: "cal", provider: "visaCal", number: "4814", enabled: true }, { id: "cal2", provider: "visaCal", number: "0936", enabled: true },
  { id: "excluded", provider: "isracard", number: "9999", enabled: false }];
const bank = (id, description, amount, date = "2026-11-02", extra = {}) => ({ id, account_id: "bank", provider: "mizrahi", description, amount, date, currency: "ILS", status: "completed", category: "כללי", ...extra });
const card = (id, description, amount, category = "תחבורה", extra = {}) => ({ id, account_id: "cal", provider: "visaCal", description, amount, date: "2026-10-17", processed_date: "2026-11-02", currency: "ILS", status: "completed", category, category_source: "chatgpt", category_description: description, ...extra });
const run = (rows, month = "2026-11", today = "2026-11-20") => moneyFlow(rows, accounts, providers, month, today);
function conserves(flow) {
  const node = (key) => flow.nodes.find((entry) => entry.key === key);
  assert.ok(flow.nodes.every((item) => item.value > 0));
  for (const link of flow.links) { assert.ok(node(link.source)); assert.ok(node(link.target)); assert.ok(link.value > 0); }
  for (const item of flow.nodes) {
    const incoming = flow.links.filter((link) => link.target === item.key), outgoing = flow.links.filter((link) => link.source === item.key);
    if (incoming.length) assert.equal(incoming.reduce((sum, link) => sum + link.value, 0), item.value);
    if (outgoing.length) assert.equal(outgoing.reduce((sum, link) => sum + link.value, 0), item.value);
    if (item.entries.length) assert.equal(item.entries.reduce((sum, entry) => sum + entry.contribution, 0), item.value, `drilldown must reconcile for ${item.key}`);
  }
}

test("real-number deficit flow counts bank settlements once and card categories explain the same payment", () => {
  const flow = run([bank("income", "משכורת", 1900000, "2026-11-01"), bank("mortgage", "טפחות - לווים (י)", -666730, "2026-11-10"),
    bank("settlement", "הרשאה כאל (י)", -1276107), card("transport", "תחבורה", -423193),
    card("food", "קניות", -256551, "מזון וקניות"), card("house", "בית", -596363, "בית וחשבונות")]);
  assert.equal(flow.income, 1900000, "the current bank balance is not an income source");
  assert.equal(flow.expense, 1942837); assert.equal(flow.net, -42837); assert.equal(flow.deficit, 42837);
  assert.equal(flow.cardPayments, 1276107); assert.equal(flow.matchedAmount, 1276107); assert.equal(flow.unmatchedAmount, 0);
  assert.equal(flow.nodes.find((node) => node.key === "card-category:תחבורה").value, 423193);
  assert.equal(flow.nodes.filter((node) => node.column === 2).reduce((sum, node) => sum + node.value, 0), flow.expense);
  conserves(flow);
});

test("surplus is the period's net credit, not bank balance or guaranteed savings; source-only and expense-only months balance", () => {
  const flow = run([bank("salary", "משכורת", 1900000), bank("mortgage", "טפחות - לווים", -666730), bank("bill", "הרשאה כאל", -541786), card("purchase", "רכישה", -541786)]);
  assert.equal(flow.surplus, 691484); assert.equal(flow.deficit, 0); assert.equal(flow.total, 1900000); conserves(flow);
  const onlyCredit = run([bank("in", "זיכוי", 10000)]); assert.equal(onlyCredit.surplus, 10000); conserves(onlyCredit);
  const onlyDebit = run([bank("out", "חיוב בנק", -20000)]); assert.equal(onlyDebit.deficit, 20000); conserves(onlyDebit);
});

test("missing or mismatched card details stay unallocated without proportional guesses", () => {
  const flow = run([bank("bill", "הרשאה כאל", -12000), card("partial", "קנייה", -10000)]);
  assert.equal(flow.matchedAmount, 0); assert.equal(flow.unmatchedAmount, 12000);
  assert.equal(flow.nodes.some((node) => node.key.startsWith("card-category:")), false);
  assert.match(flow.nodes.find((node) => node.key === "unmatched").entries[0].matchReason, /לא נמצא פירוט/); conserves(flow);
  const late = run([bank("bill", "הרשאה כאל", -10000, "2026-11-07"), card("late", "רכישה", -10000)]);
  assert.equal(late.matchedPayments, 0, "a five-day mismatch is not silently reconciled"); conserves(late);
});

test("one issuer's combined card bill can match, but duplicate or ambiguous bank payments cannot reuse card activity", () => {
  const cards = [card("a", "אוכל", -10000, "מזון וקניות"), card("b", "דלק", -20000, "תחבורה", { account_id: "cal2" })];
  const combined = run([bank("bill", "הרשאה כאל", -30000), ...cards]);
  assert.equal(combined.matchedPayments, 1); assert.equal(combined.matchedAmount, 30000); conserves(combined);
  const duplicate = run([bank("bill-a", "הרשאה כאל", -10000), bank("bill-b", "הרשאה כאל", -10000, "2026-11-03"), cards[0]]);
  assert.equal(duplicate.matchedPayments, 0); assert.equal(duplicate.unmatchedAmount, 20000); conserves(duplicate);
  const ambiguous = run([bank("bill", "הרשאה כאל", -10000), cards[0], card("c", "עסק אחר", -10000, "בריאות", { account_id: "cal2" })]);
  assert.equal(ambiguous.matchedPayments, 0); conserves(ambiguous);
});

test("refunds reduce their actual category; negative category net is left unmatched instead of invented positive flows", () => {
  const rows = [bank("bill", "הרשאה כאל", -9000), card("purchase", "קניות", -10000, "מזון וקניות"), card("refund", "קניות", 1000, "מזון וקניות")];
  const flow = run(rows); assert.equal(flow.matchedAmount, 9000);
  assert.equal(flow.nodes.find((node) => node.key === "card-category:מזון וקניות").entries.find((row) => row.id === "refund").contribution, -1000); conserves(flow);
  rows[2] = card("refund", "זיכוי עסק אחר", 1000, "תחבורה");
  const unmatched = run(rows); assert.equal(unmatched.unmatchedAmount, 9000); conserves(unmatched);
});

test("month, selected accounts, completion status and currency boundaries exclude phantom money", () => {
  const ignored = [bank("pending", "ממתין", 990000, "2026-11-02", { status: "pending" }), bank("future", "עתידי", 880000, "2026-11-25"),
    bank("previous", "חודש קודם", 770000, "2026-10-31"), bank("usd", "דולר", 660000, "2026-11-02", { currency: "USD" }),
    bank("excluded", "חשבון שלא נבחר", 550000, "2026-11-02", { account_id: "excluded" }), card("projected", "תשלום עתידי", -440000, "תחבורה", { projected: true }),
    card("no-bank", "קנייה בכרטיס ללא תשלום בבנק", -330000)];
  const empty = run(ignored); assert.equal(empty.total, 0); assert.deepEqual(empty.nodes, []);
  const credit = bank("valid", "הכנסה", 10000, "2026-11-02", { currency: "₪" });
  const flow = run([...ignored, credit, credit]); assert.equal(flow.income, 10000, "the same transaction id is not counted twice"); conserves(flow);
  const october = run([bank("oct", "חיוב כאל", -423193, "2026-10-02"), card("oct-card", "תחבורה", -423193, "תחבורה", { processed_date: "2026-10-02", date: "2026-09-17" }), bank("nov", "הרשאה כאל", -22139)], "2026-10");
  assert.equal(october.expense, 423193); assert.equal(october.matchedAmount, 423193); conserves(october);
});

test("SVG layout uses one proportional scale, finite geometry and enough label space for small categories", () => {
  const flow = run([bank("in", "משכורת", 1000000), bank("big", "טפחות - לווים", -900000), bank("tiny", "עמלה קטנה", -1)]);
  const layout = layoutMoneyFlow(flow);
  for (const node of layout.nodes) {
    assert.ok(Number.isFinite(node.y) && node.y >= 0 && node.y + node.height <= layout.height);
    assert.ok(Math.abs(node.height / node.value - 360 / flow.total) < 1e-10);
  }
  for (const link of layout.links) { assert.ok(!/NaN|Infinity/.test(link.path)); assert.ok(link.height > 0); }
  conserves(flow);
});
