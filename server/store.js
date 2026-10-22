import { DatabaseSync } from "node:sqlite";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  chmodSync,
} from "node:fs";
import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  createHash,
} from "node:crypto";
import path from "node:path";
import { bankDate } from "../shared/calendar.js";

export function createStore(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const keyFile = path.join(directory, "credential.key");
  // This key is for local development. Production must supply a managed key.
  if (!process.env.CREDENTIAL_KEY && !existsSync(keyFile))
    writeFileSync(keyFile, randomBytes(32), { mode: 0o600 });
  const key = process.env.CREDENTIAL_KEY
    ? Buffer.from(process.env.CREDENTIAL_KEY, "base64")
    : readFileSync(keyFile);
  if (key.length !== 32)
    throw new Error("CREDENTIAL_KEY must be a base64-encoded 32-byte key");
  const db = new DatabaseSync(path.join(directory, "finance.sqlite"));
  chmodSync(path.join(directory, "finance.sqlite"), 0o600);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password TEXT, demo INTEGER NOT NULL DEFAULT 0, settings TEXT NOT NULL DEFAULT '{"daysBack":90,"combineInstallments":false,"monthlyIncome":0}');
    CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS connections (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, provider TEXT NOT NULL, name TEXT NOT NULL, credentials TEXT, synced_at TEXT, status TEXT NOT NULL DEFAULT 'idle');
    CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE, number TEXT NOT NULL, currency TEXT NOT NULL, balance INTEGER, next_charge INTEGER, next_charge_date TEXT, UNIQUE(connection_id,number,currency));
    CREATE TABLE IF NOT EXISTS transactions (id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, fingerprint TEXT NOT NULL, date TEXT NOT NULL, description TEXT NOT NULL, amount INTEGER NOT NULL, currency TEXT NOT NULL, status TEXT NOT NULL, category TEXT NOT NULL, memo TEXT, UNIQUE(account_id,fingerprint));
    CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, connection_id TEXT REFERENCES connections(id) ON DELETE CASCADE, status TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, count INTEGER DEFAULT 0, error TEXT);
    CREATE TABLE IF NOT EXISTS ai_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS ai_connections (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, client_id TEXT NOT NULL, subject TEXT NOT NULL, email TEXT, credentials TEXT, expires_at INTEGER);
    CREATE INDEX IF NOT EXISTS connections_owner ON connections(user_id);
    CREATE INDEX IF NOT EXISTS tx_date ON transactions(date);
  `);
  if (
    !db
      .prepare("PRAGMA table_info(transactions)")
      .all()
      .some((column) => column.name === "source_date")
  )
    db.exec("ALTER TABLE transactions ADD COLUMN source_date TEXT");
  const transactionColumns = new Set(
    db.prepare("PRAGMA table_info(transactions)").all().map((column) => column.name),
  );
  for (const [name, type] of [
    ["processed_date", "TEXT"],
    ["installment_group", "TEXT"],
    ["installment_number", "INTEGER"],
    ["installment_total", "INTEGER"],
    ["category_source", "TEXT NOT NULL DEFAULT 'rule'"],
    ["categorized_at", "TEXT"],
    ["category_model", "TEXT"],
    ["category_description", "TEXT"],
    ["category_explanation", "TEXT"],
    ["category_confidence", "TEXT"],
    ["category_sources", "TEXT NOT NULL DEFAULT '[]'"],
    ["category_web_searched", "INTEGER NOT NULL DEFAULT 0"],
    ["category_version", "TEXT"],
  ]) {
    if (!transactionColumns.has(name)) db.exec(`ALTER TABLE transactions ADD COLUMN ${name} ${type}`);
  }
  const accountColumns = new Set(
    db.prepare("PRAGMA table_info(accounts)").all().map((column) => column.name),
  );
  if (!accountColumns.has("next_charge"))
    db.exec("ALTER TABLE accounts ADD COLUMN next_charge INTEGER");
  if (!accountColumns.has("next_charge_date"))
    db.exec("ALTER TABLE accounts ADD COLUMN next_charge_date TEXT");
  if (!accountColumns.has("enabled"))
    db.exec("ALTER TABLE accounts ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1");
  const connectionColumns = new Set(
    db.prepare("PRAGMA table_info(connections)").all().map((column) => column.name),
  );
  if (!connectionColumns.has("card_selection_configured"))
    db.exec("ALTER TABLE connections ADD COLUMN card_selection_configured INTEGER NOT NULL DEFAULT 0");
  reconcileMizrahiTransactions(db);
  db.prepare(
    "UPDATE runs SET status='interrupted',error='השרת הופעל מחדש. ניתן לנסות שוב.' WHERE status IN ('queued','running','waiting_mfa')",
  ).run();
  db.prepare(
    "UPDATE connections SET status='idle' WHERE status IN ('running','waiting_mfa')",
  ).run();
  return {
    db,
    encrypt(value) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const encrypted = Buffer.concat([
        cipher.update(JSON.stringify(value)),
        cipher.final(),
      ]);
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString(
        "base64",
      );
    },
    decrypt(value) {
      const bytes = Buffer.from(value, "base64");
      const decipher = createDecipheriv(
        "aes-256-gcm",
        key,
        bytes.subarray(0, 12),
      );
      decipher.setAuthTag(bytes.subarray(12, 28));
      return JSON.parse(
        Buffer.concat([
          decipher.update(bytes.subarray(28)),
          decipher.final(),
        ]).toString(),
      );
    },
    close: () => db.close(),
  };
}

export const hash = (value) => createHash("sha256").update(value).digest("hex");

function mizrahiIdentity(row) {
  return JSON.stringify([
    row.date,
    row.description,
    row.amount,
    row.currency,
    row.installment_number || 0,
  ]);
}

// Some Mizrahi reference numbers change between syncs. Older imports used
// those numbers as keys, so a later sync could insert a second copy of nearly
// every transaction in a month. Re-key by transaction content. When two
// import batches clearly overlap, keep the larger multiplicity of each batch;
// two genuinely identical purchases within one batch must remain two rows.
function reconcileMizrahiTransactions(db) {
  const rows = db.prepare(`
    SELECT t.rowid AS rowid,t.* FROM transactions t
    JOIN accounts a ON a.id=t.account_id
    JOIN connections c ON c.id=a.connection_id
    WHERE c.provider='mizrahi' ORDER BY t.rowid
  `).all();
  if (!rows.length) return;
  const months = new Map();
  for (const row of rows) {
    const monthKey = `${row.account_id}:${row.date.slice(0, 7)}`;
    if (!months.has(monthKey)) months.set(monthKey, new Map());
    const groups = months.get(monthKey);
    const identity = mizrahiIdentity(row);
    if (!groups.has(identity)) groups.set(identity, []);
    groups.get(identity).push(row);
  }
  const kept = [];
  const removed = [];
  for (const groups of months.values()) {
    const monthRows = [...groups.values()].flat().sort((a, b) => Number(a.rowid - b.rowid));
    const left = new Set();
    const rightCounts = new Map([...groups].map(([key, group]) => [key, group.length]));
    let bestSplit = null;
    for (let i = 0; i < monthRows.length - 1; i++) {
      const key = mizrahiIdentity(monthRows[i]);
      left.add(key);
      const remaining = rightCounts.get(key) - 1;
      if (remaining) rightCounts.set(key, remaining);
      else rightCounts.delete(key);
      const overlap = [...left].filter((identity) => rightCounts.has(identity)).length;
      const smallerBatch = Math.min(left.size, rightCounts.size);
      const balance = Math.min(i + 1, monthRows.length - i - 1);
      if (overlap >= 3 && overlap / smallerBatch >= 0.6 &&
          (!bestSplit || overlap > bestSplit.overlap ||
            (overlap === bestSplit.overlap && balance > bestSplit.balance)))
        bestSplit = { rowid: monthRows[i].rowid, overlap, balance };
    }
    for (const group of groups.values()) {
      if (!bestSplit) {
        kept.push(...group);
        continue;
      }
      const earlier = group.filter((row) => row.rowid <= bestSplit.rowid);
      const later = group.filter((row) => row.rowid > bestSplit.rowid);
      const winners = later.length >= earlier.length ? later : earlier;
      kept.push(...winners);
      removed.push(...group.filter((row) => !winners.includes(row)));
    }
  }
  const occurrenceByIdentity = new Map();
  const changed = [];
  for (const row of kept) {
    const identity = mizrahiIdentity(row);
    const key = `${row.account_id}:${identity}`;
    const occurrence = occurrenceByIdentity.get(key) || 0;
    occurrenceByIdentity.set(key, occurrence + 1);
    const fingerprint = hash(`${identity}:${occurrence}`);
    const id = hash(`${row.account_id}:${fingerprint}`);
    if (row.id !== id || row.fingerprint !== fingerprint)
      changed.push({ rowid: row.rowid, id, fingerprint });
  }
  if (!removed.length && !changed.length) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    const deleteRow = db.prepare("DELETE FROM transactions WHERE rowid=?");
    for (const row of removed) deleteRow.run(row.rowid);
    const rekey = db.prepare("UPDATE transactions SET id=?,fingerprint=? WHERE rowid=?");
    for (const row of changed)
      rekey.run(hash(`mizrahi-migration:${row.id}`), hash(`mizrahi-migration:${row.fingerprint}`), row.rowid);
    for (const row of changed) rekey.run(row.id, row.fingerprint, row.rowid);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function category(description = "") {
  if (/שופרסל|רמי לוי|סופר|AM:PM|ויקטורי/i.test(description))
    return "מזון וקניות";
  if (/wolt|קפה|מסעד|ארומה|פיצה/i.test(description)) return "אוכל ובילויים";
  if (/דלק|רכבת|פנגו|רב.קו|סונול/i.test(description)) return "תחבורה";
  if (/משכורת|שכר עבודה/i.test(description)) return "הכנסה";
  if (/חשמל|מים|ארנונה|אינטרנט|בזק|שכירות|שכר דירה/i.test(description))
    return "בית וחשבונות";
  if (/netflix|spotify|apple|google/i.test(description)) return "מנויים";
  return "כללי";
}

export function importAccounts(store, connectionId, results) {
  const { db } = store;
  const connection = db
    .prepare("SELECT provider,card_selection_configured FROM connections WHERE id=?")
    .get(connectionId);
  const provider = connection?.provider;
  let inserted = 0;
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const account of results) {
      const currency = account.currency || "ILS";
      const number = String(account.accountNumber);
      const accountId = hash(`${connectionId}:${number}:${currency}`);
      const existing = db.prepare("SELECT enabled FROM accounts WHERE id=?").get(accountId);
      const enabled = existing ? Boolean(existing.enabled) : !connection?.card_selection_configured;
      const balance = Number.isFinite(account.balance)
        ? Math.round(account.balance * 100)
        : null;
      const nextCharge = Number.isFinite(account.nextChargeAmount)
        ? Math.round(account.nextChargeAmount * 100)
        : null;
      const nextChargeDate =
        typeof account.nextChargeDate === "string" &&
        Number.isFinite(Date.parse(account.nextChargeDate))
          ? bankDate(account.nextChargeDate)
          : null;
      db.prepare(
        "INSERT INTO accounts(id,connection_id,number,currency,balance,next_charge,next_charge_date,enabled) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(connection_id,number,currency) DO UPDATE SET balance=excluded.balance,next_charge=excluded.next_charge,next_charge_date=excluded.next_charge_date",
      ).run(
        accountId,
        connectionId,
        number,
        currency,
        enabled ? balance : null,
        enabled ? nextCharge : null,
        enabled ? nextChargeDate : null,
        Number(enabled),
      );
      if (!enabled) continue;
      const occurrences = new Map();
      const legacyOccurrences = new Map();
      for (const tx of account.txns || []) {
        if (
          !Number.isFinite(tx.chargedAmount) ||
          !Number.isFinite(Date.parse(tx.date))
        )
          throw new Error("Invalid scraper transaction");
        const date = bankDate(tx.date);
        const legacyDate = new Date(tx.date).toISOString().slice(0, 10);
        const txCurrency =
          tx.chargedCurrency || (currency !== "ILS" ? currency : "ILS");
        const amount = Math.round(tx.chargedAmount * 100);
        const processedDate = typeof tx.processedDate === "string" &&
          Number.isFinite(Date.parse(tx.processedDate))
          ? bankDate(tx.processedDate)
          : null;
        const installmentNumber = Number.isInteger(tx.installments?.number)
          ? tx.installments.number : null;
        const installmentTotal = Number.isInteger(tx.installments?.total)
          ? tx.installments.total : null;
        const installmentGroup = installmentNumber && installmentTotal && tx.identifier != null
          ? hash(`${accountId}:${tx.identifier}`) : null;
        // Status is deliberately excluded: pending transactions become completed.
        const identity =
          provider !== "mizrahi" && tx.identifier != null
            ? JSON.stringify([tx.identifier, tx.installments?.number || 0])
            : JSON.stringify([
                date,
                tx.description,
                amount,
                txCurrency,
                tx.installments?.number || 0,
              ]);
        const occurrence = occurrences.get(identity) || 0;
        occurrences.set(identity, occurrence + 1);
        const fingerprint = hash(`${identity}:${occurrence}`);
        const id = hash(`${accountId}:${fingerprint}`);
        // Mizrahi returns Israeli local midnight as a UTC timestamp. Re-key
        // identifier-less rows imported by the old UTC-date algorithm when the
        // same source transaction is seen again, retaining its multiplicity.
        if (
          provider === "mizrahi" &&
          tx.identifier == null &&
          date !== legacyDate
        ) {
          const legacyIdentity = JSON.stringify([
            legacyDate,
            tx.description,
            amount,
            txCurrency,
            tx.installments?.number || 0,
          ]);
          const legacyOccurrence = legacyOccurrences.get(legacyIdentity) || 0;
          legacyOccurrences.set(legacyIdentity, legacyOccurrence + 1);
          const legacyFingerprint = hash(
            `${legacyIdentity}:${legacyOccurrence}`,
          );
          if (!db.prepare("SELECT id FROM transactions WHERE id=?").get(id))
            db.prepare(
              "UPDATE transactions SET id=?,fingerprint=? WHERE account_id=? AND fingerprint=? AND source_date IS NULL",
            ).run(id, fingerprint, accountId, legacyFingerprint);
        }
        const exists = db
          .prepare("SELECT id FROM transactions WHERE id=?")
          .get(id);
        db.prepare(
          `INSERT INTO transactions(id,account_id,fingerprint,date,description,amount,currency,status,category,memo,source_date,processed_date,installment_group,installment_number,installment_total) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(account_id,fingerprint) DO UPDATE SET date=excluded.date,status=excluded.status,amount=excluded.amount,description=excluded.description,memo=excluded.memo,source_date=excluded.source_date,processed_date=excluded.processed_date,installment_group=excluded.installment_group,installment_number=excluded.installment_number,installment_total=excluded.installment_total`,
        ).run(
          id,
          accountId,
          fingerprint,
          date,
          String(tx.description || "תנועה"),
          amount,
          txCurrency,
          tx.status || "completed",
          typeof tx.category === "string" && tx.category
            ? tx.category
            : category(tx.description),
          tx.memo || null,
          tx.date,
          processedDate,
          installmentGroup,
          installmentNumber,
          installmentTotal,
        );
        if (!exists) inserted++;
      }
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return inserted;
}
