import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { createLocalJWKSet, jwtVerify } from "jose";

const issuer = "https://auth.openai.com";
const resource = "https://api.openai.com/v1";
const requiredScope = "chatgpt.tokens.use.direct";
const callbackPath = "/auth/callback";
const authorizeEndpoint = `${issuer}/api/accounts/authorize`;
const tokenEndpoint = `${issuer}/api/accounts/oauth/token`;
const jwksEndpoint = `${issuer}/.well-known/jwks.json`;

const fail = (message, status = 400) => Object.assign(new Error(message), { status });

export async function verifyIdentity(idToken, clientId, nonce, fetcher = fetch) {
  if (typeof idToken !== "string") throw fail("OpenAI לא החזיר אסימון זיהוי לחשבון");
  const response = await fetcher(jwksEndpoint, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw fail("לא ניתן לאמת את חשבון ChatGPT", 502);
  let payload;
  try {
    ({ payload } = await jwtVerify(idToken, createLocalJWKSet(await response.json()), {
      issuer, audience: clientId, algorithms: ["RS256"],
      requiredClaims: ["sub", "exp", "iat", "nonce"], clockTolerance: 5,
    }));
  } catch (error) {
    const detail = error.code === "ERR_JWT_EXPIRED" ? "אסימון הזיהוי פג"
      : error.claim === "aud" ? "אסימון הזיהוי אינו מיועד לחיבור Shklops הזה"
      : error.claim === "iss" ? "מנפיק אסימון הזיהוי אינו תואם ל־OpenAI"
      : error.code === "ERR_JWS_SIGNATURE_VERIFICATION_FAILED" ? "חתימת אסימון הזיהוי אינה תקינה"
      : error.code === "ERR_JWKS_NO_MATCHING_KEY" ? "מפתח החתימה לא נמצא אצל OpenAI"
      : "אסימון הזיהוי שהתקבל אינו תקין";
    throw fail(`אימות ChatGPT נכשל: ${detail}. נסו להתחבר שוב.`);
  }
  if (payload.nonce !== nonce) throw fail("אימות ChatGPT נכשל: קוד האימות אינו תואם לבקשה. נסו להתחבר שוב.");
  if (typeof payload.sub !== "string" || !payload.sub || payload.iat > Math.floor(Date.now() / 1000) + 5)
    throw fail("אימות ChatGPT נכשל: פרטי הזיהוי אינם תקינים");
  return { subject: payload.sub, email: typeof payload.email === "string" ? payload.email : null };
}

export function createAiAuth(store, { fetcher = fetch, callbackHost = "127.0.0.1" } = {}) {
  const { db } = store;
  const existingHost = db.prepare("SELECT value FROM ai_meta WHERE key='host_id'").get();
  const hostId = existingHost?.value || `urn:uuid:${randomUUID()}`;
  if (!existingHost) db.prepare("INSERT INTO ai_meta(key,value) VALUES('host_id',?)").run(hostId);
  const callbacks = new Map();
  const lastErrors = new Map();
  const refreshing = new Map();
  const row = (userId) => db.prepare("SELECT * FROM ai_connections WHERE user_id=?").get(userId);
  const status = (userId) => {
    const connection = row(userId);
    return { connected: Boolean(connection?.credentials), email: connection?.email || null,
      ...(lastErrors.has(userId) ? { error: lastErrors.get(userId) } : {}) };
  };

  async function exchange(body) {
    const response = await fetcher(tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const allowedCodes = new Set(["invalid_grant", "invalid_client", "invalid_request", "invalid_scope", "access_denied", "temporarily_unavailable", "unsupported_grant_type"]);
      const code = allowedCodes.has(body.error) ? body.error : "token_exchange_failed";
      throw fail(`OpenAI דחה את החלפת קוד האישור (${code}, HTTP ${response.status}). נסו להתחבר שוב.`,
        response.status === 400 || response.status === 401 ? 401 : 502);
    }
    return response.json();
  }

  async function start(userId, returnOrigin, { newAccount = false } = {}) {
    // The OSS OAuth grant is for a locally hosted app. Keep the return URL local.
    const target = new URL(returnOrigin);
    if (!(["localhost", "127.0.0.1"].includes(target.hostname) && target.protocol === "http:"))
      throw fail("חיבור ChatGPT זמין כרגע באתר המקומי בלבד");
    if (newAccount && row(userId)?.credentials)
      throw fail("נתקו את חיבור ChatGPT הקיים לפני בחירת חשבון אחר");
    callbacks.get(userId)?.cancel();
    lastErrors.delete(userId);
    const previous = newAccount ? null : row(userId);
    const clientId = previous?.client_id || "dynamic_agent_client";
    const state = randomBytes(32).toString("base64url");
    const nonce = randomBytes(32).toString("base64url");
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    let used = false;
    let cancelled = false;
    let timer;
    const callback = createServer(async (req, res) => {
      if (req.method !== "GET" || !req.url?.startsWith(`${callbackPath}?`)) {
        res.writeHead(404).end();
        return;
      }
      const params = new URL(req.url, `http://${callbackHost}`).searchParams;
      if (used || params.get("state") !== state) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end("Invalid OAuth state");
        return;
      }
      used = true;
      let stage = "callback";
      try {
        if (params.get("error")) throw fail("החיבור ל־ChatGPT בוטל");
        const issuedClient = previous?.client_id || params.get("client_id");
        if (!issuedClient || issuedClient === "dynamic_agent_client")
          throw fail("OpenAI לא החזיר מזהה חיבור חדש (client_id), ולכן לא ניתן להחליף את קוד האישור.");
        if (previous && params.get("client_id") && params.get("client_id") !== previous.client_id)
          throw fail("מזהה החיבור שהוחזר מ־OpenAI אינו תואם לבקשה");
        if (!params.get("code")) throw fail("OpenAI לא החזיר קוד אישור לחיבור");
        stage = "token_exchange";
        const tokens = await exchange({
          grant_type: "authorization_code",
          client_id: issuedClient,
          code: params.get("code"),
          code_verifier: verifier,
          redirect_uri: `http://${callbackHost}:${callback.address().port}${callbackPath}`,
          resource,
        });
        stage = "identity";
        const identity = await verifyIdentity(tokens.id_token, issuedClient, nonce, fetcher);
        if (previous && identity.subject !== previous.subject)
          throw fail("נבחר חשבון ChatGPT אחר. נתקו את החיבור הקודם ונסו שוב.");
        stage = "permission";
        if (!new Set(String(tokens.scope || "").split(" ")).has(requiredScope))
          throw fail("יש לאשר שימוש בתוכנית ChatGPT כדי לשאול שאלות");
        if (typeof tokens.access_token !== "string") throw fail("OpenAI לא החזיר אסימון גישה לשימוש בתוכנית");
        if (typeof tokens.refresh_token !== "string") throw fail("OpenAI לא החזיר הרשאה לחידוש החיבור. נסו לאשר מחדש את החיבור.");
        if (cancelled) throw fail("בקשת החיבור בוטלה");
        const expiresAt = Date.now() + Math.max(60, Number(tokens.expires_in) || 3600) * 1000;
        db.prepare(`INSERT INTO ai_connections(user_id,client_id,subject,email,credentials,expires_at)
          VALUES(?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET client_id=excluded.client_id,
          subject=excluded.subject,email=excluded.email,credentials=excluded.credentials,expires_at=excluded.expires_at`)
          .run(userId, issuedClient, identity.subject, identity.email,
            store.encrypt({ accessToken: tokens.access_token, refreshToken: tokens.refresh_token, idToken: tokens.id_token }), expiresAt);
        res.writeHead(302, { Location: `${returnOrigin}/?ai=connected`, "Cache-Control": "no-store" }).end();
      } catch (error) {
        // Keep only a sanitized explanation; never retain codes, tokens or callback URLs.
        const message = error.status ? error.message
          : error.name === "TimeoutError" ? "OpenAI לא הגיב בזמן. נסו שוב."
          : "לא ניתן להשלים את החיבור ל־OpenAI. נסו שוב.";
        lastErrors.set(userId, { stage, message });
        res.writeHead(302, { Location: `${returnOrigin}/?ai=error`, "Cache-Control": "no-store" }).end();
      } finally {
        clearTimeout(timer);
        if (callbacks.get(userId)?.server === callback) callbacks.delete(userId);
        callback.close();
      }
    });
    await new Promise((resolve, reject) => callback.once("error", reject).listen(0, callbackHost, resolve));
    const pending = { server: callback, cancel() {
      cancelled = true;
      clearTimeout(timer);
      callback.close();
      if (callbacks.get(userId) === pending) callbacks.delete(userId);
    } };
    callbacks.set(userId, pending);
    timer = setTimeout(() => pending.cancel(), 5 * 60 * 1000);
    timer.unref();
    const redirectUri = `http://${callbackHost}:${callback.address().port}${callbackPath}`;
    const url = new URL(authorizeEndpoint);
    for (const [key, value] of Object.entries({
      client_id: clientId,
      ext_agent_host_id: hostId,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
      resource,
      state,
      nonce,
      code_challenge_method: "S256",
      code_challenge: challenge,
    })) url.searchParams.set(key, value);
    if (!previous) url.searchParams.set("agent_name_hint", "Shklops");
    return url.toString();
  }

  async function token(userId) {
    const connection = row(userId);
    if (!connection?.credentials) throw fail("יש לחבר את ChatGPT בעמוד העוזר", 409);
    const credentials = store.decrypt(connection.credentials);
    if (connection.expires_at > Date.now() + 120000) return credentials.accessToken;
    if (!refreshing.has(userId)) {
      refreshing.set(userId, (async () => {
        const next = await exchange({ grant_type: "refresh_token", client_id: connection.client_id,
          refresh_token: credentials.refreshToken, resource });
        if (typeof next.access_token !== "string" || typeof next.refresh_token !== "string")
          throw fail("יש להתחבר מחדש ל־ChatGPT", 401);
        const updated = db.prepare("UPDATE ai_connections SET credentials=?,expires_at=? WHERE user_id=? AND credentials=?")
          .run(store.encrypt({ accessToken: next.access_token, refreshToken: next.refresh_token,
            idToken: next.id_token || credentials.idToken }),
          Date.now() + Math.max(60, Number(next.expires_in) || 3600) * 1000, userId, connection.credentials);
        if (!updated.changes) throw fail("חיבור ChatGPT השתנה. נסו שוב.", 409);
        return next.access_token;
      })().finally(() => refreshing.delete(userId)));
    }
    return refreshing.get(userId);
  }

  async function disconnect(userId) {
    lastErrors.delete(userId);
    callbacks.get(userId)?.cancel();
    const connection = row(userId);
    if (!connection?.credentials) return { ok: true, revoked: true };
    // Clear first so an in-flight refresh cannot restore a signed-out session.
    db.prepare("UPDATE ai_connections SET credentials=NULL,expires_at=NULL WHERE user_id=?").run(userId);
    let revoked = false;
    try {
      const credentials = store.decrypt(connection.credentials);
      const discovery = await fetcher(`${issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(10000) });
      if (discovery.ok) {
        const { revocation_endpoint: endpoint } = await discovery.json();
        if (endpoint?.startsWith(`${issuer}/`)) {
          const response = await fetcher(endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ token: credentials.refreshToken, token_type_hint: "refresh_token", client_id: connection.client_id }),
            signal: AbortSignal.timeout(10000) });
          revoked = response.ok;
        }
      }
    } catch { /* Local sign-out still takes effect. */ }
    return { ok: true, revoked };
  }

  return { status, start, token, disconnect, close() { for (const pending of callbacks.values()) pending.cancel(); callbacks.clear(); } };
}
