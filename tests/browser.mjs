import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { readMizrahiBalance } from "../server/mizrahi-balance.js";
import { formatMoney } from "../shared/currency.js";

const url = process.env.TEST_URL || "http://localhost:3002";
async function openAccounts(page) {
  await page.locator("nav").getByRole("button", { name: "הגדרות", exact: true }).click();
  await page.locator(".settings-nav").getByRole("button", { name: "חשבונות וכרטיסים" }).click();
}
mkdirSync("test-results", { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
const errors = [];
try {
  const context = await browser.newContext({
    timezoneId: "Asia/Jerusalem",
    viewport: { width: 1440, height: 1100 },
    acceptDownloads: true,
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url);
  assert.equal(await page.locator("html").getAttribute("dir"), "rtl");
  await page
    .getByRole("button", { name: "כניסה להדגמה עם נתונים לדוגמה" })
    .click();
  await page.getByRole("heading", { name: "הכסף שלכם, בתמונה אחת." }).waitFor();
  const bankRecent = page.getByRole("region", {
    name: "התנועות האחרונות בבנק",
    exact: true,
  });
  const cardRecent = page.getByRole("region", {
    name: "חיובים קרובים בכרטיסי האשראי",
    exact: true,
  });
  await bankRecent.locator("tbody tr").first().waitFor();
  await cardRecent.locator("tbody tr").first().waitFor();
  assert.equal(await bankRecent.locator("tbody tr").count(), 5);
  assert.equal(await cardRecent.locator("tbody tr").count(), 1);
  assert.ok((await cardRecent.locator(".upcoming-card-totals").textContent()).includes("₪"));
  assert.ok(
    (await bankRecent.locator("tbody").textContent()).includes("בנק הפועלים"),
  );
  assert.ok(!(await bankRecent.locator("tbody").textContent()).includes("max"));
  assert.ok((await cardRecent.locator("tbody").textContent()).includes("max"));
  assert.ok(
    !(await cardRecent.locator("tbody").textContent()).includes("בנק הפועלים"),
  );
  assert.equal(await page.getByText("התמונה המלאה מתחילה כאן").count(), 0);
  assert.equal(await page.getByText("ניווט", { exact: true }).count(), 0);
  assert.equal(await page.locator("nav").getByRole("button", { name: "חשבונות וכרטיסים" }).count(), 0);
  await page.locator("nav").getByRole("button", { name: "שאלו את שקלופס" }).click();
  await page.getByRole("heading", { name: "חברו את תוכנית ChatGPT שלכם" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "המשך עם ChatGPT" }).count(), 1);
  await page.locator("nav").getByRole("button", { name: "סקירה כללית", exact: true }).click();
  await page.route("**/api/ai/status", (route) => route.fulfill({ json: {
    connected: false, email: null, error: { stage: "token_exchange", message: "OpenAI דחה את החלפת קוד האישור (invalid_grant, HTTP 400)." },
  } }));
  await page.locator("nav").getByRole("button", { name: "שאלו את שקלופס" }).click();
  await page.getByRole("alert").filter({ hasText: "invalid_grant" }).waitFor();
  await page.locator("nav").getByRole("button", { name: "סקירה כללית", exact: true }).click();
  await page.unroute("**/api/ai/status");
  await page.route("**/api/ai/status", (route) => route.fulfill({ json: { connected: true, email: "test@example.com" } }));
  await page.route("**/api/ai/models", (route) => route.fulfill({ json: [{ id: "test-model", name: "Test model" }] }));
  await page.route("**/api/ai/ask", (route) => route.fulfill({ json: {
    answer: "היתרה הצפויה היא 1,493.03 ₪, לפי הנתונים הזמינים.",
    sources: [{ tool: "finance.cashflow_forecast", data: { month: "2026-11", openingBankBalance: 1921.4,
      monthlyIncome: 19000, recurringMortgage: 6667.3, knownCardCharges: 12761.07,
      estimatedClosingBalance: 1493.03, partial: true } }],
  } }));
  await page.locator("nav").getByRole("button", { name: "שאלו את שקלופס" }).click();
  await page.getByLabel("השאלה שלכם").fill("איך חושבה תחזית התזרים?");
  await page.getByRole("button", { name: "שליחה", exact: true }).click();
  await page.locator(".ai-answer").filter({ hasText: "1,493.03" }).waitFor();
  await page.getByText("הנתונים ששימשו לתשובה", { exact: true }).click();
  assert.ok((await page.locator(".ai-sources").textContent()).includes("משכנתא"));
  await page.screenshot({ path: "test-results/assistant-desktop.png", fullPage: true });
  await page.unroute("**/api/ai/status");
  await page.unroute("**/api/ai/models");
  await page.unroute("**/api/ai/ask");
  await page.locator("nav").getByRole("button", { name: "סקירה כללית", exact: true }).click();
  await bankRecent.getByRole("button", { name: "לכל תנועות הבנק" }).click();
  assert.equal(await page.getByRole("tab", { name: "תנועות בנק" }).getAttribute("aria-selected"), "true");
  assert.ok(!(await page.locator("tbody").textContent()).includes("max"));
  await page
    .locator("nav")
    .getByRole("button", { name: "סקירה כללית", exact: true })
    .click();
  await cardRecent.getByRole("button", { name: "לכל תנועות האשראי" }).click();
  assert.equal(await page.getByRole("tab", { name: "תנועות אשראי" }).getAttribute("aria-selected"), "true");
  assert.ok(
    !(await page.locator("tbody").textContent()).includes("בנק הפועלים"),
  );
  await page.getByRole("tab", { name: "תנועות בנק" }).click();
  let categoryJob = null;
  const categoryRequests = [];
  const generalRequests = [];
  await page.route("**/api/ai/status", (route) => route.fulfill({ json: { connected: true, email: "test@example.com" } }));
  await page.route("**/api/ai/models", (route) => route.fulfill({ json: [{ id: "test-model", name: "Test model" }] }));
  await page.route("**/api/ai/categorization", (route) => {
    if (route.request().method() === "POST") {
      categoryRequests.push(route.request().postDataJSON().refresh);
      generalRequests.push(route.request().postDataJSON().generalOnly);
      categoryJob = { id: `category-${categoryRequests.length}`, status: "completed", totalMerchants: 2, completedMerchants: 2, updatedTransactions: 3 };
      return route.fulfill({ status: 202, json: categoryJob });
    }
    return route.fulfill({ json: { connected: true, totalTransactions: 3, generalTransactions: 1, pendingTransactions: categoryJob ? 0 : 3,
      lastCategorizedAt: categoryJob ? new Date().toISOString() : null, job: categoryJob } });
  });
  await page.getByRole("tab", { name: "תנועות אשראי" }).click();
  const categoryControls = page.getByLabel("סיווג קטגוריות עם ChatGPT", { exact: true });
  await categoryControls.getByRole("button", { name: "סיווג קטגוריות", exact: true }).waitFor();
  assert.equal(categoryRequests.length, 0, "opening the page never starts classification");
  await categoryControls.getByRole("button", { name: "סיווג קטגוריות", exact: true }).click();
  await categoryControls.getByRole("status").filter({ hasText: "הסיווג הושלם" }).waitFor();
  await categoryControls.getByLabel("סיווג מחדש גם לתנועות שכבר סווגו").check();
  await categoryControls.getByRole("button", { name: "סיווג קטגוריות", exact: true }).click();
  assert.deepEqual(categoryRequests, [false, true]);
  await categoryControls.getByRole("button", { name: "בדיקה מחדש של כללי (1)", exact: true }).click();
  assert.deepEqual(categoryRequests, [false, true, false]);
  assert.deepEqual(generalRequests, [false, false, true]);
  await page.screenshot({ path: "test-results/card-categorization-desktop.png", fullPage: true });
  await page.unroute("**/api/ai/status");
  await page.unroute("**/api/ai/models");
  await page.unroute("**/api/ai/categorization");
  console.log("PASS: credit-card categorization starts manually and supports explicit refresh");
  await page
    .locator("nav")
    .getByRole("button", { name: "סקירה כללית", exact: true })
    .click();
  console.log(
    "PASS: bank activity and upcoming card charges have separate panels and navigation",
  );
  await page.waitForTimeout(750);
  await page.screenshot({
    path: "test-results/dashboard-desktop.png",
    fullPage: true,
  });
  console.log("PASS: Hebrew dashboard, persisted demo data and charts");

  await page.locator("nav").getByRole("button", { name: "הגדרות" }).click();
  await page.getByLabel("טווח סנכרון").selectOption("730");
  await page.getByRole("switch", { name: "איחוד עסקאות בתשלומים" }).click();
  await page.getByRole("button", { name: "שמירת שינויים" }).click();
  await page.getByRole("status").filter({ hasText: "ההעדפות נשמרו" }).waitFor();
  await page.reload();
  await page.locator("nav").getByRole("button", { name: "הגדרות" }).click();
  assert.equal(await page.getByLabel("טווח סנכרון").inputValue(), "730");
  assert.equal(
    await page.getByRole("switch").getAttribute("aria-checked"),
    "true",
  );
  await page.screenshot({
    path: "test-results/settings-desktop.png",
    fullPage: true,
  });
  console.log(
    "PASS: sync preferences persist through reload and session restoration",
  );

  await openAccounts(page);
  await page
    .getByRole("button", { name: /מחברים חשבון נוסף/ })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("בנק או חברת אשראי").selectOption("leumi");
  await dialog.getByLabel("שם החיבור").fill("חשבון נוסף לבדיקה");
  await dialog.getByRole("button", { name: "הוספת חשבון" }).click();
  await page.getByText("חשבון נוסף לבדיקה", { exact: true }).waitFor();
  console.log("PASS: connection creation");

  await page
    .getByRole("button", {
      name: "סנכרון חשבון משותף · הדגמת אימות",
      exact: true,
    })
    .click();
  await page.getByRole("heading", { name: "רק מוודאים שזה אתם" }).waitFor();
  const mfa = page.getByRole("dialog");
  await page.screenshot({
    path: "test-results/mfa-desktop.png",
    fullPage: true,
  });
  await mfa.getByLabel("קוד אימות חד־פעמי").fill("123456");
  await mfa.getByRole("button", { name: "אימות והמשך סנכרון" }).click();
  await mfa.waitFor({ state: "detached" });
  await page.waitForFunction(async () => {
    const j = await (await fetch("/api/jobs")).json();
    return j.some((x) => x.status === "completed");
  });
  const data = await page.evaluate(
    async () => await (await fetch("/api/data")).json(),
  );
  const oneZero = data.connections.find((c) => c.provider === "oneZero");
  assert.ok(data.accounts.some((a) => a.connection_id === oneZero.id));
  assert.ok(data.transactions.some((t) => t.connection_id === oneZero.id));
  console.log(
    "PASS: MFA dialog resumes server job and saves returned transactions",
  );

  await page
    .locator("nav")
    .getByRole("button", { name: "תנועות", exact: true })
    .click();
  await page.getByRole("tab", { name: "תנועות אשראי" }).click();
  await page.getByLabel("חיפוש תנועות").fill("Wolt");
  await page.waitForFunction(() =>
    [...document.querySelectorAll("tbody tr")].every((r) =>
      r.textContent.includes("Wolt"),
    ),
  );
  assert.ok((await page.locator("tbody tr").count()) > 0);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "ייצוא CSV" }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  let csv = "";
  for await (const chunk of stream) csv += chunk.toString();
  assert.ok(csv.includes("Wolt"));
  assert.ok(!csv.includes("Netflix"));
  await page.getByLabel("חיפוש תנועות").fill("nothing-matches-this-query");
  await page.getByRole("heading", { name: "לא נמצאו תנועות תואמות" }).waitFor();
  await page.getByLabel("חיפוש תנועות").fill("");
  await page.screenshot({
    path: "test-results/transactions-desktop.png",
    fullPage: true,
  });
  console.log(
    "PASS: transaction filtering, empty state and filtered CSV download",
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "פתיחת תפריט", exact: true }).click();
  await page
    .locator("nav")
    .getByRole("button", { name: "סקירה כללית", exact: true })
    .click();
  await page.waitForTimeout(700);
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "Mobile viewport has horizontal overflow",
  );
  await page.screenshot({
    path: "test-results/dashboard-mobile.png",
    fullPage: true,
  });
  console.log("PASS: responsive dashboard and mobile navigation");
  const isolated = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const login = await isolated.newPage();
  login.on("pageerror", (error) => errors.push(error.message));
  await login.goto(url);
  await login.getByRole("button", { name: "חשבון חדש", exact: true }).click();
  await login.getByLabel("איך קוראים לכם?").fill("בדיקת משתמש נפרד");
  const email = `browser-${Date.now()}@example.com`;
  await login.getByLabel("כתובת אימייל").fill(email);
  await login
    .getByLabel("סיסמה", { exact: true })
    .fill("browser-test-password-2026");
  await login.getByRole("button", { name: "יצירת חשבון", exact: true }).click();
  await login.getByRole("heading", { name: "אין תנועות בנק עדיין" }).waitFor();
  const isolatedData = await login.evaluate(
    async () => await (await fetch("/api/data")).json(),
  );
  assert.equal(isolatedData.transactions.length, 0);
  assert.equal(isolatedData.connections.length, 0);
  await login
    .getByRole("button", { name: "יציאה מהחשבון", exact: true })
    .click();
  await login.getByLabel("כתובת אימייל").fill(email);
  await login
    .getByLabel("סיסמה", { exact: true })
    .fill("browser-test-password-2026");
  await login
    .getByRole("button", { name: "כניסה לחשבון", exact: true })
    .click();
  await login.getByRole("heading", { name: "אין תנועות בנק עדיין" }).waitFor();
  console.log(
    "PASS: registration, isolated empty account, logout and password login",
  );
  const session = await login.evaluate(
    async () => await (await fetch("/api/session")).json(),
  );
  if (session.liveEnabled) {
    await openAccounts(login);
    await login
      .getByRole("button", { name: /מחברים חשבון נוסף/ })
      .click();
    const connectionForm = login.getByRole("dialog");
    await connectionForm.getByLabel("בנק או חברת אשראי").selectOption("leumi");
    await connectionForm
      .getByLabel("שם החיבור")
      .fill("בדיקת חיבור ללא כניסה לבנק");
    await connectionForm.getByRole("checkbox").check();
    assert.equal(
      await connectionForm.locator('input[name="password"]').count(),
      1,
    );
    await connectionForm.getByRole("checkbox").uncheck();
    await connectionForm.getByRole("button", { name: "הוספת חשבון" }).click();
    await login
      .getByRole("button", {
        name: "סנכרון בדיקת חיבור ללא כניסה לבנק",
        exact: true,
      })
      .click();
    const credentialsForm = login.getByRole("dialog");
    await credentialsForm
      .getByRole("heading", { name: "התחברות לבנק לאומי" })
      .waitFor();
    assert.equal(
      await credentialsForm.locator('input[name="password"]').count(),
      1,
    );
    await credentialsForm
      .getByRole("button", { name: "סגירה", exact: true })
      .click();
    const jobs = await login.evaluate(
      async () => await (await fetch("/api/jobs")).json(),
    );
    assert.deepEqual(
      jobs,
      [],
      "Checking credentials UI must not start a bank job",
    );
    console.log(
      "PASS: personal live connection creation and credential forms without contacting a bank",
    );
  }
  await isolated.close();
  // Override only synthetic demo responses; never edit stored financial data.
  const fixture = await page.evaluate(
    async () => await (await fetch("/api/data")).json(),
  );
  fixture.connections.push({
    id: "synthetic-isracard-failure",
    provider: "isracard",
    name: "כרטיס לבדיקה",
    synced_at: null,
    status: "failed",
    remembered: false,
  });
  fixture.runs.unshift({
    id: "synthetic-isracard-run",
    connection_id: "synthetic-isracard-failure",
    status: "failed",
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    count: 0,
    error: "הבנק דורש שינוי סיסמה. יש להיכנס לאתר הבנק.",
  });
  await page.route("**/api/data", (route) => route.fulfill({ json: fixture }));
  await page.reload();
  const failure = page.locator(".sync-failure");
  await failure.getByText("הסנכרון של ישראכרט נכשל").waitFor();
  assert.match(await failure.textContent(), /לא יובאו נתונים/);
  await failure.getByRole("button", { name: /לחשבון ולניסיון חוזר/ }).click();
  const failedCard = page.locator(".connection-card").filter({ hasText: "כרטיס לבדיקה" });
  assert.match(await failedCard.textContent(), /הסנכרון נכשל/);
  assert.match(await failedCard.textContent(), /אתר ישראכרט ביקש שינוי סיסמה/);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.locator("nav").getByRole("button", { name: "סקירה כללית", exact: true }).click();
  fixture.connections.pop();
  fixture.runs.shift();
  console.log("PASS: failed Isracard sync explains the missing card on dashboard and account card");
  const isracardConnection = {
    id: "synthetic-isracard-payment",
    provider: "isracard",
    name: "כרטיס חיוב לבדיקה",
    synced_at: "2026-10-21T08:00:00Z",
    status: "completed",
  };
  fixture.connections.push(isracardConnection);
  fixture.accounts.push(
    { ...fixture.accounts[0], id: "synthetic-isracard-card", connection_id: isracardConnection.id,
      provider: "isracard", number: "9999", currency: "ILS", balance: -327719,
      next_charge: null, next_charge_date: null },
    { ...fixture.accounts[0], id: "synthetic-isracard-no-bill", connection_id: isracardConnection.id,
      provider: "isracard", number: "8888", currency: "ILS", balance: -1239192,
      next_charge: null, next_charge_date: null },
  );
  fixture.transactions.push(
    { ...fixture.transactions[0], id: "synthetic-isracard-charge-a", account_id: "synthetic-isracard-card",
      connection_id: isracardConnection.id, provider: "isracard", processed_date: "2099-11-10",
      currency: "ILS", status: "completed", amount: -12000 },
    { ...fixture.transactions[0], id: "synthetic-isracard-charge-b", account_id: "synthetic-isracard-card",
      connection_id: isracardConnection.id, provider: "isracard", processed_date: "2099-11-10",
      currency: "ILS", status: "completed", amount: -5000 },
    { ...fixture.transactions[0], id: "synthetic-isracard-refund", account_id: "synthetic-isracard-card",
      connection_id: isracardConnection.id, provider: "isracard", processed_date: "2099-11-10",
      currency: "ILS", status: "completed", amount: 1000 },
    { ...fixture.transactions[0], id: "synthetic-isracard-later", account_id: "synthetic-isracard-card",
      connection_id: isracardConnection.id, provider: "isracard", processed_date: "2099-12-10",
      currency: "ILS", status: "completed", amount: -30000 },
  );
  await page.reload();
  await openAccounts(page);
  const paymentCard = page.locator(".connection-card").filter({ hasText: "כרטיס חיוב לבדיקה" });
  assert.equal(await paymentCard.locator(".connection-value > div").first().locator("strong").textContent(), formatMoney(16000));
  assert.match(await paymentCard.textContent(), /אומדן חלקי/);
  assert.equal(await paymentCard.locator(".connection-value > div").last().locator("strong").textContent(), "—");
  assert.match(await paymentCard.textContent(), /אין חיוב עתידי מתוארך/);
  fixture.connections.pop();
  fixture.accounts.splice(-2);
  fixture.transactions.splice(-4);
  await page.locator("nav").getByRole("button", { name: "סקירה כללית", exact: true }).click();
  console.log("PASS: Isracard cards show dated payment estimates, not credit-line usage");
  fixture.accounts = fixture.accounts.map((a) => ({ ...a, balance: null }));
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.reload();
  const balancePanel = page.locator(".stat.featured");
  await balancePanel.getByText("הבנק לא החזיר יתרה בסנכרון האחרון").waitFor();
  assert.equal(await balancePanel.locator(".stat-value").textContent(), "—");
  fixture.accounts.find((a) => a.provider === "max").balance = -9999999;
  await page.reload();
  await balancePanel.getByText("הבנק לא החזיר יתרה בסנכרון האחרון").waitFor();
  assert.equal(await balancePanel.locator(".stat-value").textContent(), "—");
  fixture.accounts.find((a) => a.currency === "ILS").balance = 0;
  await page.reload();
  await balancePanel.getByText("יתרה חלקית · שקלים").waitFor();
  assert.match(await balancePanel.locator(".stat-value").textContent(), /0/);
  assert.ok((await balancePanel.textContent()).includes("יתרה חסרה"));
  fixture.accounts.find((a) => a.provider === "hapoalim").balance = 10000;
  fixture.accounts.find((a) => a.provider === "oneZero").balance = 20000;
  await page.reload();
  await balancePanel.getByText("2 חשבונות בנק עם יתרה").waitFor();
  assert.match(await balancePanel.locator(".stat-value").textContent(), /300/);
  console.log(
    "PASS: bank balance and account count exclude card debt, including when bank balances are missing",
  );
  fixture.accounts = fixture.accounts.map((a) => ({ ...a, currency: "USD" }));
  await page.reload();
  await balancePanel.getByText("לא סונכרנו חשבונות בשקלים").waitFor();
  assert.equal(await balancePanel.locator(".stat-value").textContent(), "—");
  console.log(
    "PASS: unavailable, partial, genuine zero, and foreign-currency balances are distinguished",
  );
  fixture.transactions[0].currency = "₪";
  fixture.transactions[1].currency = "19";
  await page.reload();
  await page.locator("tbody tr").first().waitFor();
  assert.ok(await page.locator("#root").textContent());
  await page
    .locator("nav")
    .getByRole("button", { name: "תנועות", exact: true })
    .click();
  await page.locator("tbody tr").first().waitFor();
  assert.ok(await page.locator("tbody").textContent());
  console.log(
    "PASS: card currency symbols and unknown units do not blank the dashboard or transactions page",
  );
  fixture.transactions = [
    {
      ...fixture.transactions[0],
      date: "2026-10-01",
      amount: 10000,
      currency: "ILS",
      provider: "hapoalim",
    },
  ];
  await page.clock.install({ time: new Date("2026-09-30T21:30:00Z") });
  await page.reload();
  await page
    .locator(".stat")
    .filter({ hasText: "הכנסות בתקופה" })
    .getByText("1 תנועות זכות")
    .waitFor();
  assert.match(
    await page
      .locator(".stat")
      .filter({ hasText: "הכנסות בתקופה" })
      .locator(".stat-value")
      .textContent(),
    /100/,
  );
  await page
    .locator(".bar-group.current .bar-pair")
    .getAttribute("aria-label")
    .then((label) => assert.ok(label.includes("100")));
  await page.unroute("**/api/data");
  console.log(
    "PASS: October 1 income remains in October at midnight in Israel",
  );
  const bankCredit = fixture.transactions[0];
  const cardPurchase = {
    ...bankCredit,
    id: "synthetic-card-purchase",
    provider: "max",
    amount: -900000,
    description: "SYNTHETIC_GROCERY",
    processed_date: "2026-10-01",
    status: "completed",
    category: "מזון וקניות",
    category_source: "chatgpt",
    category_description: "SYNTHETIC_GROCERY",
    category_explanation: "רשת מזון שזוהתה לפי אתר בית העסק",
    category_confidence: "high",
    category_web_searched: 1,
    category_sources: '["https://merchant.example/","javascript:alert(1)","http://"]',
  };
  const cardRefund = {
    ...bankCredit,
    id: "synthetic-card-refund",
    provider: "max",
    amount: 500000,
  };
  fixture.transactions = [
    bankCredit,
    { ...bankCredit, id: "synthetic-bank-debit", amount: -2500 },
    {
      ...bankCredit,
      id: "synthetic-bank-usd",
      amount: -777777,
      currency: "USD",
    },
    cardPurchase,
    cardRefund,
    { ...cardPurchase, id: "synthetic-card-transport", description: "SYNTHETIC_FUEL",
      category_description: "SYNTHETIC_FUEL", category: "תחבורה", amount: -30000 },
    { ...cardPurchase, id: "synthetic-card-unclassified", category_source: "rule", amount: -10000 },
    { ...cardPurchase, id: "synthetic-card-future", processed_date: "2026-11-02", amount: -880000 },
    { ...cardPurchase, id: "synthetic-card-prior-month", processed_date: "2026-09-02", amount: -20000 },
    { ...cardPurchase, id: "synthetic-card-pending", status: "pending", amount: -770000 },
    { ...cardPurchase, id: "synthetic-card-usd", currency: "USD", amount: -660000 },
  ];
  await page.route("**/api/data", (route) => route.fulfill({ json: fixture }));
  await page.reload();
  await page
    .locator(".stat")
    .filter({ hasText: "הכנסות בתקופה" })
    .getByText("1 תנועות זכות")
    .waitFor();
  for (const [title, expected] of [
    ["הכנסות בתקופה", 10000],
    ["הוצאות בתקופה", 2500],
    ["תזרים נטו", 7500],
  ])
    assert.equal(
      await page
        .locator(".stat")
        .filter({ hasText: title })
        .locator(".stat-value")
        .textContent(),
      formatMoney(expected),
    );
  assert.equal(
    await page.locator(".spending .donut strong").textContent(),
    formatMoney(940000),
  );
  assert.ok(
    (await page.locator(".spending .donut").textContent()).includes("3 תנועות"),
  );
  assert.match(await page.locator(".spending .panel-heading p").textContent(), /קטגוריות ChatGPT.*מועד החיוב/);
  const categoryLegend = page.locator(".spending-legend");
  for (const [category, value] of [["מזון וקניות", 900000], ["תחבורה", 30000], ["טרם סווג עם ChatGPT", 10000]]) {
    const row = categoryLegend.locator(":scope > div").filter({ hasText: category });
    assert.equal(await row.locator("em").textContent(), formatMoney(value));
  }
  await page.getByLabel("תקופה", { exact: true }).selectOption("90");
  assert.equal(await page.locator(".spending .donut strong").textContent(), formatMoney(960000));
  await page.getByLabel("תקופה", { exact: true }).selectOption("month");
  await page.screenshot({ path: "test-results/card-category-spending-desktop.png", fullPage: true });
  const originalSpendingTransactions = fixture.transactions;
  const additionalCategories = ["בריאות", "ביטוח ופיננסים", "אוכל ובילויים", "כללי", "מחשבים ואלקטרוניקה", "ספורט ופנאי", "מנויים", "מתנות ותרומות"];
  const extraSpendingRows = additionalCategories.map((category, index) => ({ ...cardPurchase,
    id: `all-category-${index}`, category, amount: index === additionalCategories.length - 1 ? -1 : -(14000 - index * 1000),
  }));
  fixture.transactions = [...originalSpendingTransactions, ...extraSpendingRows];
  await page.reload();
  const spendingPanel = page.getByRole("region", { name: "הוצאות אשראי לפי קטגוריות", exact: true });
  const segments = spendingPanel.locator(".donut-segment");
  await segments.nth(10).waitFor({ state: "attached" });
  assert.equal(await segments.count(), 11, "every category, including the smallest, has its own segment");
  assert.equal(await spendingPanel.locator(".spending-legend > div").count(), 11);
  assert.equal(await spendingPanel.locator(".spending-legend").getByText("אחר", { exact: true }).count(), 0);
  assert.equal(new Set(await segments.evaluateAll((items) => items.map((item) => item.getAttribute("stroke")))).size, 11);
  const arcTotals = await segments.evaluateAll((items) => ({ percent: items.reduce((sum, item) => sum + Number(item.dataset.percent), 0), amount: items.reduce((sum, item) => sum + Number(item.dataset.amount), 0) }));
  assert.ok(Math.abs(arcTotals.percent - 100) < 0.00001);
  assert.equal(arcTotals.amount, 940000 - extraSpendingRows.reduce((sum, row) => sum + row.amount, 0));
  async function hoverSegment(segment) {
    await spendingPanel.locator(".donut").scrollIntoViewIfNeeded();
    const box = await spendingPanel.locator(".donut svg").boundingBox();
    const angle = ((Number(await segment.getAttribute("data-start")) + Number(await segment.getAttribute("data-percent")) / 2) / 100) * Math.PI * 2 - Math.PI / 2;
    await page.mouse.move(box.x + box.width * (0.5 + 0.42 * Math.cos(angle)), box.y + box.height * (0.5 + 0.42 * Math.sin(angle)));
  }
  for (const category of ["מזון וקניות", "בריאות", "מנויים"]) {
    const segment = spendingPanel.locator(`.donut-segment[data-category="${category}"]`);
    await hoverSegment(segment);
    await spendingPanel.getByRole("tooltip").getByText(category, { exact: true }).waitFor();
    const label = await segment.getAttribute("aria-label");
    assert.ok((await spendingPanel.getByRole("tooltip").textContent()).includes(label.split(" · ")[1]));
    const breakdown = spendingPanel.getByRole("region", { name: `תנועות שנכללו ב${category}`, exact: true });
    await breakdown.waitFor();
    assert.equal(await breakdown.locator("li").evaluateAll((items) => items.reduce((sum, item) => sum + Number(item.dataset.amount), 0)), Number(await segment.getAttribute("data-amount")));
  }
  await spendingPanel.screenshot({ path: "test-results/spending-all-categories-desktop.png", animations: "disabled" });
  const tinySegment = spendingPanel.locator('.donut-segment[data-category="מתנות ותרומות"]');
  await tinySegment.focus();
  assert.match(await spendingPanel.getByRole("tooltip").textContent(), /מתנות ותרומות.*<0.1%/s);
  await tinySegment.press("Escape");
  assert.equal(await spendingPanel.getByRole("tooltip").count(), 0);
  assert.equal(await spendingPanel.locator(".spending-breakdown").count(), 0);
  await page.getByRole("button", { name: "הסתרת סכומים", exact: true }).click();
  await spendingPanel.locator('.donut-segment[data-category="בריאות"]').focus();
  assert.ok(!(await spendingPanel.getByRole("tooltip").textContent()).includes("₪"));
  assert.ok(!(await spendingPanel.locator(".spending-breakdown").textContent()).includes("₪"));
  await page.getByRole("button", { name: "הצגת סכומים", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await spendingPanel.scrollIntoViewIfNeeded();
  await spendingPanel.locator(".spending-legend > div").filter({ hasText: "מנויים" }).click();
  await spendingPanel.getByRole("tooltip").getByText("מנויים", { exact: true }).waitFor();
  await spendingPanel.getByRole("region", { name: "תנועות שנכללו במנויים", exact: true }).waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await spendingPanel.screenshot({ path: "test-results/spending-all-categories-mobile.png", animations: "disabled" });
  await page.getByLabel("תקופה", { exact: true }).selectOption("90");
  assert.equal(await spendingPanel.locator(".spending-breakdown").count(), 0, "changing the period clears the old category details");
  await page.setViewportSize({ width: 1440, height: 1100 });
  fixture.transactions = originalSpendingTransactions;
  await page.reload();
  await page.locator(".spending .donut strong").filter({ hasText: formatMoney(940000) }).waitFor();
  console.log("PASS: every category has an accurately sized segment; real arc hover, keyboard focus, tiny shares and mobile legend taps show category percentages and respect hidden amounts");
  const cashflowLabel = await page
    .locator(".bar-group.current .bar-pair")
    .getAttribute("aria-label");
  assert.ok(
    cashflowLabel.includes(
      `הכנסות ${formatMoney(10000)}, הוצאות ${formatMoney(2500)}`,
    ),
  );
  fixture.transactions = [cardPurchase, cardRefund];
  await page.reload();
  await page.getByRole("heading", { name: "אין תנועות בנק עדיין" }).waitFor();
  for (const title of ["הכנסות בתקופה", "הוצאות בתקופה", "תזרים נטו"])
    assert.equal(
      await page
        .locator(".stat")
        .filter({ hasText: title })
        .locator(".stat-value")
        .textContent(),
      formatMoney(0),
    );
  assert.equal(await page.locator(".spending .donut strong").textContent(), formatMoney(900000));
  assert.equal(await page.locator(".spending .donut-segment").count(), 1);
  await page.locator(".spending .donut-segment").focus();
  assert.match(await page.locator(".spending").getByRole("tooltip").textContent(), /100%/);
  fixture.transactions = [{ ...bankCredit, amount: -2500 }];
  await page.reload();
  await page.getByRole("heading", { name: "עוד אין חיובי אשראי בתקופה הזו" }).waitFor();
  fixture.transactions = [cardPurchase, cardRefund];
  await page.reload();
  assert.equal(
    await page
      .getByRole("region", {
        name: "חיובים קרובים בכרטיסי האשראי",
        exact: true,
      })
      .locator("tbody tr")
      .count(),
    0,
  );
  await cardRecent.getByText("אין חיובים עתידיים ידועים").waitFor();
  fixture.transactions = [
    { ...cardPurchase, id: "synthetic-november-charge", description: "NOV_CHARGE", date: "2026-10-17", processed_date: "2026-11-02", status: "completed" },
    { ...cardPurchase, id: "synthetic-december-charge", description: "DEC_CHARGE", date: "2026-10-17", processed_date: "2026-12-02", status: "completed" },
    { ...cardPurchase, id: "synthetic-pending-charge", description: "PENDING_CHARGE", date: "2026-10-17", processed_date: "2026-11-02", status: "pending" },
  ];
  await page.reload();
  await page.locator("nav").getByRole("button", { name: "תנועות", exact: true }).click();
  assert.equal(await page.getByRole("tab", { name: "תנועות בנק" }).getAttribute("aria-selected"), "true");
  await page.getByRole("tab", { name: "תנועות אשראי" }).click();
  const billingMonth = page.getByLabel("חודש חיוב בכרטיס");
  await billingMonth.selectOption("2026-11");
  assert.equal(await page.locator(".transactions tbody tr").count(), 1);
  assert.match(await page.locator(".transactions tbody").textContent(), /NOV_CHARGE/);
  assert.doesNotMatch(await page.locator(".transactions tbody").textContent(), /DEC_CHARGE|PENDING_CHARGE/);
  await page.getByLabel("פרטי הסיווג של NOV_CHARGE", { exact: true }).click();
  const evidence = page.locator(".category-evidence[open]");
  await evidence.getByText("רשת מזון שזוהתה לפי אתר בית העסק").waitFor();
  assert.match(await evidence.textContent(), /גבוה.*נבדק ברשת/);
  assert.equal(await evidence.locator("a").count(), 1);
  assert.equal(await evidence.locator("a").getAttribute("href"), "https://merchant.example/");
  await page.screenshot({ path: "test-results/category-evidence-desktop.png", fullPage: true });
  const monthDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "ייצוא CSV" }).click();
  const monthStream = await (await monthDownload).createReadStream();
  let monthCsv = "";
  for await (const chunk of monthStream) monthCsv += chunk.toString();
  assert.match(monthCsv, /NOV_CHARGE/);
  assert.doesNotMatch(monthCsv, /DEC_CHARGE|PENDING_CHARGE/);
  await billingMonth.selectOption("2026-12");
  assert.match(await page.locator(".transactions tbody").textContent(), /DEC_CHARGE/);
  assert.doesNotMatch(await page.locator(".transactions tbody").textContent(), /NOV_CHARGE/);
  await billingMonth.selectOption("next");
  assert.match(await page.locator(".transactions tbody").textContent(), /NOV_CHARGE/);
  fixture.transactions.push(
    ...[
      [1, "2026-10-18", "2026-11-02", -20621],
      [2, "2026-11-18", "2026-12-02", -20617],
      [3, "2026-12-18", "2027-01-02", -20617],
    ].map(([number, date, processed_date, amount]) => ({
      ...cardPurchase,
      id: `synthetic-five-payment-${number}`,
      description: "FIVE_PAYMENT",
      date,
      processed_date,
      amount,
      status: "completed",
      installment_group: "synthetic-five-payment-group",
      installment_number: number,
      installment_total: 5,
    })),
  );
  await page.reload();
  await page.locator("nav").getByRole("button", { name: "תנועות", exact: true }).click();
  await page.getByRole("tab", { name: "תנועות אשראי" }).click();
  const installmentMonth = page.getByLabel("חודש חיוב בכרטיס");
  await installmentMonth.selectOption("2027-02");
  assert.equal(await page.locator(".transactions tbody tr").count(), 1);
  assert.match(await page.locator(".transactions tbody").textContent(), /FIVE_PAYMENT/);
  assert.match(await page.locator(".transactions tbody").textContent(), /תשלום 4 מתוך 5/);
  assert.match(await page.locator(".transactions tbody").textContent(), /צפוי · אומדן/);
  const projectedSummary = page.getByRole("region", { name: "סיכום תנועות אשראי מסוננות", exact: true });
  assert.equal(await projectedSummary.locator(".filtered-debits bdi").textContent(), formatMoney(0));
  assert.match(await projectedSummary.textContent(), /תשלומים צפויים · אומדן/);
  assert.ok((await projectedSummary.textContent()).includes(formatMoney(20617)));
  await installmentMonth.selectOption("2027-03");
  assert.match(await page.locator(".transactions tbody").textContent(), /תשלום 5 מתוך 5/);
  await installmentMonth.selectOption("2027-04");
  assert.equal(await page.locator(".transactions tbody tr").count(), 0);
  fixture.transactions = [cardPurchase, cardRefund];
  await page.locator("nav").getByRole("button", { name: "סקירה כללית", exact: true }).click();
  console.log("PASS: bank/card tabs filter billing months and show projected fourth and fifth installments without carrying them beyond completion");
  await page.unroute("**/api/data");
  console.log(
    "PASS: bank metrics stay separate; spending uses saved ChatGPT card categories, billing dates, selected period, and completed ILS charges only",
  );
  const beforeBillingTransactions = fixture.transactions, beforeBillingAccounts = fixture.accounts;
  const octoberTransport = [4493, 5586, 1600, 10632, 2402, 1360, 2000, 32500, 4240, 153400, 8633, 5177, 183300, 3370, 3000, 1500];
  const novemberTransport = [3211, 4346, 7285, 5560, 1737];
  fixture.accounts = fixture.accounts.map((account) => ({ ...account, next_charge_date: "2026-11-02" }));
  fixture.transactions = [...octoberTransport.map((value, index) => ({ ...cardPurchase, id: `october-transport-${index}`,
    amount: -value, category: "תחבורה", date: `2026-09-${String(28 - index).padStart(2, "0")}`, processed_date: "2026-10-02" })),
    ...novemberTransport.map((value, index) => ({ ...cardPurchase, id: `november-transport-${index}`,
      amount: -value, category: "תחבורה", date: `2026-10-${String(10 + index).padStart(2, "0")}`, processed_date: "2026-11-02" }))];
  await page.clock.setFixedTime(new Date("2026-10-22T12:00:00Z"));
  await page.route("**/api/data", (route) => route.fulfill({ json: fixture }));
  await page.reload();
  await page.locator(".spending .donut-center strong").filter({ hasText: formatMoney(423193) }).waitFor();
  assert.match(await page.locator(".spending .panel-heading p").textContent(), /אוקטובר 2026/);
  await hoverSegment(page.locator('.spending .donut-segment[data-category="תחבורה"]'));
  const transportBreakdown = page.getByRole("region", { name: "תנועות שנכללו בתחבורה", exact: true });
  await transportBreakdown.waitFor();
  assert.equal(await transportBreakdown.locator("li").count(), 16);
  assert.equal(await transportBreakdown.locator("li").evaluateAll((items) => items.reduce((sum, item) => sum + Number(item.dataset.amount), 0)), 423193);
  assert.equal(await transportBreakdown.locator(".spending-breakdown-heading > strong").textContent(), formatMoney(423193));
  assert.ok((await transportBreakdown.locator("li").evaluateAll((items) => items.map((item) => item.dataset.transactionId))).every((id) => id.startsWith("october-transport-")));
  assert.match(await transportBreakdown.textContent(), /חיוב:.*02.10.2026/);
  assert.match(await transportBreakdown.textContent(), /עסקה:.*09.2026/);
  await transportBreakdown.locator("li").first().hover();
  await transportBreakdown.waitFor();
  await spendingPanel.screenshot({ path: "test-results/spending-transport-breakdown.png", animations: "disabled" });
  await page.getByRole("button", { name: "סגירת פירוט הקטגוריה", exact: true }).click();
  assert.equal(await spendingPanel.locator(".spending-breakdown").count(), 0);
  await page.locator("nav").getByRole("button", { name: "תנועות", exact: true }).click();
  await page.getByRole("tab", { name: "תנועות אשראי" }).click();
  await page.getByLabel("סינון לפי קטגוריה").selectOption("תחבורה");
  await page.getByLabel("חודש חיוב בכרטיס").selectOption("2026-10");
  const filteredCardSummary = page.getByRole("region", { name: "סיכום תנועות אשראי מסוננות", exact: true });
  assert.match(await filteredCardSummary.textContent(), /16 תנועות בכל העמודים.*אוקטובר 2026/s);
  assert.equal(await filteredCardSummary.locator(".filtered-debits bdi").textContent(), formatMoney(423193));
  assert.equal(await page.locator(".transactions tbody tr").count(), 10);
  await page.getByRole("button", { name: "עמוד הבא", exact: true }).click();
  assert.equal(await page.locator(".transactions tbody tr").count(), 6);
  assert.equal(await filteredCardSummary.locator(".filtered-debits bdi").textContent(), formatMoney(423193));
  await page.getByLabel("חודש חיוב בכרטיס").selectOption("next");
  assert.match(await filteredCardSummary.textContent(), /5 תנועות בכל העמודים.*נובמבר 2026/s);
  assert.equal(await filteredCardSummary.locator(".filtered-debits bdi").textContent(), formatMoney(22139));
  assert.equal(await page.locator(".transactions tbody tr").count(), 5);
  await page.screenshot({ path: "test-results/card-billing-month-summary.png", fullPage: true });
  fixture.transactions = beforeBillingTransactions; fixture.accounts = beforeBillingAccounts;
  await page.unroute("**/api/data");
  console.log("PASS: October chart and all 16 filtered October charges match 4,231.93; next November correctly shows 221.39 across five charges, independently of pagination");
  await page.clock.setFixedTime(new Date("2026-10-21T10:00:00Z"));
  const originalSyncTimes = fixture.connections.map((connection) => connection.synced_at);
  fixture.connections.forEach((connection) => { connection.synced_at = "2026-10-21T08:00:00Z"; });
  fixture.connections[0].synced_at = "2026-10-21T09:50:00Z";
  await page.route("**/api/data", (route) => route.fulfill({ json: fixture }));
  await page.reload();
  const lastSyncBanner = page.locator(".last-sync-banner");
  await lastSyncBanner.getByText("סנכרון מוצלח אחרון: לפני 10 דקות").waitFor();
  assert.match(await lastSyncBanner.textContent(), /12:50/);
  fixture.connections.forEach((connection) => { connection.synced_at = null; });
  await page.reload();
  await lastSyncBanner.getByText("עדיין לא בוצע סנכרון מוצלח").waitFor();
  fixture.connections.forEach((connection, index) => { connection.synced_at = originalSyncTimes[index]; });
  await page.unroute("**/api/data");
  console.log("PASS: last successful sync banner shows elapsed time and an empty state");
  fixture.accounts = [
    { ...fixture.accounts[0], provider: "hapoalim", currency: "ILS", balance: 273082 },
    {
      ...fixture.accounts[1],
      provider: "visaCal",
      currency: "ILS",
      next_charge: 200000,
      next_charge_date: "2026-11-02",
    },
    {
      ...fixture.accounts[1],
      id: "synthetic-second-card",
      provider: "visaCal",
      currency: "ILS",
      next_charge: 312825,
      next_charge_date: "2026-11-10",
    },
  ];
  fixture.transactions = [
    {
      ...bankCredit,
      id: "synthetic-mortgage",
      date: "2026-09-10",
      description: "טפחות - לווים",
      amount: -666730,
      status: "completed",
    },
    {
      ...bankCredit,
      id: "synthetic-mortgage-duplicate",
      date: "2026-09-10",
      description: "טפחות - לווים",
      amount: -666730,
      status: "completed",
    },
    {
      ...bankCredit,
      id: "synthetic-old-card-bill",
      date: "2026-09-12",
      description: "ישראכרט",
      amount: -1705400,
      status: "completed",
    },
    {
      ...cardPurchase,
      id: "synthetic-cal-installment-a",
      account_id: fixture.accounts[1].id,
      connection_id: fixture.accounts[1].connection_id,
      provider: "visaCal",
      currency: "ILS",
      date: "2026-10-02",
      processed_date: "2026-11-02",
      amount: -100000,
      status: "completed",
      installment_group: "synthetic-installment-a",
      installment_number: 1,
      installment_total: 3,
    },
    {
      ...cardPurchase,
      id: "synthetic-cal-installment-b",
      account_id: fixture.accounts[2].id,
      connection_id: fixture.accounts[2].connection_id,
      provider: "visaCal",
      currency: "ILS",
      date: "2026-10-10",
      processed_date: "2026-11-10",
      amount: -50000,
      status: "completed",
      installment_group: "synthetic-installment-b",
      installment_number: 1,
      installment_total: 2,
    },
  ];
  await page.route("**/api/data", (route) => route.fulfill({ json: fixture }));
  const forecastSettings = {
    daysBack: 30,
    combineInstallments: true,
    monthlyIncome: 1900000,
    monthlyCardEstimate: 999999,
    cardEstimatesByMonth: { "2026-12": 400000 },
  };
  await page.route("**/api/settings", (route) => {
    if (route.request().method() === "PUT")
      Object.assign(forecastSettings, route.request().postDataJSON());
    return route.fulfill({ json: forecastSettings });
  });
  await page.reload();
  await cardRecent.getByText("סך החיובים הקרובים הידועים").waitFor();
  assert.equal(await cardRecent.locator("tbody tr").count(), 2);
  assert.equal(await cardRecent.locator(".upcoming-card-totals strong").textContent(), formatMoney(512825));
  const forecast = page.getByRole("region", { name: "תחזית תזרים" });
  await forecast.getByText("חיובי כרטיסים צפויים · נובמבר 2026").waitFor();
  const monthPicker = forecast.getByLabel("חודש התחזית");
  assert.equal(await monthPicker.inputValue(), "2026-11-01");
  const cardLine = forecast.locator(".forecast-line").filter({
    hasText: "חיובי כרטיסים",
  });
  assert.equal(await cardLine.locator("strong").textContent(), formatMoney(-512825));
  assert.ok((await cardLine.textContent()).includes("02.11.2026"));
  assert.ok((await cardLine.textContent()).includes("10.11.2026"));
  assert.equal(
    await forecast.locator(".forecast-result strong").textContent(),
    formatMoney(993527),
  );
  const openingLine = forecast.locator(".forecast-line").filter({ hasText: "יתרה נוכחית בחשבונות הבנק" });
  assert.equal(await openingLine.locator("strong").textContent(), formatMoney(273082));
  await openingLine.hover();
  assert.match(await openingLine.locator(".forecast-tooltip:visible").textContent(), /נקודת הפתיחה לכל חודש/);
  const mortgageLine = forecast.locator(".forecast-line").filter({ hasText: "משכנתא חודשית" });
  await mortgageLine.hover();
  assert.match(await mortgageLine.locator(".forecast-tooltip:visible").textContent(), /רישום זהה נוסף לא נספר/);
  assert.match(await mortgageLine.locator(".forecast-tooltip:visible").textContent(), /6,667/);
  await cardLine.hover();
  assert.match(await cardLine.locator(".forecast-tooltip:visible").textContent(), /חיוב מסונכרן/);
  await forecast.locator(".forecast-result").hover();
  assert.match(await forecast.locator(".forecast-result .forecast-tooltip:visible").textContent(), /יתרה נוכחית בבנק.*הכנסה חודשית.*פחות משכנתא.*פחות חיובי כרטיסים/s);
  await monthPicker.selectOption("2026-12-01");
  await forecast.getByText("תרחיש חודשי ל־דצמבר 2026").waitFor();
  assert.equal(
    await forecast.locator(".forecast-line").filter({ hasText: "הכנסה חודשית קבועה" }).locator("strong").textContent(),
    `+${formatMoney(1900000)}`,
  );
  assert.equal(
    await forecast.locator(".forecast-line").filter({ hasText: "משכנתא חודשית" }).locator("strong").textContent(),
    formatMoney(-666730),
  );
  assert.equal(await cardLine.locator("strong").textContent(), formatMoney(-150000));
  assert.match(await cardLine.textContent(), /תשלומים ידועים בלבד/);
  assert.equal(
    await forecast.locator(".forecast-result strong").textContent(),
    formatMoney(1356352),
  );
  await monthPicker.selectOption("2027-01-01");
  assert.equal(await cardLine.locator("strong").textContent(), formatMoney(-100000));
  assert.equal(
    await forecast.locator(".forecast-result strong").textContent(),
    formatMoney(1406352),
  );
  assert.equal(await forecast.getByRole("button", { name: "שמירת אומדן לחודש" }).count(), 0);
  fixture.accounts[2].next_charge_date = null;
  await page.reload();
  await forecast.getByText(/קניות חדשות אינן כלולות/).waitFor();
  assert.equal(await cardLine.locator("strong").textContent(), formatMoney(-250000));
  assert.equal(await forecast.locator(".forecast-result strong").textContent(), formatMoney(1256352));
  fixture.accounts[2].next_charge_date = "2026-11-10";
  fixture.connections.push({
    id: "synthetic-unavailable-card",
    provider: "isracard",
    name: "כרטיס ללא נתונים",
    status: "failed",
    synced_at: null,
    remembered: false,
  });
  await page.reload();
  await forecast.getByText(/סכומים נוספים חסרים בגלל חיבור שלא סונכרן/).waitFor();
  assert.equal(await cardLine.locator("strong").textContent(), formatMoney(-512825));
  assert.equal(await forecast.locator(".forecast-result strong").textContent(), formatMoney(993527));
  await page.unroute("**/api/settings");
  await page.unroute("**/api/data");
  console.log(
    "PASS: real-number November, December, and January closing balances use the current bank balance and month-specific card charges",
  );
  const balanceFixture = await context.newPage();
  await balanceFixture.setContent(
    `<div class="balance"><div><span class="thin">יתרת עו&quot;ש</span><h6 class="plaintext"><span>₪</span> 1,234.56</h6></div></div><button class="balance">מסגרת אשראי ₪36,000</button><table><tr><th>תאריך</th><th>יתרה בש&quot;ח</th></tr><tr><td>11/10/26</td><td>900</td></tr></table>`,
  );
  assert.deepEqual(await readMizrahiBalance(balanceFixture), {
    balance: 1234.56,
  });
  await balanceFixture.setContent(
    `<div class="balance"><div><span class="thin">יתרת עו״ש</span><h6>₪0.00</h6></div></div>`,
  );
  assert.deepEqual(await readMizrahiBalance(balanceFixture), { balance: 0 });
  await balanceFixture.route(
    "https://mto.mizrahi-tefahot.co.il/balance-test-fixture",
    (route) =>
      route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: `<table><tr><th>תאריך</th><th>סוג תנועה</th><th>זכות/חובה</th><th>יתרה בש&quot;ח</th></tr><tr><td>22/09/26</td><td>דוגמה</td><td>-100</td><td>4,000</td></tr><tr><td>11/10/26</td><td>דוגמה</td><td>-200</td><td>-1,234.56</td></tr></table>`,
      }),
  );
  await balanceFixture.setContent(
    `<iframe src="https://mto.mizrahi-tefahot.co.il/balance-test-fixture"></iframe>`,
  );
  assert.deepEqual(await readMizrahiBalance(balanceFixture), {
    balance: -1234.56,
    balanceDate: "2026-10-11",
  });
  await balanceFixture.setContent(
    `<button class="balance">מסגרת אשראי ₪36,000</button>`,
  );
  assert.equal(await readMizrahiBalance(balanceFixture), null);
  await balanceFixture.close();
  console.log(
    "PASS: Mizrahi header balance, genuine zero, iframe ledger fallback, and credit-limit exclusion",
  );
  const recurringFixture = await page.evaluate(() => fetch("/api/data").then((response) => response.json()));
  const recurringCard = recurringFixture.accounts.find((account) => account.provider === "max");
  const recurringBank = recurringFixture.accounts.find((account) => account.provider === "hapoalim");
  let recurringId = 0;
  const recurringTx = (description, date, amount, extra = {}) => ({
    id: `recurring-${++recurringId}`, account_id: recurringCard.id, provider: "max", account_number: recurringCard.number,
    description, date, processed_date: date, amount: -amount, currency: "ILS", status: "completed", category: "מנויים", ...extra,
  });
  recurringFixture.transactions = [
    ...["2026-08-10", "2026-09-10", "2026-10-10"].map((date) => recurringTx("OPENAI CHATGPT", date, 7580)),
    ...["2026-08-13", "2026-09-13", "2026-10-13"].map((date) => recurringTx("פרי טיוי", date, 3990)),
    ...["2026-06-05", "2026-08-05", "2026-10-05"].map((date) => recurringTx("חברת החשמל", date, 60000, { account_id: recurringBank.id, provider: "hapoalim", category: "בית וחשבונות" })),
    ...["2025-10-20", "2026-10-20"].map((date) => recurringTx("ביטוח דירה שנתי", date, 120000, { category: "ביטוח ופיננסים" })),
    recurringTx("GOOGLE GOOGLE ONE", "2026-10-02", 8000),
    ...["2026-08-18", "2026-09-18", "2026-10-18"].map((date) => recurringTx("NETFLIX_INSTALLMENT", date, 5000, { installment_total: 12, installment_number: 3 })),
  ];
  await page.clock.setFixedTime(new Date("2026-10-22T12:00:00Z"));
  await page.route("**/api/data", (route) => route.fulfill({ json: recurringFixture }));
  await page.reload();
  const recurringPanel = page.getByRole("region", { name: "מנויים וחיובים חוזרים", exact: true });
  await recurringPanel.locator(".recurring-total strong").filter({ hasText: formatMoney(51570) }).waitFor();
  assert.equal(await recurringPanel.locator(".recurring-total strong").textContent(), formatMoney(51570));
  assert.equal(await recurringPanel.locator(":scope > .table-scroll tbody tr").count(), 4);
  const annualRow = recurringPanel.locator("tbody tr").filter({ hasText: "ביטוח דירה שנתי" });
  assert.match(await annualRow.textContent(), /שנתי/);
  assert.ok((await annualRow.textContent()).includes(formatMoney(10000)));
  assert.doesNotMatch(await recurringPanel.textContent(), /NETFLIX_INSTALLMENT/);
  const openAiRow = recurringPanel.locator("tbody tr").filter({ hasText: "OPENAI CHATGPT" });
  await openAiRow.getByText("לפי 3 חיובים", { exact: true }).click();
  assert.equal(await openAiRow.locator(".recurring-evidence li").count(), 3);
  await recurringPanel.getByText("1 שירותים ללא תדירות מזוהה · לבדיקה", { exact: true }).click();
  assert.match(await recurringPanel.locator(".recurring-review").first().textContent(), /GOOGLE GOOGLE ONE.*טרם זוהתה/s);
  await page.getByLabel("תקופה", { exact: true }).selectOption("month");
  assert.equal(await recurringPanel.locator(".recurring-total strong").textContent(), formatMoney(51570), "recurrence uses the full history even when dashboard selects this month");
  await recurringPanel.screenshot({ path: "test-results/recurring-payments-desktop.png", animations: "disabled" });
  await page.getByRole("button", { name: "הסתרת סכומים", exact: true }).click();
  assert.equal(await recurringPanel.locator(".recurring-total strong").textContent(), "••••••");
  assert.ok(!(await openAiRow.textContent()).includes(formatMoney(7580)));
  await page.getByRole("button", { name: "הצגת סכומים", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await recurringPanel.scrollIntoViewIfNeeded();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await recurringPanel.screenshot({ path: "test-results/recurring-payments-mobile.png", animations: "disabled" });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.unroute("**/api/data");
  console.log("PASS: recurring service panel shows monthly, two-month and yearly costs with evidence, excludes installments, separates unknown cadence, and masks amounts on mobile");
  await page.reload();
  await openAccounts(page);
  const maxCard = page.locator(".connection-grid .connection-card").filter({ hasText: "כרטיס האשראי שלי" });
  const importChoice = maxCard.getByRole("checkbox", { name: "לייבא כרטיס זה" });
  await importChoice.click();
  await maxCard.getByText("לא מיובא").waitFor();
  await page.reload();
  await openAccounts(page);
  const disabledMaxCard = page.locator(".connection-grid .connection-card").filter({ hasText: "כרטיס האשראי שלי" });
  assert.equal(await disabledMaxCard.getByRole("checkbox").isChecked(), false);
  await page.locator("nav").getByRole("button", { name: "סקירה כללית", exact: true }).click();
  assert.ok(!(await page.locator(".recent-transactions").textContent()).includes("max"));
  console.log("PASS: excluding a card persists and removes its activity from the dashboard");
  assert.deepEqual(errors, [], "Browser JavaScript exceptions");
  await context.close();
} finally {
  await browser.close();
}
