import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { createStore } from "../server/store.js";
import { createAiAuth, verifyIdentity } from "../server/ai-auth.js";
import { createAiChat, executeFinanceTool } from "../server/ai-chat.js";
import { createApplication } from "../server/app.js";
import { bankDate } from "../shared/calendar.js";

function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), "shklops-ai-"));
  const store = createStore(directory);
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  for (const id of ["alice", "bob"])
    store.db.prepare("INSERT INTO users(id,email,name) VALUES(?,?,?)").run(id, `${id}@example.com`, id);
  return store;
}

function addAccount(store, userId, provider, number, balance) {
  const connectionId = randomUUID(), accountId = randomUUID();
  store.db.prepare("INSERT INTO connections(id,user_id,provider,name) VALUES(?,?,?,?)")
    .run(connectionId, userId, provider, provider);
  store.db.prepare("INSERT INTO accounts(id,connection_id,number,currency,balance) VALUES(?,?,?,?,?)")
    .run(accountId, connectionId, number, "ILS", balance);
  return accountId;
}

function addTransaction(store, accountId, date, description, amount, category = "כללי") {
  const id = randomUUID();
  store.db.prepare(`INSERT INTO transactions(id,account_id,fingerprint,date,description,amount,currency,status,category)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(id, accountId, id, date, description, amount, "ILS", "completed", category);
  return id;
}

test("finance tools query only the signed-in user's enabled data and reuse dashboard forecast math", (t) => {
  const store = fixture(t);
  const today = bankDate(new Date());
  const current = today.slice(0, 7);
  const future = new Date(`${current}-15T12:00:00Z`);
  future.setUTCMonth(future.getUTCMonth() + 1);
  const nextMonth = future.toISOString().slice(0, 7);
  const previous = new Date(`${current}-15T12:00:00Z`);
  previous.setUTCMonth(previous.getUTCMonth() - 1);
  const previousMonth = previous.toISOString().slice(0, 7);
  const bank = addAccount(store, "alice", "mizrahi", "1234", 192140);
  const card = addAccount(store, "alice", "visaCal", "4814", null);
  const other = addAccount(store, "bob", "mizrahi", "9999", 99999900);
  addTransaction(store, bank, `${current}-01`, "משכורת", 1900000, "שכר");
  addTransaction(store, bank, `${current}-02`, "סופר", -12000, "קניות");
  addTransaction(store, other, `${current}-02`, "פרטי בוב", 99999900);
  addTransaction(store, bank, `${previousMonth}-05`, "טפחות - לווים", -666730);
  store.db.prepare("UPDATE accounts SET next_charge=?,next_charge_date=? WHERE id=?")
    .run(1276107, `${nextMonth}-10`, card);
  store.db.prepare("UPDATE users SET settings=? WHERE id='alice'")
    .run(JSON.stringify({ monthlyIncome: 1900000 }));
  const summary = executeFinanceTool(store.db, "alice", "finance.month_summary", { month: current });
  assert.equal(summary.bankIncome, 19000);
  assert.equal(summary.bankExpenses, 120);
  const found = executeFinanceTool(store.db, "alice", "finance.search_transactions", {
    start: `${current}-01`, end: `${current}-31`, kind: "all", keyword: null,
  });
  assert.equal(found.transactions.some((row) => row.description === "פרטי בוב"), false);
  for (let index = 0; index < 35; index++) addTransaction(store, bank, `${current}-03`, "מרכול", -100);
  const grocery = executeFinanceTool(store.db, "alice", "finance.search_transactions", {
    start: `${current}-01`, end: `${current}-31`, kind: "bank", keyword: "מרכול",
  });
  assert.equal(grocery.totalMatches, 35);
  assert.equal(grocery.transactions.length, 30);
  assert.equal(grocery.completedTotals[0].debits, 35);
  const forecast = executeFinanceTool(store.db, "alice", "finance.cashflow_forecast", { month: nextMonth });
  assert.equal(forecast.openingBankBalance, 1921.4);
  assert.equal(forecast.monthlyIncome, 19000);
  assert.equal(forecast.recurringMortgage, 6667.3);
  assert.equal(forecast.knownCardCharges, 12761.07);
  assert.equal(forecast.estimatedClosingBalance, 1493.03);
});

test("token refresh is serialized and cannot restore a disconnected account", async (t) => {
  const store = fixture(t);
  store.db.prepare("INSERT INTO ai_connections(user_id,client_id,subject,credentials,expires_at) VALUES(?,?,?,?,?)")
    .run("alice", "oaiapp_test", "subject", store.encrypt({ accessToken: "old-access", refreshToken: "old-refresh" }), 0);
  let finishRefresh, refreshCount = 0;
  const fetcher = async (url) => {
    if (url.endsWith("/oauth/token")) {
      refreshCount++;
      return new Promise((resolve) => { finishRefresh = () => resolve(Response.json({
        access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600,
      })); });
    }
    if (url.endsWith("openid-configuration")) return Response.json({ revocation_endpoint: "https://auth.openai.com/revoke" });
    if (url.endsWith("/revoke")) return new Response(null, { status: 200 });
    throw new Error("Unexpected request");
  };
  const auth = createAiAuth(store, { fetcher });
  t.after(() => auth.close());
  const first = auth.token("alice"), second = auth.token("alice");
  assert.equal(refreshCount, 1);
  const rejected = Promise.allSettled([first, second]);
  assert.deepEqual(await auth.disconnect("alice"), { ok: true, revoked: true });
  finishRefresh();
  assert.ok((await rejected).every((result) => result.status === "rejected"));
  assert.equal(auth.status("alice").connected, false);
  assert.equal(store.db.prepare("SELECT credentials FROM ai_connections WHERE user_id='alice'").get().credentials, null);
});

test("OAuth validates state, signature, audience and nonce before storing encrypted tokens", async (t) => {
  const store = fixture(t);
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" });
  jwk.kid = "test-key";
  jwk.use = "sig";
  const fakeFetch = async (url, options) => {
    if (url.endsWith("/jwks.json")) return Response.json({ keys: [jwk] });
    if (url.endsWith("/oauth/token")) {
      const nonce = currentNonce;
      const clientId = "oaiapp_test";
      const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "test-key" })).toString("base64url");
      const payload = Buffer.from(JSON.stringify({ iss: "https://auth.openai.com", aud: [clientId],
        sub: "openai-alice", email: "openai@example.com", nonce,
        iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
      const content = `${header}.${payload}`;
      const idToken = `${content}.${sign("RSA-SHA256", Buffer.from(content), privateKey).toString("base64url")}`;
      return Response.json({ id_token: idToken, access_token: "secret-access", refresh_token: "secret-refresh",
        scope: "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct", expires_in: 3600 });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  let currentNonce;
  const auth = createAiAuth(store, { fetcher: fakeFetch });
  t.after(() => auth.close());
  const authorization = new URL(await auth.start("alice", "http://localhost:3002"));
  currentNonce = authorization.searchParams.get("nonce");
  const redirect = new URL(authorization.searchParams.get("redirect_uri"));
  const bad = await fetch(`${redirect}?code=abc&state=wrong`, { redirect: "manual" });
  assert.equal(bad.status, 400);
  assert.equal(auth.status("alice").connected, false);
  const good = await fetch(`${redirect}?code=abc&state=${authorization.searchParams.get("state")}&client_id=oaiapp_test`, { redirect: "manual" });
  assert.equal(good.status, 302);
  assert.equal(auth.status("alice").connected, true);
  assert.equal(auth.status("bob").connected, false);
  const stored = store.db.prepare("SELECT credentials FROM ai_connections WHERE user_id='alice'").get().credentials;
  assert.equal(stored.includes("secret-access"), false);
  assert.equal(stored.includes("secret-refresh"), false);
  assert.equal(await auth.token("alice"), "secret-access");
  const idToken = store.decrypt(stored).idToken;
  await assert.rejects(verifyIdentity(idToken, "oaiapp_other", currentNonce, fakeFetch));
  await assert.rejects(verifyIdentity(idToken, "oaiapp_test", "wrong-nonce", fakeFetch));
  const parts = idToken.split(".");
  await assert.rejects(verifyIdentity(`${parts[0]}.${parts[1]}.AA`, "oaiapp_test", currentNonce, fakeFetch));
});

test("a rejected OAuth exchange reports its safe cause without exposing provider details", async (t) => {
  const store = fixture(t);
  const auth = createAiAuth(store, { fetcher: async () => Response.json({
    error: "invalid_grant", error_description: "do-not-expose-secret-code",
  }, { status: 400 }) });
  t.after(() => auth.close());
  const authorization = new URL(await auth.start("alice", "http://localhost:3002"));
  const callback = new URL(authorization.searchParams.get("redirect_uri"));
  callback.searchParams.set("state", authorization.searchParams.get("state"));
  callback.searchParams.set("code", "private-authorization-code");
  callback.searchParams.set("client_id", "oaiapp_test");
  const result = await fetch(callback, { redirect: "manual" });
  assert.equal(result.status, 302);
  const status = auth.status("alice");
  assert.equal(status.connected, false);
  assert.equal(status.error.stage, "token_exchange");
  assert.match(status.error.message, /invalid_grant/);
  assert.doesNotMatch(JSON.stringify(status), /do-not-expose|private-authorization/);
});

test("AI HTTP routes require a Shklops session and same-origin writes", async (t) => {
  const oldOrigin = process.env.APP_ORIGIN;
  process.env.APP_ORIGIN = "http://localhost:3002";
  const directory = mkdtempSync(path.join(tmpdir(), "shklops-ai-routes-"));
  const runtime = await createApplication({ dataDir: directory });
  t.after(async () => { await runtime.close(); rmSync(directory, { recursive: true, force: true });
    if (oldOrigin === undefined) delete process.env.APP_ORIGIN; else process.env.APP_ORIGIN = oldOrigin; });
  const anonymous = request.agent(runtime.app);
  assert.equal((await anonymous.get("/api/ai/status")).status, 401);
  const alice = request.agent(runtime.app);
  await alice.post("/api/auth/demo").set("Origin", "http://localhost:3002").send({}).expect(201);
  assert.deepEqual((await alice.get("/api/ai/status")).body, { connected: false, email: null });
  await alice.post("/api/ai/connect").set("Origin", "http://evil.example").send({}).expect(403);
  await alice.post("/api/ai/ask").set("Origin", "http://localhost:3002")
    .send({ question: "כמה הוצאתי החודש?" }).expect(409);
});

test("assistant executes bounded read-only tools and returns calculation sources", async (t) => {
  const store = fixture(t);
  const month = bankDate(new Date()).slice(0, 7);
  const bank = addAccount(store, "alice", "mizrahi", "1234", 10000);
  addTransaction(store, bank, `${month}-01`, "משכורת", 1000000);
  let calls = 0;
  const fakeFetch = async (url) => {
    if (url.endsWith("/models")) return Response.json({ models: [{ slug: "test-model", display_name: "Test", visibility: "list" }] });
    if (url.endsWith("/responses")) {
      calls++;
      const item = calls === 1
        ? { type: "function_call", namespace: "finance", name: "month_summary", call_id: "call-1", arguments: JSON.stringify({ month }) }
        : { type: "message", content: [{ type: "output_text", text: "הכנסה של 10,000 ₪" }] };
      const done = JSON.stringify({ type: "response.output_item.done", output_index: 0, item });
      const event = JSON.stringify({ type: "response.completed", response: { output: [] } });
      return new Response(`event: response.output_item.done\r\ndata: ${done}\r\n\r\nevent: response.completed\r\ndata: ${event}\r\n\r\n`, { headers: { "Content-Type": "text/event-stream" } });
    }
    throw new Error("Unexpected request");
  };
  const chat = createAiChat(store, { token: async () => "test-token" }, { fetcher: fakeFetch });
  const result = await chat.ask("alice", "כמה הכנסה היתה החודש?", "test-model");
  assert.equal(result.answer, "הכנסה של 10,000 ₪");
  assert.equal(result.sources[0].data.bankIncome, 10000);
  assert.equal(calls, 2);
});

test("OpenAI timeouts return a useful error and log no prompts or credentials", async (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), "shklops-ai-timeout-"));
  const oldOrigin = process.env.APP_ORIGIN;
  process.env.APP_ORIGIN = "http://localhost:3002";
  const logs = [];
  const originalLog = console.error;
  console.error = (entry) => logs.push(entry);
  const runtime = await createApplication({ dataDir: directory, aiOptions: { fetcher: async (url) => {
    if (url.endsWith("/models")) return Response.json({ models: [{ slug: "test-model", visibility: "list" }] });
    throw new DOMException("private-provider-details\nprivate-provider-extra", "TimeoutError");
  } } });
  t.after(async () => {
    console.error = originalLog;
    await runtime.close(); rmSync(directory, { recursive: true, force: true });
    if (oldOrigin === undefined) delete process.env.APP_ORIGIN; else process.env.APP_ORIGIN = oldOrigin;
  });
  const user = request.agent(runtime.app);
  const created = await user.post("/api/auth/demo").set("Origin", "http://localhost:3002").send({});
  runtime.store.db.prepare("INSERT INTO ai_connections(user_id,client_id,subject,credentials,expires_at) VALUES(?,?,?,?,?)")
    .run(created.body.user.id, "test-client", "test-subject", runtime.store.encrypt({ accessToken: "private-token", refreshToken: "private-refresh" }), Date.now() + 3600000);
  const result = await user.post("/api/ai/ask").set("Origin", "http://localhost:3002")
    .send({ question: "private-question-text", model: "test-model" });
  assert.equal(result.status, 504);
  assert.match(result.body.error, /ארכה יותר מדי זמן/);
  assert.ok(result.body.requestId);
  const logged = JSON.stringify(logs);
  assert.match(logged, /request_timeout/);
  assert.doesNotMatch(logged, /private-question|private-token|private-refresh|private-provider/);
});

test("monthly comparisons can execute more than four read-only queries in one response", async (t) => {
  const store = fixture(t);
  let round = 0;
  const fetcher = async (url, options) => {
    if (url.endsWith("/models")) return Response.json({ models: [{ slug: "test-model", visibility: "list" }] });
    round++;
    const input = JSON.parse(options.body).input;
    if (round === 2) assert.equal(input.filter((item) => item.type === "function_call_output").length, 6);
    const output = round === 1 ? Array.from({ length: 6 }, (_, index) => ({
      type: "function_call", namespace: "finance", name: "month_summary", call_id: `call-${index}`,
      arguments: JSON.stringify({ month: `2026-${String(index + 3).padStart(2, "0")}` }),
    })) : [{ type: "message", content: [{ type: "output_text", text: "ההשוואה הושלמה" }] }];
    const event = JSON.stringify({ type: "response.completed", response: { output } });
    return new Response(`data: ${event}\n\n`);
  };
  const chat = createAiChat(store, { token: async () => "test-token" }, { fetcher });
  const result = await chat.ask("alice", "תחשב כמה בספטמבר ואוגוסט", "test-model");
  assert.equal(result.answer, "ההשוואה הושלמה");
  assert.equal(result.sources.length, 6);
});
