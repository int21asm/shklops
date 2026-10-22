import { randomUUID } from "node:crypto";
import { providers } from "./providers.js";

const cardProviders = providers.filter((provider) => provider.kind === "card").map((provider) => provider.id);
const providerSlots = cardProviders.map(() => "?").join(",");
const joins = "FROM transactions t JOIN accounts a ON a.id=t.account_id JOIN connections c ON c.id=a.connection_id";
const ownedCards = `c.user_id=? AND a.enabled=1 AND t.status='completed' AND c.provider IN (${providerSlots})`;
const needsCategory = "(t.category_source<>'chatgpt' OR t.category_description IS NOT t.description)";

export function createCategoryJobs(store, aiChat, aiAuth) {
  const { db } = store;
  const jobs = new Map();
  let closed = false;
  const publicJob = (job) => job ? { id: job.id, status: job.status, totalMerchants: job.totalMerchants,
    completedMerchants: job.completedMerchants, updatedTransactions: job.updatedTransactions,
    error: job.error, model: job.model, stage: job.stage, researchedMerchants: job.researchedMerchants } : null;
  function status(userId) {
    const counts = db.prepare(`SELECT count(*) AS totalTransactions,
      COALESCE(sum(CASE WHEN ${needsCategory} THEN 1 ELSE 0 END),0) AS pendingTransactions,
      COALESCE(sum(CASE WHEN t.category='כללי' THEN 1 ELSE 0 END),0) AS generalTransactions,
      max(t.categorized_at) AS lastCategorizedAt ${joins} WHERE ${ownedCards}`).get(userId, ...cardProviders);
    return { ...counts, connected: aiAuth.status(userId).connected, job: publicJob(jobs.get(userId)) };
  }
  function start(userId, { refresh = false, generalOnly = false, model } = {}) {
    if (jobs.get(userId)?.status === "running")
      throw Object.assign(new Error("סיווג הכרטיסים כבר פועל"), { status: 409 });
    if (!aiAuth.status(userId).connected)
      throw Object.assign(new Error("יש לחבר את ChatGPT בעמוד שאלו את שקלופס"), { status: 409 });
    const rows = db.prepare(`SELECT t.id,t.description ${joins} WHERE ${ownedCards}
      ${generalOnly ? "AND t.category='כללי'" : refresh ? "" : `AND ${needsCategory}`} ORDER BY t.date DESC,t.id`).all(userId, ...cardProviders);
    const groups = new Map();
    for (const row of rows) {
      const key = row.description.trim().replace(/\s+/g, " ").toLowerCase();
      if (!groups.has(key)) groups.set(key, { description: row.description, rows: [] });
      groups.get(key).rows.push(row);
    }
    const job = { id: randomUUID(), status: "running", totalMerchants: groups.size, completedMerchants: 0,
      updatedTransactions: 0, error: null, model: model || null, stage: "classifying", researchedMerchants: 0, controller: new AbortController() };
    jobs.set(userId, job);
    queueMicrotask(() => run(userId, job, [...groups.values()]));
    return publicJob(job);
  }
  async function run(userId, job, groups) {
    try {
      for (let offset = 0; offset < groups.length; offset += 25) {
        if (closed) return;
        const batch = groups.slice(offset, offset + 25);
        job.stage = "classifying";
        const result = await aiChat.classify(userId, batch.map((group, index) => ({ id: String(index), description: group.description })), job.model, job.controller.signal, {
          onLookup(event) { job.stage = event === "started" ? "researching" : "classifying"; if (event === "completed") job.researchedMerchants++; },
        });
        if (closed) return;
        const stamp = new Date().toISOString();
        const categories = new Map(result.categories.map((item) => [item.id, item]));
        db.exec("BEGIN IMMEDIATE");
        let updated = 0;
        try {
          const write = db.prepare(`UPDATE transactions SET category=?,category_source='chatgpt',categorized_at=?,category_model=?,category_description=?,
            category_explanation=?,category_confidence=?,category_sources=?,category_web_searched=?,category_version=?
            WHERE id=? AND description=? AND account_id IN (SELECT a.id FROM accounts a JOIN connections c ON c.id=a.connection_id
              WHERE c.user_id=? AND a.enabled=1 AND c.provider IN (${providerSlots}))`);
          batch.forEach((group, index) => {
            const item = categories.get(String(index));
            for (const row of group.rows)
              updated += Number(write.run(item.category, stamp, result.model, row.description,
                item.explanation || null, item.confidence || null, JSON.stringify(item.sources || []), Number(Boolean(item.webSearched)), result.version || null,
                row.id, row.description, userId, ...cardProviders).changes);
          });
          db.exec("COMMIT");
        } catch (error) { db.exec("ROLLBACK"); throw error; }
        job.updatedTransactions += updated;
        job.completedMerchants += batch.length;
        job.model = result.model;
      }
      job.status = "completed";
    } catch (error) {
      if (closed) return;
      job.status = "failed";
      job.error = error.status ? error.message : "הסיווג לא הושלם. תוצאות מאצוות קודמות נשמרו; אפשר לנסות שוב.";
      console.error(JSON.stringify({ event: "categorization_failed", code: error.aiCode || "categorization_error",
        stage: error.aiStage || "categorization", status: error.status || 500 }));
    }
  }
  return { status, start, shutdown() {
    closed = true;
    for (const job of jobs.values()) if (job.status === "running") job.controller.abort();
  } };
}
