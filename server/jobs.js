import { randomUUID } from "node:crypto";
import { importAccounts } from "./store.js";
import { liveScrape } from "./providers.js";
import { demoAccounts } from "./demo.js";

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export function createJobs(
  store,
  {
    adapter = liveScrape,
    mfaTimeout = 120000,
    runTimeout = 300000,
    demoDelay = 700,
  } = {},
) {
  const jobs = new Map();
  let active = 0;
  const queue = [];
  const persist = (job) => {
    store.db
      .prepare(
        "UPDATE runs SET status=?,finished_at=?,count=?,error=? WHERE id=?",
      )
      .run(
        job.status,
        job.finishedAt || null,
        job.count || 0,
        job.error || null,
        job.id,
      );
    store.db
      .prepare("UPDATE connections SET status=? WHERE id=?")
      .run(job.status, job.connectionId);
  };
  function finish(job, status, error) {
    job.status = status;
    job.error = error;
    job.finishedAt = new Date().toISOString();
    job.challenge = null;
    job.abort.abort();
    job.rejectMfa?.(new Error("cancelled"));
    job.rejectMfa = null;
    persist(job);
    // Keep only a bounded set of recent in-memory handles; history is in SQLite.
    if (jobs.size > 100)
      for (const [id, item] of jobs) {
        if (item.finishedAt && id !== job.id) {
          jobs.delete(id);
          break;
        }
      }
  }
  async function execute(job, connection, credentials, settings, demo) {
    active++;
    let deadline;
    try {
      if (job.status === "cancelled") return;
      job.status = "running";
      persist(job);
      const requestMfa = () =>
        new Promise((resolve, reject) => {
          if (job.abort.signal.aborted) {
            reject(new Error("cancelled"));
            return;
          }
          const timeout = setTimeout(() => {
            job.resolveMfa = null;
            job.rejectMfa = null;
            reject(new Error("mfa_timeout"));
          }, mfaTimeout);
          job.challenge = {
            id: randomUUID(),
            expiresAt: Date.now() + mfaTimeout,
          };
          job.status = "waiting_mfa";
          persist(job);
          job.resolveMfa = (code) => {
            clearTimeout(timeout);
            job.resolveMfa = null;
            job.rejectMfa = null;
            job.challenge = null;
            job.status = "running";
            persist(job);
            resolve(code);
          };
          job.rejectMfa = (error) => {
            clearTimeout(timeout);
            job.resolveMfa = null;
            job.rejectMfa = null;
            reject(error);
          };
        });
      const work = async () => {
        if (demo) {
          await pause(demoDelay);
          if (connection.provider === "oneZero") await requestMfa();
          await pause(demoDelay);
          return {
            success: true,
            accounts: demoAccounts(
              connection.provider === "oneZero"
                ? "hapoalim"
                : connection.provider,
            ),
          };
        }
        return adapter({
          connection,
          credentials,
          settings,
          requestMfa,
          signal: job.abort.signal,
          progress: (type) => {
            if (!job.abort.signal.aborted) job.progress = type;
          },
        });
      };
      const aborted = new Promise((_, reject) =>
        job.abort.signal.addEventListener(
          "abort",
          () => reject(new Error("cancelled")),
          { once: true },
        ),
      );
      const result = await Promise.race([
        work(),
        aborted,
        new Promise((_, reject) => {
          deadline = setTimeout(
            () => reject(new Error("run_timeout")),
            runTimeout,
          );
        }),
      ]);
      if (job.abort.signal.aborted) return;
      if (!result.success) {
        const known = {
          INVALID_PASSWORD: "פרטי הכניסה לא התקבלו. יש לבדוק אותם ולנסות שוב.",
          CHANGE_PASSWORD:
            connection.provider === "isracard"
              ? "אתר ישראכרט ביקש שינוי סיסמה או השלמת תהליך כניסה. היכנסו לאתר ישראכרט, השלימו את ההנחיות שם, ואז נסו לסנכרן שוב. לא יובאו נתונים בסנכרון הזה."
              : "הבנק דורש שינוי סיסמה. יש להיכנס לאתר הבנק.",
          ACCOUNT_BLOCKED: "החשבון חסום. יש לפנות לבנק.",
          TIMEOUT: "החיבור לבנק ארך זמן רב מדי.",
        };
        throw new Error(
          known[result.errorType] ||
            "הבנק לא החזיר נתונים. ייתכן שנדרש אישור באתר הבנק או שהסורק דורש עדכון.",
        );
      }
      if (!Array.isArray(result.accounts) || result.accounts.length === 0)
        throw new Error(
          "הסנכרון הסתיים בלי חשבונות או כרטיסים. לא יובאו נתונים. בדקו שיש חשבון פעיל באתר החברה ונסו שוב; אם הוא מופיע שם, ייתכן שהסורק דורש עדכון.",
        );
      job.count = importAccounts(store, connection.id, result.accounts || []);
      store.db
        .prepare("UPDATE connections SET synced_at=? WHERE id=?")
        .run(new Date().toISOString(), connection.id);
      finish(job, "completed");
    } catch (error) {
      if (job.status !== "cancelled")
        finish(
          job,
          "failed",
          error.message === "mfa_timeout"
            ? "הזמן להזנת קוד האימות הסתיים. ניתן להתחיל סנכרון חדש."
            : error.message === "run_timeout"
              ? "הסנכרון הגיע למגבלת חמש דקות. נסו שוב."
              : error.message?.startsWith("פרטי") ||
                  error.message?.startsWith("הבנק") ||
                  error.message?.startsWith("החשבון") ||
                  error.message?.startsWith("החיבור") ||
                  error.message?.startsWith("אתר ישראכרט") ||
                  error.message?.startsWith("הסנכרון הסתיים בלי")
                ? error.message
                : "לא הצלחנו להשלים את הסנכרון. בדקו את החיבור ונסו שוב.",
        );
    } finally {
      clearTimeout(deadline);
      for (const key of Object.keys(credentials)) delete credentials[key];
      active--;
      pump();
    }
  }
  function pump() {
    while (active < 2 && queue.length) {
      const item = queue.shift();
      if (item[0].status !== "cancelled") void execute(...item);
      else for (const key of Object.keys(item[2])) delete item[2][key];
    }
  }
  return {
    start(connection, user, credentials, settings) {
      if (queue.length >= 10)
        throw Object.assign(new Error("התור מלא. נסו שוב בעוד רגע."), {
          status: 429,
        });
      if (
        [...jobs.values()].some(
          (j) => j.connectionId === connection.id && !j.finishedAt,
        )
      )
        throw Object.assign(new Error("כבר מתבצע סנכרון לחשבון הזה."), {
          status: 409,
        });
      const job = {
        id: randomUUID(),
        userId: user.id,
        connectionId: connection.id,
        status: "queued",
        startedAt: new Date().toISOString(),
        abort: new AbortController(),
        count: 0,
      };
      jobs.set(job.id, job);
      store.db
        .prepare(
          "INSERT INTO runs(id,user_id,connection_id,status,started_at) VALUES(?,?,?,?,?)",
        )
        .run(job.id, user.id, connection.id, "queued", job.startedAt);
      queue.push([
        job,
        connection,
        { ...credentials },
        settings,
        Boolean(user.demo),
      ]);
      pump();
      return job.id;
    },
    list(userId) {
      return [...jobs.values()]
        .filter((j) => j.userId === userId)
        .map((j) => ({
          id: j.id,
          connectionId: j.connectionId,
          status: j.status,
          startedAt: j.startedAt,
          finishedAt: j.finishedAt,
          count: j.count,
          error: j.error,
          progress: j.progress,
          challenge: j.challenge,
        }));
    },
    submit(userId, id, challengeId, code) {
      const job = jobs.get(id);
      if (!job || job.userId !== userId)
        throw Object.assign(new Error("הסנכרון לא נמצא"), { status: 404 });
      if (
        !job.resolveMfa ||
        job.challenge?.id !== challengeId ||
        job.challenge.expiresAt <= Date.now()
      )
        throw Object.assign(new Error("קוד האימות פג תוקף או כבר נשלח"), {
          status: 409,
        });
      job.resolveMfa(code);
    },
    cancel(userId, id) {
      const job = jobs.get(id);
      if (!job || job.userId !== userId)
        throw Object.assign(new Error("הסנכרון לא נמצא"), { status: 404 });
      if (!job.finishedAt) finish(job, "cancelled", "הסנכרון בוטל");
    },
    activeForConnection(id) {
      return [...jobs.values()].some(
        (j) => j.connectionId === id && !j.finishedAt,
      );
    },
    shutdown() {
      for (const job of jobs.values())
        if (!job.finishedAt) finish(job, "cancelled", "השרת נסגר");
    },
  };
}
