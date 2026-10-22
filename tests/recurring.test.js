import { test } from "node:test";
import assert from "node:assert/strict";
import { recurringPayments } from "../shared/recurring.js";

const accounts = [{ id: "card", provider: "visaCal", number: "4814", enabled: true },
  { id: "bank", provider: "mizrahi", number: "1886", enabled: true },
  { id: "excluded", provider: "visaCal", number: "0936", enabled: false }];
const providers = { visaCal: { kind: "card" }, mizrahi: { kind: "bank" } };
const today = "2026-10-22";
const charge = (description, date, amount, extra = {}) => ({ id: `${description}:${date}:${amount}`,
  description, date, amount: -amount, currency: "ILS", status: "completed", category: "מנויים", account_id: "card", provider: "visaCal", ...extra });
const detect = (rows, date = today) => recurringPayments(rows, accounts, providers, date);

test("monthly, every-two-month and annual services have independent monthly costs and evidence", () => {
  const result = detect([
    ...["2026-08-10", "2026-09-10", "2026-10-10"].map((date) => charge("OPENAI CHATGPT", date, 7580)),
    ...["2026-06-05", "2026-08-05", "2026-10-05"].map((date) => charge("חברת החשמל", date, 60000, { category: "בית וחשבונות", account_id: "bank", provider: "mizrahi" })),
    ...["2025-10-20", "2026-10-20"].map((date) => charge("ביטוח דירה שנתי", date, 120000, { category: "ביטוח ופיננסים" })),
  ]);
  assert.equal(result.detected.length, 3);
  for (const [name, months, cost, next] of [["OPENAI CHATGPT", 1, 7580, "2026-11-10"], ["חברת החשמל", 2, 30000, "2026-12-05"], ["ביטוח דירה שנתי", 12, 10000, "2027-10-20"]]) {
    const item = result.detected.find((row) => row.description === name);
    assert.equal(item.months, months); assert.equal(item.monthlyAmount, cost); assert.equal(item.nextDate, next);
    assert.ok(item.evidence.length >= 2);
  }
  assert.deepEqual(result.totals, [{ currency: "ILS", amount: 47580 }]);
});

test("installments, bank card settlements, transfers, refunds, pending, future and excluded cards never become subscriptions", () => {
  const invalid = [
    { installment_number: 1, installment_total: 12 }, { installment_group: "purchase" },
    { memo: "תשלום 2 מתוך 5" }, { amount: 1000 }, { status: "pending" },
    { account_id: "excluded" }, { date: "2026-12-10" }, { projected: true },
    { description: "כאל כרטיס אשראי", account_id: "bank", provider: "mizrahi" },
    { description: "העברה בBIT" }, { description: "טפחות - לווים", account_id: "bank", provider: "mizrahi" },
  ].flatMap((extra, index) => ["2026-08-10", "2026-09-10", "2026-10-10"].map((date) => charge("OPENAI", date, 7500, { ...extra, id: `invalid-${index}-${date}` })));
  assert.deepEqual(detect(invalid), { detected: [], candidates: [], inactive: [], totals: [] });
});

test("repeated groceries and one-off service charges cannot establish a recurring subscription", () => {
  const result = detect([
    ...["2026-08-10", "2026-09-10", "2026-10-10"].map((date) => charge("שופרסל", date, 12000, { category: "מזון וקניות" })),
    charge("ביטוח דירה", "2026-10-01", 120000, { category: "ביטוח ופיננסים" }),
    charge("GOOGLE GOOGLE ONE", "2026-10-02", 8000),
  ]);
  assert.equal(result.detected.length, 0); assert.equal(result.totals.length, 0);
  assert.equal(result.candidates.length, 2);
  assert.ok(result.candidates.every((row) => row.months === null && row.monthlyAmount === null && row.nextDate === null));
});

test("different Google products, cards and currencies stay separate and bank settlement is not counted twice", () => {
  const result = detect(["2026-08-10", "2026-09-10", "2026-10-10"].flatMap((date) => [
    charge("GOOGLE YOUTUBE", date, 3990), charge("GOOGLE GOOGLE ONE", date, 7990),
    charge("OPENAI", date, 2000, { currency: "USD" }),
    charge("ויזה כאל", date, 300000, { account_id: "bank", provider: "mizrahi" }),
  ]));
  assert.equal(result.detected.length, 3);
  assert.deepEqual(Object.fromEntries(result.totals.map((row) => [row.currency, row.amount])), { ILS: 11980, USD: 2000 });
});

test("same-merchant plans stay separate while price changes and month ends retain the schedule", () => {
  const result = detect([
    ...["2026-07-31", "2026-08-31", "2026-09-30"].map((date, index) => charge("פרי טיוי", date, index === 2 ? 4990 : 3990)),
    ...["2026-08-05", "2026-09-05", "2026-10-05"].flatMap((date) => [charge("GOOGLE WORKSPACE", date, 12000), charge("GOOGLE WORKSPACE", date, 35000)]),
  ]);
  assert.equal(result.detected.length, 3);
  const freeTv = result.detected.find((row) => row.description === "פרי טיוי");
  assert.equal(freeTv.nextDate, "2026-10-30"); assert.equal(freeTv.monthlyAmount, 4990); assert.equal(freeTv.variable, true);
  assert.equal(freeTv.evidence.length, 3);
  assert.deepEqual(result.detected.filter((row) => row.description === "GOOGLE WORKSPACE").map((row) => row.amount).sort((a, b) => a - b), [12000, 35000]);
});

test("a missed renewal is shown as overdue briefly then excluded from the active monthly estimate", () => {
  const rows = ["2026-06-10", "2026-07-10", "2026-08-10"].map((date) => charge("OPENAI", date, 7500));
  const overdue = detect(rows, "2026-09-15");
  assert.equal(overdue.detected.length, 1); assert.equal(overdue.detected[0].overdue, true);
  assert.equal(overdue.detected[0].nextDate, "2026-09-10");
  const inactive = detect(rows);
  assert.equal(inactive.detected.length, 0); assert.deepEqual(inactive.totals, []);
  assert.equal(inactive.inactive.length, 1);
});
