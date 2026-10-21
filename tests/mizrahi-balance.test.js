import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseShekelBalance,
  latestTransactionBalance,
  addMizrahiBalanceFallback,
} from "../server/mizrahi-balance.js";

test("Mizrahi balance parsing handles shekels, grouping, RTL text, negative and genuine zero balances", () => {
  assert.equal(parseShekelBalance("\u200f₪ 1,234.56\u200e"), 1234.56);
  assert.equal(parseShekelBalance("-1,234.56 ₪"), -1234.56);
  assert.equal(parseShekelBalance("(₪1,234.56)"), -1234.56);
  assert.equal(parseShekelBalance("₪0.00"), 0);
  for (const value of [
    "",
    "יתרת עו״ש",
    "מסגרת אשראי 36,000",
    "1,23.45",
    "12.345",
    "--12",
    null,
  ])
    assert.equal(parseShekelBalance(value), null);
});

test("latest ledger balance respects date order and refuses ambiguous or missing latest balances", () => {
  const rows = [
    { date: "22/09/26", balance: "5,000.00" },
    { date: "11/10/26", balance: "3,000.00" },
    { date: "11/10/26", balance: "1,234.56" },
  ];
  assert.deepEqual(latestTransactionBalance(rows), {
    balance: 1234.56,
    balanceDate: "2026-10-11",
  });
  assert.deepEqual(latestTransactionBalance([...rows].reverse()), {
    balance: 1234.56,
    balanceDate: "2026-10-11",
  });
  assert.equal(latestTransactionBalance(rows.slice(1)), null);
  assert.equal(
    latestTransactionBalance([...rows, { date: "12/10/26", balance: "" }]),
    null,
  );
  assert.equal(
    latestTransactionBalance([{ date: "31/02/26", balance: "100" }]),
    null,
  );
});

test("balance fallback is scoped to each account and preserves usable API balances", async () => {
  const accounts = [
    { accountNumber: "synthetic-1", balance: NaN },
    { accountNumber: "synthetic-2", balance: NaN },
    { accountNumber: "synthetic-3", balance: 0 },
  ];
  const balances = [{ balance: 1234.56 }, null, { balance: 999 }];
  let pendingCalls = 0;
  const scraper = {
    page: {},
    async fetchAccount() {
      await this.getPendingTransactions();
      return accounts.shift();
    },
    async getPendingTransactions() {
      pendingCalls++;
      return [];
    },
  };
  const originalPending = scraper.getPendingTransactions;
  addMizrahiBalanceFallback(scraper, async () => balances.shift());
  assert.equal((await scraper.fetchAccount()).balance, 1234.56);
  assert.ok(Number.isNaN((await scraper.fetchAccount()).balance));
  assert.equal((await scraper.fetchAccount()).balance, 0);
  assert.equal(pendingCalls, 3);
  assert.equal(scraper.getPendingTransactions, originalPending);
});

test("unavailable balance markup does not discard transactions", async () => {
  const account = {
    balance: NaN,
    txns: [{ identifier: "synthetic-transaction" }],
  };
  const scraper = {
    page: {},
    async fetchAccount() {
      await this.getPendingTransactions();
      return account;
    },
    async getPendingTransactions() {
      return [];
    },
  };
  addMizrahiBalanceFallback(scraper, async () => {
    throw new Error("Detached frame");
  });
  assert.equal(await scraper.fetchAccount(), account);
});
