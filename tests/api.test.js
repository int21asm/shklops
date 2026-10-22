import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { createApplication } from "../server/app.js";
import { importAccounts, hash } from "../server/store.js";
import { bankDate } from "../shared/calendar.js";

process.env.APP_ORIGIN = "http://localhost:3002";
const origin = process.env.APP_ORIGIN;
async function setup(t, options = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "shklops-test-"));
  const runtime = await createApplication({ dataDir: directory, ...options });
  t.after(async () => {
    await runtime.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const agent = () => request.agent(runtime.app);
  return { ...runtime, agent, directory };
}
const post = (a, url, body = {}) =>
  a.post(url).set("Origin", origin).send(body);
async function register(a, email = "person@example.com") {
  const response = await post(a, "/api/auth/register", {
    name: "Test",
    email,
    password: "correct horse battery staple",
  });
  assert.equal(response.status, 201);
  return response;
}
async function waitFor(a, status) {
  for (let i = 0; i < 150; i++) {
    const r = await a.get("/api/jobs");
    const job = r.body.find((j) => j.status === status);
    if (job) return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`Job never reached ${status}`);
}

test("authentication, CSRF, password hashing and logout revocation", async (t) => {
  const { agent, store } = await setup(t);
  const a = agent();
  assert.equal((await a.get("/api/data")).status, 401);
  assert.equal((await a.post("/api/auth/register").send({})).status, 403);
  assert.equal(
    (
      await post(a, "/api/auth/register", {
        email: "a@example.com",
        password: "short",
      })
    ).status,
    400,
  );
  const response = await register(a);
  assert.match(response.headers["set-cookie"][0], /HttpOnly/);
  assert.match(response.headers["set-cookie"][0], /SameSite=Strict/);
  assert.ok(
    !store.db
      .prepare("SELECT password FROM users")
      .get()
      .password.includes("correct horse"),
  );
  assert.equal((await a.get("/api/data")).status, 200);
  const cookie = response.headers["set-cookie"][0].split(";")[0];
  await post(a, "/api/auth/logout");
  assert.equal(
    (await request(a.app).get("/api/data").set("Cookie", cookie)).status,
    401,
  );
  assert.equal(
    (
      await post(a, "/api/auth/login", {
        email: "person@example.com",
        password: "incorrect password",
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await post(a, "/api/auth/login", {
        email: "person@example.com",
        password: "correct horse battery staple",
      })
    ).status,
    200,
  );
});

test("users cannot access each other’s accounts, transactions, credentials or preferences", async (t) => {
  const { agent } = await setup(t);
  const alice = agent(),
    bob = agent();
  await post(alice, "/api/auth/demo");
  const aliceData = (await alice.get("/api/data")).body;
  assert.ok(aliceData.transactions.length > 0);
  const id = aliceData.connections[0].id;
  await register(bob, "bob@example.com");
  assert.deepEqual((await bob.get("/api/data")).body.connections, []);
  assert.deepEqual((await bob.get("/api/data")).body.transactions, []);
  assert.equal((await post(bob, `/api/connections/${id}/sync`)).status, 404);
  assert.equal((await post(bob, `/api/connections/${id}/forget`)).status, 404);
  assert.equal(
    (await bob.delete(`/api/connections/${id}`).set("Origin", origin).send({}))
      .status,
    404,
  );
  await alice
    .put("/api/settings")
    .set("Origin", origin)
    .send({
      daysBack: 730,
      combineInstallments: true,
      monthlyCardEstimate: 250000,
      cardEstimatesByMonth: { "2026-12": 400000, "2027-01": 600000 },
    })
    .expect(200);
  assert.equal((await alice.get("/api/settings")).body.monthlyCardEstimate, 250000);
  assert.equal((await alice.get("/api/settings")).body.daysBack, 730);
  await alice.put("/api/settings").set("Origin", origin).send({ daysBack: 731, combineInstallments: true }).expect(400);
  assert.equal((await alice.get("/api/settings")).body.cardEstimatesByMonth["2026-12"], 400000);
  assert.equal((await bob.get("/api/settings")).body.daysBack, 90);
  assert.equal((await bob.get("/api/settings")).body.monthlyCardEstimate, null);
  assert.deepEqual((await bob.get("/api/settings")).body.cardEstimatesByMonth, {});
  assert.equal(
    (
      await bob
        .put("/api/settings")
        .set("Origin", "https://evil.example")
        .send({ daysBack: 30, combineInstallments: false })
    ).status,
    403,
  );
});

test("live adapter waits for authenticated MFA, rejects replay, imports data, and persists across restarts", async (t) => {
  let receivedCode;
  const runtime = await setup(t, {
    live: true,
    jobsOptions: {
      adapter: async ({ requestMfa, credentials }) => {
        assert.equal(credentials.password, "bank-password-test");
        receivedCode = await requestMfa();
        return {
          success: true,
          accounts: [
            {
              accountNumber: "1234",
              balance: 200.1,
              txns: [
                {
                  identifier: "salary-1",
                  date: "2026-10-01",
                  description: "משכורת",
                  chargedAmount: 100,
                  status: "completed",
                },
              ],
            },
          ],
        };
      },
    },
  });
  const { agent, store } = runtime,
    alice = agent(),
    bob = agent();
  await register(alice);
  await register(bob, "bob@example.com");
  const {
    body: { id },
  } = await post(alice, "/api/connections", {
    provider: "oneZero",
    name: "ONE ZERO test",
    remember: true,
    credentials: {
      email: "bank@example.com",
      password: "bank-password-test",
      phoneNumber: "+972500000000",
    },
  });
  const encrypted = store.db
    .prepare("SELECT credentials FROM connections WHERE id=?")
    .get(id).credentials;
  assert.ok(!encrypted.includes("bank-password-test"));
  assert.ok(
    !(await alice.get("/api/data")).text.includes("bank-password-test"),
  );
  const sync = await post(alice, `/api/connections/${id}/sync`);
  assert.equal(sync.status, 202);
  const job = await waitFor(alice, "waiting_mfa");
  assert.equal((await post(alice, `/api/connections/${id}/sync`)).status, 409);
  assert.equal(
    (
      await post(bob, `/api/jobs/${job.id}/mfa`, {
        challengeId: job.challenge.id,
        code: "123456",
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await post(alice, `/api/jobs/${job.id}/mfa`, {
        challengeId: job.challenge.id,
        code: "abc",
      })
    ).status,
    400,
  );
  const challenge = { challengeId: job.challenge.id, code: "123456" };
  assert.equal(
    (await post(alice, `/api/jobs/${job.id}/mfa`, challenge)).status,
    200,
  );
  await waitFor(alice, "completed");
  assert.equal(receivedCode, "123456");
  assert.equal(
    (await post(alice, `/api/jobs/${job.id}/mfa`, challenge)).status,
    409,
  );
  const data = (await alice.get("/api/data")).body;
  assert.equal(data.transactions.length, 1);
  assert.equal(data.accounts[0].balance, 20010);
  assert.ok(
    !JSON.stringify(store.db.prepare("SELECT * FROM runs").all()).includes(
      "123456",
    ),
  );
  // A second SQLite connection sees committed data and decrypts the retained credential.
  const reopened = await createApplication({
    dataDir: runtime.directory,
    live: true,
  });
  assert.equal(
    reopened.store.db.prepare("SELECT count(*) AS n FROM transactions").get().n,
    1,
  );
  assert.equal(
    reopened.store.decrypt(encrypted).password,
    "bank-password-test",
  );
  await reopened.close();
});

test("MFA expiry and job cancellation do not import phantom transactions", async (t) => {
  const { agent, store } = await setup(t, {
    jobsOptions: { mfaTimeout: 40, demoDelay: 1 },
  });
  const a = agent();
  await post(a, "/api/auth/demo");
  const data = (await a.get("/api/data")).body;
  const connection = data.connections.find((c) => c.provider === "oneZero");
  await post(a, `/api/connections/${connection.id}/sync`);
  const challenge = await waitFor(a, "waiting_mfa");
  const failure = await waitFor(a, "failed");
  assert.match(failure.error, /אימות/);
  assert.equal(
    (
      await post(a, `/api/jobs/${challenge.id}/mfa`, {
        challengeId: challenge.challenge.id,
        code: "123456",
      })
    ).status,
    409,
  );
  assert.equal(
    store.db
      .prepare("SELECT count(*) AS n FROM accounts WHERE connection_id=?")
      .get(connection.id).n,
    0,
  );
  await post(a, `/api/connections/${connection.id}/sync`);
  const waiting = await waitFor(a, "waiting_mfa");
  await post(a, `/api/jobs/${waiting.id}/cancel`);
  await waitFor(a, "cancelled");
  assert.equal(
    store.db
      .prepare("SELECT count(*) AS n FROM accounts WHERE connection_id=?")
      .get(connection.id).n,
    0,
  );
});

test("repeated imports deduplicate, preserve distinct identical purchases, update pending, and roll back malformed data", async (t) => {
  const { agent, store } = await setup(t);
  const a = agent();
  await register(a);
  const {
    body: { id },
  } = await post(a, "/api/connections", { provider: "hapoalim", name: "Test" });
  const transaction = {
    date: "2026-10-01",
    description: "Coffee",
    chargedAmount: -10,
    status: "pending",
  };
  const account = {
    accountNumber: "1234",
    balance: 40,
    currency: "ILS",
    txns: [transaction, { ...transaction }],
  };
  assert.equal(importAccounts(store, id, [account]), 2);
  assert.equal(
    importAccounts(store, id, [
      {
        ...account,
        txns: [
          { ...transaction, status: "completed" },
          { ...transaction, status: "completed" },
        ],
      },
    ]),
    0,
  );
  assert.equal(
    store.db
      .prepare(
        "SELECT count(*) AS n FROM transactions WHERE status='completed'",
      )
      .get().n,
    2,
  );
  assert.throws(() =>
    importAccounts(store, id, [
      {
        ...account,
        txns: [
          { ...transaction, identifier: "new" },
          { ...transaction, date: "invalid" },
        ],
      },
    ]),
  );
  assert.equal(
    store.db.prepare("SELECT count(*) AS n FROM transactions").get().n,
    2,
  );
});

test("Israeli bank calendar dates survive UTC month and DST boundaries", () => {
  assert.equal(bankDate("2026-09-30T21:00:00.000Z"), "2026-10-01");
  assert.equal(bankDate("2026-01-31T22:00:00.000Z"), "2026-02-01");
  assert.equal(bankDate("2026-10-10"), "2026-10-10");
  assert.equal(bankDate("2026-10-10T21:00:00.000Z"), "2026-10-11");
});

test("existing card currency symbols are normalized in API data without rewriting stored transactions", async (t) => {
  const { agent, store } = await setup(t);
  const a = agent();
  await register(a);
  const {
    body: { id },
  } = await post(a, "/api/connections", {
    provider: "visaCal",
    name: "Synthetic card",
  });
  importAccounts(store, id, [
    {
      accountNumber: "test",
      currency: "₪",
      balance: 0,
      txns: [
        {
          identifier: "card-purchase",
          date: "2026-10-10",
          chargedAmount: -12,
          chargedCurrency: "₪",
          description: "Synthetic purchase",
          processedDate: "2026-11-02",
          installments: { number: 1, total: 3 },
        },
      ],
    },
  ]);
  const response = await a.get("/api/data");
  assert.equal(response.status, 200);
  assert.equal(response.body.accounts[0].currency, "ILS");
  assert.equal(response.body.transactions[0].currency, "ILS");
  assert.equal(response.body.transactions[0].processed_date, "2026-11-02");
  assert.equal(response.body.transactions[0].installment_number, 1);
  assert.equal(response.body.transactions[0].installment_total, 3);
  assert.ok(response.body.transactions[0].installment_group);
  assert.equal(
    store.db.prepare("SELECT currency FROM transactions").get().currency,
    "₪",
  );
});

test("card selection removes excluded data and persists across later imports", async (t) => {
  const { agent, store } = await setup(t);
  const owner = agent();
  await register(owner);
  const { body: { id: connectionId } } = await post(owner, "/api/connections", {
    provider: "visaCal", name: "Synthetic cards",
  });
  const card = (number) => ({
    accountNumber: number, currency: "ILS", balance: -42,
    txns: [{ identifier: `purchase-${number}`, date: "2026-10-10",
      processedDate: "2026-11-10", chargedAmount: -21, chargedCurrency: "ILS",
      description: "Synthetic purchase" }],
  });
  importAccounts(store, connectionId, [card("1111"), card("2222")]);
  const original = (await owner.get("/api/data")).body;
  const kept = original.accounts.find((account) => account.number === "1111");
  const excluded = original.accounts.find((account) => account.number === "2222");
  assert.equal(original.transactions.length, 2);
  const other = agent();
  await register(other, "other@example.com");
  assert.equal((await other.patch(`/api/accounts/${excluded.id}`).set("Origin", origin).send({ enabled: false })).status, 404);
  assert.equal((await owner.patch(`/api/accounts/${excluded.id}`).set("Origin", origin).send({ enabled: false })).status, 200);
  let data = (await owner.get("/api/data")).body;
  assert.equal(data.accounts.find((account) => account.id === excluded.id).enabled, false);
  assert.equal(data.transactions.length, 1);
  assert.equal(data.transactions[0].account_id, kept.id);
  assert.equal(store.db.prepare("SELECT count(*) AS count FROM transactions WHERE account_id=?").get(excluded.id).count, 0);
  importAccounts(store, connectionId, [card("1111"), card("2222"), card("3333")]);
  data = (await owner.get("/api/data")).body;
  assert.equal(data.accounts.find((account) => account.number === "3333").enabled, false,
    "newly discovered cards require an explicit choice after the selection is configured");
  assert.equal(data.transactions.length, 1);
  assert.equal((await owner.patch(`/api/accounts/${excluded.id}`).set("Origin", origin).send({ enabled: true })).status, 200);
  assert.equal((await owner.get("/api/data")).body.transactions.length, 1,
    "enabling a card does not revive deleted transactions until the next sync");
  importAccounts(store, connectionId, [card("1111"), card("2222")]);
  data = (await owner.get("/api/data")).body;
  assert.equal(data.transactions.length, 2);
  assert.equal(data.accounts.find((account) => account.id === excluded.id).enabled, true);
});

test("resync corrects legacy Mizrahi dates without duplicating identified or identical identifier-less transactions", async (t) => {
  const { agent, store } = await setup(t);
  const a = agent();
  await register(a);
  const {
    body: { id },
  } = await post(a, "/api/connections", { provider: "mizrahi", name: "Test" });
  const credit = {
    identifier: "salary",
    date: "2026-10-01",
    description: "Synthetic credit",
    chargedAmount: 100,
    status: "completed",
  };
  const purchase = {
    date: "2026-10-01",
    description: "Synthetic purchase",
    chargedAmount: -10,
    status: "completed",
  };
  const account = {
    accountNumber: "test",
    currency: "ILS",
    txns: [credit, purchase, { ...purchase }],
  };
  assert.equal(importAccounts(store, id, [account]), 3);
  // Reproduce rows written by the previous UTC-date importer.
  const rows = store.db.prepare("SELECT * FROM transactions ORDER BY id").all();
  let occurrence = 0;
  for (const row of rows) {
    if (row.amount > 0) {
      store.db
        .prepare("UPDATE transactions SET date=?,source_date=NULL WHERE id=?")
        .run("2026-09-30", row.id);
    } else {
      const identity = JSON.stringify([
        "2026-09-30",
        purchase.description,
        -1000,
        "ILS",
        0,
      ]);
      const fingerprint = hash(`${identity}:${occurrence++}`);
      store.db
        .prepare(
          "UPDATE transactions SET id=?,fingerprint=?,date=?,source_date=NULL WHERE id=?",
        )
        .run(
          hash(`${row.account_id}:${fingerprint}`),
          fingerprint,
          "2026-09-30",
          row.id,
        );
    }
  }
  const fresh = {
    ...account,
    txns: account.txns.map((tx) => ({
      ...tx,
      date: "2026-09-30T21:00:00.000Z",
    })),
  };
  assert.equal(importAccounts(store, id, [fresh]), 0);
  assert.equal(importAccounts(store, id, [fresh]), 0);
  const corrected = store.db
    .prepare("SELECT date,source_date,amount FROM transactions")
    .all();
  assert.equal(corrected.length, 3);
  assert.ok(
    corrected.every(
      (tx) =>
        tx.date === "2026-10-01" &&
        tx.source_date === "2026-09-30T21:00:00.000Z",
    ),
  );
  assert.equal(corrected.filter((tx) => tx.amount < 0).length, 2);
});

test("Mizrahi identifier changes do not double dashboard income or real identical purchases", async (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), "shklops-mizrahi-"));
  let runtime = await createApplication({ dataDir: directory });
  t.after(async () => {
    await runtime.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const a = request.agent(runtime.app);
  await register(a);
  const { body: { id } } = await post(a, "/api/connections", {
    provider: "mizrahi", name: "Synthetic bank",
  });
  const txns = [
    { identifier: "salary", description: "Salary", chargedAmount: 19417.45 },
    { identifier: "refund", description: "Refund", chargedAmount: 41.51 },
    { identifier: "mortgage", description: "Mortgage", chargedAmount: -6662.30 },
    { identifier: "purchase-1", description: "Coffee", chargedAmount: -10 },
    { identifier: "purchase-2", description: "Coffee", chargedAmount: -10 },
  ].map((tx) => ({ ...tx, date: "2026-10-01" }));
  const account = { accountNumber: "test", currency: "ILS", balance: 1921.4, txns };
  assert.equal(importAccounts(runtime.store, id, [account]), 5);
  // Reproduce old keys derived from bank reference numbers, which changed
  // before a later import of the same statement.
  for (const row of runtime.store.db.prepare("SELECT id,account_id FROM transactions").all()) {
    const fingerprint = hash(`old-bank-reference:${row.id}`);
    runtime.store.db.prepare("UPDATE transactions SET id=?,fingerprint=? WHERE id=?")
      .run(hash(`${row.account_id}:${fingerprint}`), fingerprint, row.id);
  }
  const laterAccount = { ...account, txns: [
    ...txns,
    { identifier: "new-purchase-1", date: "2026-10-15", description: "Lunch", chargedAmount: -12 },
    { identifier: "new-purchase-2", date: "2026-10-15", description: "Lunch", chargedAmount: -12 },
  ] };
  assert.equal(importAccounts(runtime.store, id, [laterAccount]), 7);
  assert.equal((await a.get("/api/data")).body.transactions.length, 12);
  await runtime.close();
  runtime = await createApplication({ dataDir: directory });
  const reopened = request.agent(runtime.app);
  assert.equal((await post(reopened, "/api/auth/login", {
    email: "person@example.com", password: "correct horse battery staple",
  })).status, 200);
  const data = (await reopened.get("/api/data")).body;
  assert.equal(data.transactions.length, 7);
  assert.equal(data.total, 7);
  assert.equal(data.transactions.filter((tx) => tx.amount > 0).reduce((sum, tx) => sum + tx.amount, 0), 1945896);
  assert.equal(data.transactions.filter((tx) => tx.description === "Coffee").length, 2);
  assert.equal(data.transactions.filter((tx) => tx.description === "Lunch").length, 2);
  assert.equal(importAccounts(runtime.store, id, [laterAccount]), 0);
  assert.equal((await reopened.get("/api/data")).body.transactions.length, 7);
});

test("live scraping stays disabled by default and credentials are not accepted in that mode", async (t) => {
  const { agent, store } = await setup(t);
  const a = agent();
  await register(a);
  const body = {
    provider: "hapoalim",
    name: "Test",
    remember: true,
    credentials: { userCode: "abc", password: "test-bank-password" },
  };
  assert.equal((await post(a, "/api/connections", body)).status, 400);
  assert.equal(
    store.db.prepare("SELECT count(*) AS n FROM connections").get().n,
    0,
  );
  const {
    body: { id },
  } = await post(a, "/api/connections", { provider: "hapoalim", name: "Test" });
  assert.equal((await post(a, `/api/connections/${id}/sync`)).status, 403);
});

test("a bank failure is sanitized and never imports its data", async (t) => {
  const { agent } = await setup(t, {
    live: true,
    jobsOptions: {
      adapter: async () => ({
        success: false,
        errorType: "INVALID_PASSWORD",
        errorMessage: "sensitive bank payload must not escape",
      }),
    },
  });
  const a = agent();
  await register(a);
  const {
    body: { id },
  } = await post(a, "/api/connections", {
    provider: "hapoalim",
    name: "Failure test",
  });
  await post(a, `/api/connections/${id}/sync`, {
    credentials: { userCode: "test", password: "test-only" },
  });
  const job = await waitFor(a, "failed");
  assert.match(job.error, /פרטי הכניסה/);
  const data = await a.get("/api/data");
  assert.equal(data.body.transactions.length, 0);
  assert.ok(!data.text.includes("sensitive bank payload"));
});

test("Isracard login and empty-result failures explain why no card data appears", async (t) => {
  let response = { success: false, errorType: "CHANGE_PASSWORD" };
  const { agent } = await setup(t, {
    live: true,
    jobsOptions: { adapter: async () => response },
  });
  const a = agent();
  await register(a);
  const {
    body: { id },
  } = await post(a, "/api/connections", {
    provider: "isracard",
    name: "Card test",
  });
  const sync = () =>
    post(a, `/api/connections/${id}/sync`, {
      credentials: { id: "000000000", card6Digits: "123456", password: "test-only" },
    });
  assert.equal((await sync()).status, 202);
  let job = await waitFor(a, "failed");
  assert.match(job.error, /אתר ישראכרט ביקש שינוי סיסמה/);
  assert.match(job.error, /לא יובאו נתונים/);
  response = { success: true, accounts: [] };
  assert.equal((await sync()).status, 202);
  for (let i = 0; i < 150; i++) {
    const jobs = (await a.get("/api/jobs")).body;
    job = jobs.find((entry) => entry.id !== job.id && entry.status === "failed");
    if (job) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.match(job.error, /בלי חשבונות או כרטיסים/);
  const data = (await a.get("/api/data")).body;
  assert.equal(data.accounts.length, 0);
  assert.equal(data.connections.find((connection) => connection.id === id).status, "failed");
  assert.equal(data.runs[0].error, job.error);
});

test("a delayed MFA callback cannot resurrect a cancelled run", async (t) => {
  let continueBank;
  const gate = new Promise((resolve) => {
    continueBank = resolve;
  });
  let stopped = false;
  const { agent } = await setup(t, {
    live: true,
    jobsOptions: {
      adapter: async ({ requestMfa }) => {
        await gate;
        try {
          await requestMfa();
        } catch {
          stopped = true;
        }
        return { success: true, accounts: [] };
      },
    },
  });
  const a = agent();
  await register(a);
  const {
    body: { id },
  } = await post(a, "/api/connections", {
    provider: "hapoalim",
    name: "Cancel test",
  });
  const start = await post(a, `/api/connections/${id}/sync`, {
    credentials: { userCode: "test", password: "test-only" },
  });
  await post(a, `/api/jobs/${start.body.id}/cancel`);
  continueBank();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(stopped);
  const job = (await a.get("/api/jobs")).body.find(
    (j) => j.id === start.body.id,
  );
  assert.equal(job.status, "cancelled");
  assert.equal(job.challenge, null);
});
