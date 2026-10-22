import express from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import {
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createStore, hash } from "./store.js";
import { providers, providerById } from "./providers.js";
import { seedDemo } from "./demo.js";
import { createJobs } from "./jobs.js";
import { createAiAuth } from "./ai-auth.js";
import { createAiChat } from "./ai-chat.js";
import { createCategoryJobs } from "./category-jobs.js";
import { normalizeCurrency } from "../shared/currency.js";
const scrypt = promisify(scryptCallback);
const root = fileURLToPath(new URL("../", import.meta.url));
const validCredentials = z
  .record(z.string().max(1024))
  .refine((v) => Object.keys(v).length <= 8);
const schema = z.object({
  email: z
    .string()
    .email()
    .max(254)
    .transform((v) => v.toLowerCase()),
  password: z.string().min(12).max(128),
  name: z.string().trim().min(1).max(60).optional(),
});
const settingsSchema = z
  .object({
    daysBack: z.number().int().min(1).max(730),
    combineInstallments: z.boolean(),
    monthlyIncome: z.number().int().min(0).max(1_000_000_000).default(0),
    monthlyCardEstimate: z.number().int().min(0).max(1_000_000_000).nullable().default(null),
    cardEstimatesByMonth: z
      .record(
        z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
        z.number().int().min(0).max(1_000_000_000),
      )
      .default({}),
  })
  .strict();
const publicUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.demo ? null : u.email,
  demo: Boolean(u.demo),
});

export async function createApplication({
  dataDir = process.env.DATA_DIR || path.join(root, ".data"),
  live = process.env.ENABLE_LIVE_SCRAPING === "true",
  production = process.env.NODE_ENV === "production",
  jobsOptions,
  aiOptions,
  development = false,
} = {}) {
  if (production && !process.env.CREDENTIAL_KEY)
    throw new Error("Production requires CREDENTIAL_KEY from a secret manager");
  if (production && !process.env.APP_ORIGIN?.startsWith("https://"))
    throw new Error("Production requires an HTTPS APP_ORIGIN");
  const store = createStore(dataDir),
    { db } = store;
  const jobs = createJobs(store, jobsOptions);
  const aiAuth = createAiAuth(store, aiOptions);
  const aiChat = createAiChat(store, aiAuth, aiOptions);
  const categoryJobs = createCategoryJobs(store, aiChat, aiAuth);
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet({ contentSecurityPolicy: development ? false : undefined }));
  app.use(express.json({ limit: "16kb" }));
  app.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  // All writes require the browser's exact configured origin. No CORS is enabled.
  app.use("/api", (req, res, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const expected = process.env.APP_ORIGIN || `http://${req.get("host")}`;
      if (req.get("origin") !== expected || !req.is("application/json"))
        return res.status(403).json({ error: "בקשה ממקור לא מורשה" });
    }
    next();
  });
  app.use(
    "/api",
    rateLimit({
      windowMs: 60000,
      limit: 600,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );
  const authLimit = rateLimit({
    windowMs: 15 * 60000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "יותר מדי ניסיונות. נסו שוב מאוחר יותר." },
  });
  function session(req, res, user) {
    const token = randomBytes(32).toString("base64url");
    const cookieName = production ? "__Host-shklops" : "shklops";
    const old = req.headers.cookie
      ?.split("; ")
      .find((c) => c.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1);
    if (old) db.prepare("DELETE FROM sessions WHERE hash=?").run(hash(old));
    db.prepare("DELETE FROM sessions WHERE expires<?").run(Date.now());
    db.prepare("INSERT INTO sessions(hash,user_id,expires) VALUES(?,?,?)").run(
      hash(token),
      user.id,
      Date.now() + 86400000,
    );
    res.cookie(cookieName, token, {
      httpOnly: true,
      sameSite: "strict",
      secure: production,
      path: "/",
      maxAge: 86400000,
    });
  }
  app.use("/api", (req, _res, next) => {
    const name = production ? "__Host-shklops" : "shklops";
    const token = req.headers.cookie
      ?.split("; ")
      .find((c) => c.startsWith(`${name}=`))
      ?.slice(name.length + 1);
    if (token)
      req.user = db
        .prepare(
          "SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.hash=? AND s.expires>?",
        )
        .get(hash(token), Date.now());
    next();
  });
  app.get("/api/session", (req, res) =>
    res.json({
      user: req.user ? publicUser(req.user) : null,
      liveEnabled: live,
    }),
  );
  app.post("/api/auth/register", authLimit, async (req, res) => {
    const { email, password, name } = schema.parse(req.body);
    if (db.prepare("SELECT id FROM users WHERE email=?").get(email))
      return res
        .status(409)
        .json({ error: "לא ניתן ליצור חשבון עם הפרטים האלה. נסו להתחבר." });
    const salt = randomBytes(16).toString("hex");
    const digest = (await scrypt(password, salt, 64)).toString("hex");
    const user = {
      id: randomUUID(),
      email,
      name: name || email.split("@")[0],
      demo: 0,
    };
    db.prepare("INSERT INTO users(id,email,name,password) VALUES(?,?,?,?)").run(
      user.id,
      email,
      user.name,
      `${salt}:${digest}`,
    );
    session(req, res, user);
    res.status(201).json({ user: publicUser(user) });
  });
  const dummySalt = randomBytes(16).toString("hex");
  const dummyHash = await scrypt(randomBytes(32), dummySalt, 64);
  app.post("/api/auth/login", authLimit, async (req, res) => {
    const { email, password } = schema.parse(req.body);
    const user = db
      .prepare("SELECT * FROM users WHERE email=? AND demo=0")
      .get(email);
    const [salt, digest] = user?.password?.split(":") || [
      dummySalt,
      dummyHash.toString("hex"),
    ];
    const computed = await scrypt(password, salt, 64);
    if (!user || !timingSafeEqual(computed, Buffer.from(digest, "hex")))
      return res.status(401).json({ error: "האימייל או הסיסמה אינם נכונים" });
    session(req, res, user);
    res.json({ user: publicUser(user) });
  });
  app.post("/api/auth/demo", authLimit, (req, res) => {
    const user = {
      id: randomUUID(),
      email: `demo-${randomUUID()}@local.invalid`,
      name: "דניאל",
      demo: 1,
    };
    db.prepare("INSERT INTO users(id,email,name,demo) VALUES(?,?,?,1)").run(
      user.id,
      user.email,
      user.name,
    );
    seedDemo(store, user.id);
    session(req, res, user);
    res.status(201).json({ user: publicUser(user) });
  });
  app.use("/api", (req, res, next) =>
    req.user ? next() : res.status(401).json({ error: "יש להתחבר כדי להמשיך" }),
  );
  app.post("/api/auth/logout", (req, res) => {
    // Revoke every session for this account, including this browser's cookie.
    db.prepare("DELETE FROM sessions WHERE user_id=?").run(req.user.id);
    res.clearCookie(production ? "__Host-shklops" : "shklops", { path: "/" });
    res.json({ ok: true });
  });
  app.get("/api/providers", (_req, res) => res.json(providers));
  const aiLimit = rateLimit({ windowMs: 60000, limit: 12, standardHeaders: "draft-8", legacyHeaders: false,
    message: { error: "יותר מדי שאלות. נסו שוב בעוד דקה." } });
  app.get("/api/ai/status", (req, res) => res.json(aiAuth.status(req.user.id)));
  app.post("/api/ai/connect", aiLimit, async (req, res) => {
    const { newAccount } = z.object({ newAccount: z.boolean().optional() }).strict().parse(req.body);
    const origin = process.env.APP_ORIGIN || `http://${req.get("host")}`;
    res.json({ url: await aiAuth.start(req.user.id, origin, { newAccount }) });
  });
  app.post("/api/ai/disconnect", aiLimit, async (req, res) => res.json(await aiAuth.disconnect(req.user.id)));
  app.get("/api/ai/models", aiLimit, async (req, res) => res.json(await aiChat.models(req.user.id)));
  app.post("/api/ai/ask", aiLimit, async (req, res) => {
    const { question, model, history } = z.object({ question: z.string().trim().min(2).max(1000),
      model: z.string().max(100).optional(), history: z.array(z.object({
        question: z.string().max(1000), answer: z.string().max(4000),
      }).strict()).max(4).optional() }).strict().parse(req.body);
    res.json(await aiChat.ask(req.user.id, question, model, history));
  });
  app.get("/api/ai/categorization", (req, res) => res.json(categoryJobs.status(req.user.id)));
  app.post("/api/ai/categorization", aiLimit, (req, res) => {
    const options = z.object({ refresh: z.boolean().optional(), generalOnly: z.boolean().optional(), model: z.string().max(100).optional() }).strict().parse(req.body);
    res.status(202).json(categoryJobs.start(req.user.id, options));
  });
  app.get("/api/settings", (req, res) =>
    res.json({
      monthlyIncome: 0,
      monthlyCardEstimate: null,
      cardEstimatesByMonth: {},
      ...JSON.parse(req.user.settings),
    }),
  );
  app.put("/api/settings", (req, res) => {
    const settings = settingsSchema.parse(req.body);
    db.prepare("UPDATE users SET settings=? WHERE id=?").run(
      JSON.stringify(settings),
      req.user.id,
    );
    res.json(settings);
  });
  app.get("/api/data", (req, res) => {
    const connections = db
      .prepare(
        "SELECT id,provider,name,synced_at,status,credentials IS NOT NULL AS remembered FROM connections WHERE user_id=?",
      )
      .all(req.user.id);
    const accounts = db
      .prepare(
        "SELECT a.*,c.provider,c.name AS connection_name FROM accounts a JOIN connections c ON c.id=a.connection_id WHERE c.user_id=?",
      )
      .all(req.user.id);
    const transactions = db
      .prepare(
        "SELECT t.*,a.number AS account_number,a.connection_id,c.provider,c.name AS connection_name FROM transactions t JOIN accounts a ON a.id=t.account_id JOIN connections c ON c.id=a.connection_id WHERE c.user_id=? AND a.enabled=1 ORDER BY t.date DESC,t.id DESC LIMIT 10000",
      )
      .all(req.user.id);
    const total = db
      .prepare(
        "SELECT count(*) AS count FROM transactions t JOIN accounts a ON a.id=t.account_id JOIN connections c ON c.id=a.connection_id WHERE c.user_id=? AND a.enabled=1",
      )
      .get(req.user.id).count;
    const runs = db
      .prepare(
        "SELECT id,connection_id,status,started_at,finished_at,count,error FROM runs WHERE user_id=? ORDER BY started_at DESC LIMIT 20",
      )
      .all(req.user.id);
    res.json({
      connections,
      accounts: accounts.map((account) => ({
        ...account,
        enabled: Boolean(account.enabled),
        next_charge:
          account.next_charge ??
          (account.provider === "visaCal" && Number.isFinite(account.balance)
            ? Math.abs(account.balance)
            : null),
        currency: normalizeCurrency(account.currency),
      })),
      transactions: transactions.map((transaction) => ({
        ...transaction,
        currency: normalizeCurrency(transaction.currency),
      })),
      runs,
      truncated: total > transactions.length,
      total,
    });
  });
  app.patch("/api/accounts/:id", (req, res) => {
    const { enabled } = z.object({ enabled: z.boolean() }).strict().parse(req.body);
    const account = db.prepare(
      "SELECT a.id,a.connection_id,a.number,c.provider FROM accounts a JOIN connections c ON c.id=a.connection_id WHERE a.id=? AND c.user_id=?",
    ).get(req.params.id, req.user.id);
    if (!account) return res.status(404).json({ error: "הכרטיס לא נמצא" });
    if (providerById[account.provider]?.kind !== "card")
      return res.status(400).json({ error: "ניתן לבחור ייבוא לכרטיסי אשראי בלבד" });
    if (jobs.activeForConnection(account.connection_id))
      return res.status(409).json({ error: "יש להמתין לסיום הסנכרון לפני שינוי בחירת הכרטיסים" });
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("UPDATE connections SET card_selection_configured=1 WHERE id=?")
        .run(account.connection_id);
      db.prepare("UPDATE accounts SET enabled=?,balance=NULL,next_charge=NULL,next_charge_date=NULL WHERE connection_id=? AND number=?")
        .run(Number(enabled), account.connection_id, account.number);
      if (!enabled) db.prepare("DELETE FROM transactions WHERE account_id IN (SELECT id FROM accounts WHERE connection_id=? AND number=?)")
        .run(account.connection_id, account.number);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    res.json({ enabled });
  });
  app.post("/api/connections", (req, res) => {
    const input = z
      .object({
        provider: z.string(),
        name: z.string().trim().min(1).max(80),
        remember: z.boolean().default(false),
        credentials: validCredentials.default({}),
      })
      .parse(req.body);
    const provider = providerById[input.provider];
    if (!provider) return res.status(400).json({ error: "ספק לא נתמך" });
    if (
      db
        .prepare("SELECT count(*) AS count FROM connections WHERE user_id=?")
        .get(req.user.id).count >= 20
    )
      return res.status(400).json({ error: "ניתן לחבר עד 20 חשבונות" });
    if (!req.user.demo && !live && Object.keys(input.credentials).length)
      return res
        .status(400)
        .json({ error: "סריקה חיה אינה מופעלת בשרת זה. אין לשלוח פרטי בנק." });
    if (!req.user.demo && input.remember)
      validateFields(provider, input.credentials);
    const id = randomUUID();
    db.prepare(
      "INSERT INTO connections(id,user_id,provider,name,credentials) VALUES(?,?,?,?,?)",
    ).run(
      id,
      req.user.id,
      input.provider,
      input.name,
      !req.user.demo && input.remember
        ? store.encrypt(input.credentials)
        : null,
    );
    res.status(201).json({ id });
  });
  function owned(req) {
    const connection = db
      .prepare("SELECT * FROM connections WHERE id=? AND user_id=?")
      .get(req.params.id, req.user.id);
    if (!connection)
      throw Object.assign(new Error("החיבור לא נמצא"), { status: 404 });
    return connection;
  }
  app.delete("/api/connections/:id", (req, res) => {
    const connection = owned(req);
    if (jobs.activeForConnection(connection.id))
      return res.status(409).json({ error: "יש לבטל תחילה את הסנכרון הפעיל" });
    db.prepare("DELETE FROM connections WHERE id=? AND user_id=?").run(
      connection.id,
      req.user.id,
    );
    res.json({ ok: true });
  });
  app.post("/api/connections/:id/forget", (req, res) => {
    const connection = owned(req);
    db.prepare("UPDATE connections SET credentials=NULL WHERE id=?").run(
      connection.id,
    );
    res.json({ ok: true });
  });
  app.post("/api/connections/:id/sync", (req, res) => {
    const connection = owned(req);
    if (!req.user.demo && !live)
      return res.status(403).json({
        error:
          "סריקה חיה אינה מופעלת. ניתן להפעיל אותה בהגדרות השרת לאחר הגדרת אחסון מאובטח.",
      });
    const input = z
      .object({ credentials: validCredentials.optional() })
      .parse(req.body);
    const credentials = req.user.demo
      ? {}
      : input.credentials ||
        (connection.credentials ? store.decrypt(connection.credentials) : {});
    if (!req.user.demo)
      validateFields(providerById[connection.provider], credentials);
    const id = jobs.start(
      connection,
      req.user,
      credentials,
      JSON.parse(req.user.settings),
    );
    res.status(202).json({ id });
  });
  app.get("/api/jobs", (req, res) => res.json(jobs.list(req.user.id)));
  app.post(
    "/api/jobs/:id/mfa",
    rateLimit({ windowMs: 60000, limit: 10, legacyHeaders: false }),
    (req, res) => {
      const { challengeId, code } = z
        .object({
          challengeId: z.string().uuid(),
          code: z.string().regex(/^[0-9]{4,10}$/),
        })
        .parse(req.body);
      jobs.submit(req.user.id, req.params.id, challengeId, code);
      res.json({ ok: true });
    },
  );
  app.post("/api/jobs/:id/cancel", (req, res) => {
    jobs.cancel(req.user.id, req.params.id);
    res.json({ ok: true });
  });
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "הפעולה לא נמצאה" }),
  );
  let vite;
  if (development) {
    vite = await (
      await import("vite")
    ).createServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(root, "dist")));
    app.get("/{*path}", (_req, res) =>
      res.sendFile(path.join(root, "dist/index.html")),
    );
  }
  app.use((error, req, res, _next) => {
    const requestId = randomUUID();
    const frames = String(error.cause?.stack || error.stack || "").split("\n")
      .filter((line) => /^\s+at\s/.test(line)).slice(0, 3);
    console.error(JSON.stringify({ event: "request_failed", requestId,
      route: req.route?.path || "unknown", method: req.method, status: error instanceof z.ZodError ? 400 : error.status || 500,
      name: error.name, code: error.aiCode || null, stage: error.aiStage || null, frames }));
    res.set("X-Request-Id", requestId);
    if (error instanceof z.ZodError)
      return res.status(400).json({
        error: "יש לבדוק את השדות ולנסות שוב",
        fields: error.issues.map((i) => i.path.join(".")),
      });
    res.status(error.status || 500).json({
      error: error.status ? error.message : "אירעה שגיאה בשרת. נסו שוב.",
      requestId,
    });
  });
  return {
    app,
    store,
    jobs,
    close: async () => {
      jobs.shutdown();
      aiAuth.close();
      categoryJobs.shutdown();
      await vite?.close();
      store.close();
    },
  };
}
function validateFields(provider, credentials) {
  if (
    provider.fields.some(
      (field) =>
        typeof credentials[field] !== "string" || !credentials[field].trim(),
    )
  )
    throw Object.assign(new Error("יש למלא את כל פרטי הכניסה לבנק"), {
      status: 400,
    });
  if (
    Object.keys(credentials).some((field) => !provider.fields.includes(field))
  )
    throw Object.assign(new Error("שדה כניסה לא נתמך"), { status: 400 });
}
