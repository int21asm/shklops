import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeCurrency, formatMoney } from "../shared/currency.js";

test("card shekel symbols and aliases normalize without relabeling unknown currencies", () => {
  for (const value of ["₪", " ILS ", "nis", 'ש"ח', "ש״ח", "שח"])
    assert.equal(normalizeCurrency(value), "ILS");
  assert.equal(normalizeCurrency("usd"), "USD");
  assert.equal(normalizeCurrency("19"), "19");
  assert.equal(normalizeCurrency("$"), "$");
});

test("currency formatting accepts card symbols and keeps unsupported units from crashing React", () => {
  assert.equal(formatMoney(-12345, "₪"), formatMoney(-12345, "ILS"));
  for (const currency of ["₪", "ILS", "USD", "EUR", "$", "19", "unknown"])
    assert.doesNotThrow(() => formatMoney(12345, currency));
  assert.ok(formatMoney(12345, "19").includes("19"));
  assert.ok(!formatMoney(12345, "19").includes("₪"));
});
