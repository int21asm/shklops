import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createStore, importAccounts } from "../server/store.js";
import { createCategoryJobs } from "../server/category-jobs.js";
import { createAiChat } from "../server/ai-chat.js";

function setup(t) {
  const directory = mkdtempSync(path.join(tmpdir(), "shklops-categories-"));
  const store = createStore(directory);
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  for (const user of ["alice", "bob"]) store.db.prepare("INSERT INTO users(id,email,name) VALUES(?,?,?)").run(user, `${user}@example.com`, user);
  for (const [id, owner, provider] of [["card", "alice", "visaCal"], ["bank", "alice", "mizrahi"], ["other", "bob", "visaCal"]])
    store.db.prepare("INSERT INTO connections(id,user_id,provider,name) VALUES(?,?,?,?)").run(id, owner, provider, id);
  return store;
}
const tx = (id, description) => ({ identifier: id, date: "2026-10-10", description, chargedAmount: -100, status: "completed" });
async function completed(jobs, user = "alice") {
  for (let i = 0; i < 200; i++) {
    const value = jobs.status(user);
    if (value.job?.status !== "running") return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail("Categorization job did not finish");
}

test("manual card classification is scoped, grouped, persisted, and preserved through sync", async (t) => {
  const store = setup(t);
  const original = [tx("a", 'ישראייר תעופה בע"מ'), tx("b", 'ישראייר תעופה בע"מ'), tx("c", "שופרסל")];
  importAccounts(store, "card", [{ accountNumber: "4814", txns: [...original, { ...tx("p", "ממתין"), status: "pending" }] }]);
  importAccounts(store, "bank", [{ accountNumber: "1886", txns: [tx("bank", "שופרסל")] }]);
  importAccounts(store, "other", [{ accountNumber: "9999", txns: [tx("other", "שופרסל")] }]);
  importAccounts(store, "card", [{ accountNumber: "0936", txns: [tx("excluded", "כרטיס שלא נבחר")] }]);
  store.db.prepare("UPDATE accounts SET enabled=0 WHERE number='0936'").run();
  let calls = 0, received = [];
  const jobs = createCategoryJobs(store, { classify: async (_user, merchants) => {
    calls++; received = merchants;
    return { model: "test-model", categories: merchants.map((item) => ({ id: item.id,
      category: item.description.includes("ישראייר") ? "תיירות וחופשות" : "מזון וקניות" })) };
  } }, { status: () => ({ connected: true }) });
  t.after(() => jobs.shutdown());
  assert.equal(calls, 0);
  assert.equal(jobs.status("alice").pendingTransactions, 3);
  jobs.start("alice");
  const result = await completed(jobs);
  assert.equal(result.job.updatedTransactions, 3);
  assert.equal(received.length, 2);
  assert.equal(result.pendingTransactions, 0);
  assert.equal(store.db.prepare("SELECT count(*) AS n FROM transactions WHERE category_source='chatgpt'").get().n, 3);
  assert.equal(store.db.prepare("SELECT count(*) AS n FROM transactions WHERE category='תיירות וחופשות'").get().n, 2);
  importAccounts(store, "card", [{ accountNumber: "4814", txns: original }]);
  assert.equal(calls, 1, "sync never invokes the model");
  assert.equal(jobs.status("alice").pendingTransactions, 0);
  assert.equal(store.db.prepare("SELECT count(*) AS n FROM transactions WHERE category='תיירות וחופשות'").get().n, 2);
  jobs.start("alice");
  await completed(jobs);
  assert.equal(calls, 1, "already classified rows are skipped by default");
  jobs.start("alice", { refresh: true });
  assert.equal((await completed(jobs)).job.updatedTransactions, 3);
  assert.equal(calls, 2);
  importAccounts(store, "card", [{ accountNumber: "4814", txns: [{ ...original[0], description: "תיאור בית עסק מעודכן" }] }]);
  assert.equal(jobs.status("alice").pendingTransactions, 1, "changed descriptions await a manual refresh");
});

test("completed batches survive a later failure and a manual retry handles only remaining rows", async (t) => {
  const store = setup(t);
  importAccounts(store, "card", [{ accountNumber: "4814", txns: Array.from({ length: 26 }, (_, index) => tx(`t-${index}`, `בית עסק ${index}`)) }]);
  let calls = 0;
  const jobs = createCategoryJobs(store, { classify: async (_user, merchants) => {
    calls++;
    if (calls === 2) throw Object.assign(new Error("שגיאת בדיקה"), { status: 502 });
    return { model: "test-model", categories: merchants.map((item) => ({ id: item.id, category: "כללי" })) };
  } }, { status: () => ({ connected: true }) });
  t.after(() => jobs.shutdown());
  jobs.start("alice");
  assert.throws(() => jobs.start("alice"), /כבר פועל/);
  const partial = await completed(jobs);
  assert.equal(partial.job.status, "failed");
  assert.equal(partial.job.updatedTransactions, 25);
  assert.equal(partial.pendingTransactions, 1);
  jobs.start("alice");
  assert.equal((await completed(jobs)).pendingTransactions, 0);
  assert.equal(jobs.status("alice").job.updatedTransactions, 1);
});

test("structured classifications reject invented ids and invalid categories", async (t) => {
  const store = setup(t);
  let categories = [{ id: "wrong", category: "תחבורה" }];
  const chat = createAiChat(store, { token: async () => "test-token" }, { fetcher: async (url, options) => {
    if (url.endsWith("/models")) return Response.json({ models: [{ slug: "test-model", visibility: "list" }] });
    const request = JSON.parse(options.body);
    assert.equal(request.text.format.strict, true);
    assert.equal(request.store, false);
    const event = { type: "response.completed", response: { output: [{ type: "message", content: [{
      type: "output_text", text: JSON.stringify({ categories }),
    }] }] } };
    return new Response(`data: ${JSON.stringify(event)}\n\n`);
  } });
  await assert.rejects(chat.classify("alice", [{ id: "0", description: "סונול" }], "test-model"), /לא תואם/);
  categories = [{ id: "0", category: "invented-category" }];
  await assert.rejects(chat.classify("alice", [{ id: "0", description: "סונול" }], "test-model"), /לא החזיר סיווג תקין/);
  categories = [{ id: "0", category: "תחבורה" }];
  assert.equal((await chat.classify("alice", [{ id: "0", description: "סונול" }], "test-model")).categories[0].category, "תחבורה");
});
