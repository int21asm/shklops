import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createStore, importAccounts } from "../server/store.js";
import { createCategoryJobs } from "../server/category-jobs.js";
import { createAiChat } from "../server/ai-chat.js";
import { categoryPromptVersion } from "../server/category-prompt.js";

const classification = (id, category, extra = {}) => ({ id, category, explanation: "סוג בית העסק מזוהה מהתיאור", confidence: "high", lookup: "not_needed", source_urls: [], ...extra });
const sse = (categories, output = []) => new Response(`data: ${JSON.stringify({ type: "response.completed", response: {
  output: [...output, { type: "message", content: [{ type: "output_text", text: JSON.stringify({ categories }) }] }],
} })}\n\n`);

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
    return { model: "test-model", version: categoryPromptVersion, categories: merchants.map((item) => ({ id: item.id,
      category: item.description.includes("ישראייר") ? "תיירות וחופשות" : "מזון וקניות",
      explanation: "בית עסק לטיסות או מזון", confidence: "high", sources: ["https://example.com/"], webSearched: true })) };
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
  const saved = store.db.prepare("SELECT category_explanation,category_confidence,category_sources,category_web_searched,category_version FROM transactions WHERE category='תיירות וחופשות' LIMIT 1").get();
  assert.deepEqual({ ...saved }, { category_explanation: "בית עסק לטיסות או מזון", category_confidence: "high", category_sources: '["https://example.com/"]', category_web_searched: 1, category_version: categoryPromptVersion });
  importAccounts(store, "card", [{ accountNumber: "4814", txns: original }]);
  assert.equal(calls, 1, "sync never invokes the model");
  assert.equal(jobs.status("alice").pendingTransactions, 0);
  assert.equal(store.db.prepare("SELECT count(*) AS n FROM transactions WHERE category='תיירות וחופשות'").get().n, 2);
  assert.equal(store.db.prepare("SELECT count(*) AS n FROM transactions WHERE category_version=?").get(categoryPromptVersion).n, 3);
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
  let categories = [classification("wrong", "תחבורה")];
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
  categories = [classification("0", "invented-category")];
  await assert.rejects(chat.classify("alice", [{ id: "0", description: "סונול" }], "test-model"), /לא החזיר סיווג תקין/);
  categories = [classification("0", "תחבורה")];
  assert.equal((await chat.classify("alice", [{ id: "0", description: "סונול" }], "test-model")).categories[0].category, "תחבורה");
});

test("uncertain public merchants require web research and only verified sources are saved", async (t) => {
  const store = setup(t);
  const requests = [], progress = [];
  const merchants = [{ id: "0", description: "עסק ציבורי לדוגמה" }, { id: "1", description: "העברה בBIT" }];
  const chat = createAiChat(store, { token: async () => "test-token" }, { fetcher: async (url, options) => {
    if (url.endsWith("/models")) return Response.json({ models: [{ slug: "test-model", visibility: "list" }] });
    const request = JSON.parse(options.body); requests.push(request);
    if (!request.tools) return sse([
      classification("0", "כללי", { confidence: "low", lookup: "needed" }),
      classification("1", "העברות ומשיכות מזומן", { lookup: "private" }),
    ]);
    assert.deepEqual(JSON.parse(request.input[0].content), [merchants[0]]);
    assert.deepEqual(request.tools, [{ type: "web_search" }]);
    assert.equal(request.tool_choice, "required");
    return sse([classification("0", "מחשבים ואלקטרוניקה", { source_urls: ["https://merchant.example/?utm_source=openai", "https://invented.example/", "javascript:alert(1)"] })],
      [{ type: "web_search_call", status: "completed", action: { sources: [{ url: "https://merchant.example/" }] } }]);
  } });
  const result = await chat.classify("alice", merchants, "test-model", undefined, { onLookup: (event) => progress.push(event) });
  assert.equal(requests.length, 2);
  assert.deepEqual(progress, ["started", "completed"]);
  assert.equal(result.categories[0].category, "מחשבים ואלקטרוניקה");
  assert.deepEqual(result.categories[0].sources, ["https://merchant.example/"]);
  assert.equal(result.categories[0].webSearched, true);
  assert.equal(result.categories[1].webSearched, false);
  assert.equal(result.version, categoryPromptVersion);
  assert.match(requests[0].instructions, /shared name such as פנדה/);
});

test("web research cannot claim an identified merchant without verified evidence and reports unavailable search", async (t) => {
  const store = setup(t);
  let webMode = "unverified";
  const chat = createAiChat(store, { token: async () => "test-token" }, { fetcher: async (url, options) => {
    if (url.endsWith("/models")) return Response.json({ models: [{ slug: "test-model", visibility: "list" }] });
    const request = JSON.parse(options.body);
    if (!request.tools) return sse([classification("0", "כללי", { lookup: "needed", confidence: "low" })]);
    if (webMode === "unavailable") return new Response("not supported", { status: 403 });
    return sse([classification("0", "מזון וקניות", { source_urls: ["https://invented.example/"] })],
      webMode === "not_run" ? [] : [{ type: "web_search_call", status: "completed", action: { sources: [] } }]);
  } });
  const result = await chat.classify("alice", [{ id: "0", description: "עסק לא מזוהה" }], "test-model");
  assert.equal(result.categories[0].category, "כללי");
  assert.equal(result.categories[0].confidence, "low");
  assert.deepEqual(result.categories[0].sources, []);
  webMode = "not_run";
  await assert.rejects(chat.classify("alice", [{ id: "0", description: "עסק לא מזוהה" }], "test-model"), /לא ביצע את בדיקת הרשת/);
  webMode = "unavailable";
  await assert.rejects(chat.classify("alice", [{ id: "0", description: "עסק לא מזוהה" }], "test-model"), /החיפוש ברשת אינו זמין/);
});

test("manual general-only refresh does not replace other saved categories", async (t) => {
  const store = setup(t);
  importAccounts(store, "card", [{ accountNumber: "4814", txns: [tx("general", "בית עסק לא מזוהה"), tx("known", "סונול")] }]);
  store.db.prepare("UPDATE transactions SET category=CASE description WHEN 'סונול' THEN 'תחבורה' ELSE 'כללי' END,category_source='chatgpt',category_description=description").run();
  let received;
  const jobs = createCategoryJobs(store, { classify: async (_user, merchants, _model, _signal, options) => {
    received = merchants; options.onLookup("started"); options.onLookup("completed");
    return { model: "test-model", version: categoryPromptVersion, categories: merchants.map((item) => ({ ...classification(item.id, "מחשבים ואלקטרוניקה"), sources: ["https://example.com/"], webSearched: true })) };
  } }, { status: () => ({ connected: true }) });
  t.after(() => jobs.shutdown());
  assert.equal(jobs.status("alice").generalTransactions, 1);
  jobs.start("alice", { generalOnly: true });
  const result = await completed(jobs);
  assert.equal(received.length, 1);
  assert.equal(received[0].description, "בית עסק לא מזוהה");
  assert.equal(result.generalTransactions, 0);
  assert.equal(result.job.researchedMerchants, 1);
  assert.equal(store.db.prepare("SELECT category FROM transactions WHERE description='סונול'").get().category, "תחבורה");
});
