import { test } from "node:test";
import assert from "node:assert/strict";
import { cardForecastForMonth, estimatedClosingBalance, monthlyCashflow, mortgageEstimateForMonth, nextKnownCardPayment, projectedInstallmentsForMonth, upcomingCardCharges } from "../shared/forecast.js";

test("closing balance adds the current bank balance once for every independently selected month", () => {
  const base = { openingBalance: 192_140, income: 1_900_000, mortgage: 666_730 };
  const cases = [
    { month: "2026-11", cards: 1_276_107, expected: 149_303 },
    { month: "2026-12", cards: 300_000, expected: 1_125_410 },
    { month: "2027-01", cards: 100_000, expected: 1_325_410 },
  ];
  for (const scenario of cases) {
    const result = estimatedClosingBalance({ ...base, cardPayments: scenario.cards, cardComplete: false });
    assert.equal(result.amount, scenario.expected, scenario.month);
    assert.equal(result.partial, true);
    assert.equal(result.amount - base.openingBalance, result.net);
  }
  assert.equal(estimatedClosingBalance({ ...base, openingBalance: null,
    cardPayments: 1_276_107, cardComplete: true }).amount, null);
  assert.equal(estimatedClosingBalance({ ...base, cardPayments: 1_276_107,
    cardComplete: true, bankComplete: false }).partial, true);
});

test("an identical Mizrahi mortgage row is counted once in each monthly forecast", () => {
  const base = {
    account_id: "bank-a", date: "2026-09-10", description: "טפחות - לווים",
    amount: -666_730, currency: "ILS", status: "completed",
  };
  const transactions = [
    { ...base, id: "first", fingerprint: "source-a" },
    { ...base, id: "duplicate", fingerprint: "source-b" },
    { ...base, id: "other-month", date: "2026-10-10" },
    { ...base, id: "pending", status: "pending" },
  ];
  const september = mortgageEstimateForMonth(transactions, "2026-09");
  assert.equal(september.amount, 666_730);
  assert.equal(september.entries.length, 1);
  assert.equal(september.duplicates, 1);
  assert.equal(monthlyCashflow({ income: 1_900_000, mortgage: september.amount,
    cardPayments: 1_276_107, cardComplete: false }).amount, -42_837,
    "₪19,000 − ₪6,667.30 − ₪12,761.07 must not subtract the duplicate mortgage");
  assert.equal(mortgageEstimateForMonth(transactions, "2026-10").amount, 666_730);
  assert.equal(mortgageEstimateForMonth(transactions, "2026-08").amount, null);
});

test("three months use dated bills and remaining installments, without carrying the full bill", () => {
  const income = 1_900_000; // ₪19,000
  const mortgage = 666_730; // ₪6,667.30
  const currentBankBalance = 273_082; // ₪2,730.82, excluded
  const cards = [
    { id: "cal-a", next_charge: 200_000, next_charge_date: "2026-11-02" },
    { id: "cal-b", next_charge: 312_825, next_charge_date: "2026-11-10" },
  ];
  const transactions = [
    { account_id: "cal-a", currency: "ILS", status: "completed", amount: -100_000, processed_date: "2026-11-02", installment_group: "purchase-a", installment_number: 1, installment_total: 3 },
    { account_id: "cal-b", currency: "ILS", status: "completed", amount: -50_000, processed_date: "2026-11-10", installment_group: "purchase-b", installment_number: 1, installment_total: 2 },
  ];
  const cases = [
    { month: "2026-11", cards: 512_825, cashflow: 720_445, source: "scheduled" },
    { month: "2026-12", cards: 150_000, cashflow: 1_083_270, source: "partial" },
    { month: "2027-01", cards: 100_000, cashflow: 1_133_270, source: "partial" },
    { month: "2027-02", cards: 0, cashflow: null, source: "partial" },
  ];
  for (const scenario of cases) {
    const card = cardForecastForMonth(cards, scenario.month, false, transactions);
    const result = monthlyCashflow({ income, mortgage, cardPayments: card.amount, cardComplete: card.source === "scheduled" });
    assert.equal(card.amount, scenario.cards, scenario.month);
    assert.equal(card.source, scenario.source, scenario.month);
    assert.equal(result.amount, scenario.cashflow, scenario.month);
    if (result.amount !== null)
      assert.notEqual(result.amount, scenario.cashflow + currentBankBalance, scenario.month);
  }
  const decemberPosted = [
    ...transactions,
    { account_id: "cal-a", currency: "ILS", status: "completed", amount: -100_000, processed_date: "2026-12-02", installment_group: "purchase-a", installment_number: 2, installment_total: 3 },
  ];
  assert.equal(cardForecastForMonth(cards, "2026-12", false, decemberPosted).amount, 150_000,
    "a posted installment must replace, not duplicate, its projection");
  assert.equal(cardForecastForMonth(cards, "2026-12", true, transactions).source, "partial");
  assert.equal(cardForecastForMonth(cards, "2026-12").amount, 0,
    "the November bill must not be copied to December when no schedule exists");
});

test("a five-payment card purchase shows February and March after January's third payment", () => {
  const base = {
    account_id: "cal-card",
    installment_group: "flight-purchase",
    installment_total: 5,
    currency: "ILS",
    status: "completed",
    description: "Five-payment purchase",
  };
  const transactions = [
    { ...base, id: "one", date: "2026-10-18", processed_date: "2026-11-02", installment_number: 1, amount: -20_621 },
    { ...base, id: "two", date: "2026-11-18", processed_date: "2026-12-02", installment_number: 2, amount: -20_617 },
    { ...base, id: "three", date: "2026-12-18", processed_date: "2027-01-02", installment_number: 3, amount: -20_617 },
  ];
  const february = projectedInstallmentsForMonth(transactions, "2027-02");
  assert.equal(february.length, 1);
  assert.equal(february[0].installment_number, 4);
  assert.equal(february[0].processed_date, "2027-02-02");
  assert.equal(february[0].amount, -20_617);
  assert.equal(february[0].status, "projected");
  assert.equal(projectedInstallmentsForMonth(transactions, "2027-03")[0].installment_number, 5);
  assert.deepEqual(projectedInstallmentsForMonth(transactions, "2027-04"), []);
  assert.deepEqual(projectedInstallmentsForMonth([
    ...transactions,
    { ...base, id: "four", date: "2027-01-18", processed_date: "2027-02-02", installment_number: 4, amount: -20_610 },
  ], "2027-02"), [], "a synced fourth payment replaces the projection");
});

test("Isracard's credit-line usage is never mistaken for the next payment", () => {
  const account = { id: "isracard-1", currency: "ILS", balance: -327_719, next_charge: null };
  const tx = (id, date, amount, extra = {}) => ({
    id, account_id: account.id, processed_date: date, amount,
    currency: "ILS", status: "completed", ...extra,
  });
  const transactions = [
    tx("past", "2026-10-10", -100_000),
    tx("first", "2026-11-10", -12_000),
    tx("second", "2026-11-10", -5_000),
    tx("refund", "2026-11-10", 1_000),
    tx("later", "2026-12-10", -20_000),
    tx("pending", "2026-11-10", -90_000, { status: "pending" }),
    tx("foreign", "2026-11-10", -50_000, { currency: "USD" }),
    tx("other", "2026-11-10", -80_000, { account_id: "other-card" }),
  ];
  assert.deepEqual(nextKnownCardPayment(account, transactions, "2026-10-22"), {
    amount: 16_000, date: "2026-11-10", estimated: true,
  });
  assert.equal(nextKnownCardPayment(account, [], "2026-10-22"), null,
    "credit usage alone cannot establish a payment");
  assert.deepEqual(nextKnownCardPayment({ ...account, next_charge: 18_000, next_charge_date: "2026-11-10" }, transactions, "2026-10-22"), {
    amount: 18_000, date: "2026-11-10", estimated: false,
  });
});

test("upcoming card panel totals each selected card's next dated bill once", () => {
  const accounts = [
    { id: "cal", number: "4814", currency: "ILS", next_charge: 541_786, next_charge_date: "2026-11-02" },
    { id: "isracard", number: "0706", currency: "ILS", balance: -3_277_719 },
    { id: "unknown", number: "2421", currency: "ILS", balance: -1_239_192 },
    { id: "excluded", number: "0936", currency: "ILS", enabled: false, next_charge: 78800, next_charge_date: "2026-11-10" },
  ];
  const transactions = [
    { account_id: "cal", currency: "ILS", status: "completed", processed_date: "2026-11-02", amount: -100_000 },
    { account_id: "isracard", currency: "ILS", status: "completed", processed_date: "2026-11-10", amount: -12_000 },
    { account_id: "isracard", currency: "ILS", status: "completed", processed_date: "2026-11-10", amount: -5_000 },
    { account_id: "isracard", currency: "ILS", status: "completed", processed_date: "2026-11-10", amount: 1_000 },
    { account_id: "isracard", currency: "ILS", status: "completed", processed_date: "2026-12-10", amount: -30_000 },
    { account_id: "isracard", currency: "ILS", status: "pending", processed_date: "2026-11-10", amount: -900_000 },
  ];
  const result = upcomingCardCharges(accounts, transactions, "2026-10-22");
  assert.deepEqual(result.charges.map(({ account, amount, date, estimated }) =>
    ({ card: account.number, amount, date, estimated })), [
    { card: "4814", amount: 541_786, date: "2026-11-02", estimated: false },
    { card: "0706", amount: 16_000, date: "2026-11-10", estimated: true },
  ]);
  assert.deepEqual(result.totals, [{ currency: "ILS", amount: 557_786 }]);
  assert.equal(result.unknownCount, 1);
  assert.equal(result.partial, true);
  assert.deepEqual(upcomingCardCharges([accounts[2]], transactions, "2026-10-22").totals, [],
    "credit-line usage alone must never become a zero or estimated payment");
});

test("dated card bill rows replace speculative installments for that card and month", () => {
  const cards = [
    { id: "isracard-a", next_charge: null },
    { id: "isracard-b", next_charge: null },
    { id: "cal", next_charge: 300_000, next_charge_date: "2026-11-10" },
  ];
  const tx = (account_id, processed_date, amount, installment_group, installment_number, installment_total) => ({
    account_id, processed_date, amount, installment_group, installment_number,
    installment_total, currency: "ILS", status: "completed",
  });
  const transactions = [
    tx("isracard-a", "2026-10-10", -500_000, "old-a", 1, 4),
    tx("isracard-a", "2026-11-10", -120_000, null, null, null),
    tx("isracard-b", "2026-10-10", -400_000, "old-b", 1, 4),
    tx("isracard-b", "2026-11-10", -80_000, null, null, null),
    tx("cal", "2026-11-10", -200_000, null, null, null),
  ];
  const november = cardForecastForMonth(cards, "2026-11", false, transactions);
  assert.equal(november.amount, 500_000,
    "the November bill uses two issuer-dated rows and Cal's exact charge, without old installment projections");
  assert.equal(november.source, "partial");
  assert.equal(november.breakdown.reduce((sum, card) => sum + card.amount, 0), november.amount);
  assert.deepEqual(november.breakdown.map((card) => card.source), ["dated", "dated", "scheduled"]);
  assert.equal(monthlyCashflow({ income: 1_900_000, mortgage: 666_730, cardPayments: november.amount, cardComplete: false }).amount, 733_270);
  assert.equal(cardForecastForMonth(cards, "2026-12", false, transactions).amount, 900_000,
    "a month without issuer-dated rows can still estimate remaining installments");
});
