import { test } from "node:test";
import assert from "node:assert/strict";
import { cardForecastForMonth, monthlyCashflow, projectedInstallmentsForMonth } from "../shared/forecast.js";

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
