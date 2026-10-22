import { createHash, createPublicKey, randomBytes, randomUUID, verify } from "node:crypto";
import { createServer } from "node:http";

const issuer = "https://auth.openai.com";
const resource = "https://api.openai.com/v1";
const requiredScope = "chatgpt.tokens.use.direct";
const callbackPath = "/auth/callback";
const authorizeEndpoint = `${issuer}/api/accounts/authorize`;
const tokenEndpoint = `${issuer}/api/accounts/oauth/token`;
const jwksEndpoint = `${issuer}/.well-known/jwks.json`;

const fail = (message, status = 400) => Object.assign(new Error(message), { status });

export async function verifyIdentity(idToken, clientId, nonce, fetcher = fetch) {
  const parts = idToken?.split(".");
  if (parts?.length !== 3) throw fail("אימות ChatGPT נכשל");
  let header, payload;
  try {
    header = JSON.parse(Buffer.from(parts[0], "base64url"));
    payload = JSON.parse(Buffer.from(parts[1], "base64url"));
  } catch {
    throw fail("אימות ChatGPT נכשל");
  }
  if (header.alg !== "RS256" || typeof header.kid !== "string")
    throw fail("שיטת אימות ChatGPT אינה נתמכת");
  const response = await fetcher(jwksEndpoint, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw fail("לא ניתן לאמת את חשבון ChatGPT", 502);
  const { keys } = await response.json();
  const jwk = keys?.find((key) => key.kid === header.kid && key.kty === "RSA" && (!key.use || key.use === "sig"));
  if (!jwk || !verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(parts[2], "base64url")))
    throw fail("אימות ChatGPT נכשל");
  const now = Math.floor(Date.now() / 1000);
  if (payload.iss !== issuer || payload.aud !== clientId || payload.nonce !== nonce ||
      typeof payload.sub !== "string" || !payload.sub ||
      !Number.isInteger(payload.iat) || payload.iat > now + 5 ||
      !Number.isInteger(payload.exp) || payload.exp <= now - 5 ||
      (payload.nbf !== undefined && payload.nbf > now + 5))
    throw fail("אימות ChatGPT נכשל");
  return { subject: payload.sub, email: typeof payload.email === "string" ? payload.email : null };
}

export function createAiAuth(store, { fetcher = fetch, callbackHost = "127.0.0.1" } = {}) {
  const { db } = store;
  const existingHost = db.prepare("SELECT value FROM ai_meta WHERE key='host_id'").get();
  const hostId = existingHost?.value || `urn:uuid:${randomUUID()}`;
  if (!existingHost) db.prepare("INSERT INTO ai_meta(key,value) VALUES('host_id',?)").run(hostId);
  const callbacks = new Map();
  const refreshing = new Map();
  const row = (userId) => db.prepare("SELECT * FROM ai_connections WHERE user_id=?").get(userId);
  const status = (userId) => {
    const connection = row(userId);
    return { connected: Boolean(connection?.credentials), email: connection?.email || null };
  };

  async function exchange(body) {
    const response = await fetcher(tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw fail(response.status === 400 || response.status === 401
      ? "יש להתחבר מחדש ל־ChatGPT" : "החיבור ל־ChatGPT נכשל. נסו שוב.",
    response.status === 400 || response.status === 401 ? 401 : 502);
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
      try {
        if (params.get("error")) throw fail("החיבור ל־ChatGPT בוטל");
        const issuedClient = previous?.client_id || params.get("client_id");
        if (!issuedClient || issuedClient === "dynamic_agent_client" ||
            (previous && params.get("client_id") && params.get("client_id") !== previous.client_id) ||
            !params.get("code")) throw fail("אישור ChatGPT לא הושלם");
        const tokens = await exchange({
          grant_type: "authorization_code",
          client_id: issuedClient,
          code: params.get("code"),
          code_verifier: verifier,
          redirect_uri: `http://${callbackHost}:${callback.address().port}${callbackPath}`,
          resource,
        });
        const identity = await verifyIdentity(tokens.id_token, issuedClient, nonce, fetcher);
        if (previous && identity.subject !== previous.subject)
          throw fail("נבחר חשבון ChatGPT אחר. נתקו את החיבור הקודם ונסו שוב.");
        if (!new Set(String(tokens.scope || "").split(" ")).has(requiredScope) ||
            typeof tokens.access_token !== "string" || typeof tokens.refresh_token !== "string")
          throw fail("יש לאשר שימוש בתוכנית ChatGPT כדי לשאול שאלות");
        if (cancelled) throw fail("בקשת החיבור בוטלה");
        const expiresAt = Date.now() + Math.max(60, Number(tokens.expires_in) || 3600) * 1000;
        db.prepare(`INSERT INTO ai_connections(user_id,client_id,subject,email,credentials,expires_at)
          VALUES(?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET client_id=excluded.client_id,
          subject=excluded.subject,email=excluded.email,credentials=excluded.credentials,expires_at=excluded.expires_at`)
          .run(userId, issuedClient, identity.subject, identity.email,
            store.encrypt({ accessToken: tokens.access_token, refreshToken: tokens.refresh_token, idToken: tokens.id_token }), expiresAt);
        res.writeHead(302, { Location: `${returnOrigin}/?ai=connected`, "Cache-Control": "no-store" }).end();
      } catch {
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
