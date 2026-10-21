import { createRequire } from "node:module";
import { addMizrahiBalanceFallback } from "./mizrahi-balance.js";
const require = createRequire(import.meta.url);
const library = require("israeli-bank-scrapers");
export const { createScraper, SCRAPERS } = library;
const names = {
  hapoalim: "בנק הפועלים",
  leumi: "בנק לאומי",
  discount: "בנק דיסקונט",
  mercantile: "מרכנתיל",
  mizrahi: "מזרחי טפחות",
  beinleumi: "הבינלאומי",
  otsarHahayal: "אוצר החייל",
  massad: "בנק מסד",
  yahav: "בנק יהב",
  union: "בנק אגוד",
  pagi: "פאג״י",
  oneZero: "ONE ZERO",
  max: "max",
  visaCal: "כאל",
  isracard: "ישראכרט",
  amex: "American Express",
  behatsdaa: "בהצדעה",
  beyahadBishvilha: "ביחד בשבילך",
};
export const providers = Object.entries(SCRAPERS).map(([id, value]) => ({
  id,
  name: names[id] || value.name,
  fields: value.loginFields.filter(
    (f) => !["otpCodeRetriever", "otpLongTermToken"].includes(f),
  ),
  kind: ["max", "visaCal", "isracard", "amex"].includes(id) ? "card" : "bank",
  mfa: id === "oneZero",
}));
export const providerById = Object.fromEntries(providers.map((p) => [p.id, p]));

export async function liveScrape({
  connection,
  credentials,
  settings,
  requestMfa,
  signal,
  progress,
}) {
  let browser;
  try {
    const options = {
      companyId: connection.provider,
      startDate: new Date(Date.now() - settings.daysBack * 86400000),
      combineInstallments: settings.combineInstallments,
      // Cal can return already-scheduled card activity beyond the next bill.
      // Fetch three future billing months for month-specific cash-flow data.
      ...(connection.provider === "visaCal" ? { futureMonthsToScrape: 3 } : {}),
      timeout: 45000,
      verbose: false,
    };
    // ONE ZERO uses HTTP APIs. Other providers use a browser that we own and
    // close on cancellation/timeouts as well as normal completion.
    if (connection.provider !== "oneZero") {
      const puppeteer = require("israeli-bank-scrapers/node_modules/puppeteer");
      browser = await puppeteer.launch({
        headless: true,
        executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
        args: process.env.CHROMIUM_NO_SANDBOX === "1" ? ["--no-sandbox"] : [],
      });
      if (signal.aborted) throw new Error("cancelled");
      options.browser = browser;
    }
    const stop = () => {
      browser?.close().catch(() => {});
    };
    signal.addEventListener("abort", stop, { once: true });
    try {
      const scraper = createScraper(options);
      if (connection.provider === "mizrahi") addMizrahiBalanceFallback(scraper);
      scraper.onProgress((_, payload) => progress(payload.type));
      const input = { ...credentials };
      if (connection.provider === "oneZero")
        input.otpCodeRetriever = requestMfa;
      const result = await scraper.scrape(input);
      // Visa Cal exposes the next debit amount and debit date through its
      // account balance fields. Keep this separate from the card's current
      // balance so the dashboard can label it accurately.
      if (connection.provider === "visaCal" && result.success) {
        for (const account of result.accounts || []) {
          if (
            Number.isFinite(account.balance) &&
            typeof account.balanceDate === "string" &&
            Number.isFinite(Date.parse(account.balanceDate))
          ) {
            account.nextChargeAmount = Math.abs(account.balance);
            account.nextChargeDate = account.balanceDate;
          }
        }
      }
      return result;
    } finally {
      signal.removeEventListener("abort", stop);
    }
  } finally {
    await browser?.close().catch(() => {});
  }
}
