// src/integrations/quickbooks/client.ts
import OAuthClient from "intuit-oauth";

export type QboEnv = "sandbox" | "production";

export type QboConnectionRow = {
  customer_id: string;
  realm_id: string;

  access_token: string;
  refresh_token: string;

  access_token_expires_at: string | null;
  refresh_token_expires_at: string | null;

  env?: QboEnv;
  updated_at?: string;
};

type QboAuthLike =
  | QboConnectionRow
  | {
      env?: QboEnv;
      realm_id?: string;
      realmId?: string;
      access_token?: string;
      accessToken?: string;
    };

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function oauthClient(env: QboEnv) {
  return new OAuthClient({
    clientId: requireEnv("INTUIT_CLIENT_ID"),
    clientSecret: requireEnv("INTUIT_CLIENT_SECRET"),
    environment: env,
    redirectUri: requireEnv("INTUIT_REDIRECT_URI"),
  });
}

function getQboApiBase(env: QboEnv) {
  return env === "sandbox"
    ? "https://sandbox-quickbooks.api.intuit.com"
    : "https://quickbooks.api.intuit.com";
}

function pickRealmId(conn: QboAuthLike): string {
  const realmId = (conn as any).realm_id ?? (conn as any).realmId;
  if (!realmId) throw new Error("Missing realm_id for QBO request");
  return realmId;
}

function normalizeToken(v: unknown, name: string): string {
  if (typeof v !== "string") {
    throw new Error(`${name} is not a string`);
  }
  const t = v.trim();
  if (t.length < 20) {
    throw new Error(`${name} looks malformed (len=${t.length})`);
  }
  return t;
}

/**
 * Ensures a valid access token.
 * If expired, refreshes it and persists rotated tokens via onTokenRefresh.
 */
export async function ensureFreshAccessToken(
  conn: QboConnectionRow,
  opts: {
    onTokenRefresh?: (update: {
      access_token: string;
      refresh_token: string;
      access_token_expires_at: string | null;
      refresh_token_expires_at: string | null;
    }) => Promise<void>;
    refreshSkewSeconds?: number;
  } = {}
): Promise<QboConnectionRow> {
  const env: QboEnv = conn.env ?? "sandbox";
  const skew = opts.refreshSkewSeconds ?? 120;

  if (!conn.access_token_expires_at) return conn;

  const accessExpMs = Date.parse(conn.access_token_expires_at);
  if (Number.isNaN(accessExpMs)) return conn;

  const secondsLeft = Math.floor((accessExpMs - Date.now()) / 1000);
  if (secondsLeft > skew) return conn;

  // ---- refresh required ----
  const access_token = normalizeToken(conn.access_token, "access_token");
  const refresh_token = normalizeToken(conn.refresh_token, "refresh_token");

  const oauth = oauthClient(env);

  // CRITICAL FIX:
  // The Intuit SDK can throw "Refresh token is invalid" if x_refresh_token_expires_in = 0.
  // Pass realistic "seconds remaining" based on our stored expiry timestamps.
  const refreshExpMs = conn.refresh_token_expires_at
    ? Date.parse(conn.refresh_token_expires_at)
    : NaN;

  const access_expires_in_seconds = Math.max(0, secondsLeft);

  const refresh_expires_in_seconds = Number.isFinite(refreshExpMs)
    ? Math.max(0, Math.floor((refreshExpMs - Date.now()) / 1000))
    : 60 * 60 * 24; // fallback 1 day if unknown

  oauth.setToken({
    token_type: "bearer",
    access_token,
    refresh_token,
    expires_in: access_expires_in_seconds,
    x_refresh_token_expires_in: refresh_expires_in_seconds,
  });

  const refreshed = await oauth.refresh();
  const j = refreshed.getJson();

  const new_access_token = normalizeToken(j.access_token, "new access_token");
  const new_refresh_token =
    typeof j.refresh_token === "string"
      ? normalizeToken(j.refresh_token, "new refresh_token")
      : refresh_token;

  const new_access_expires_in = Number(j.expires_in ?? 0);
  const new_refresh_expires_in = Number(j.x_refresh_token_expires_in ?? 0);

  const access_token_expires_at =
    new_access_expires_in > 0
      ? new Date(Date.now() + new_access_expires_in * 1000).toISOString()
      : null;

  const refresh_token_expires_at =
    new_refresh_expires_in > 0
      ? new Date(Date.now() + new_refresh_expires_in * 1000).toISOString()
      : conn.refresh_token_expires_at;

  if (opts.onTokenRefresh) {
    await opts.onTokenRefresh({
      access_token: new_access_token,
      refresh_token: new_refresh_token,
      access_token_expires_at,
      refresh_token_expires_at,
    });
  }

  return {
    ...conn,
    access_token: new_access_token,
    refresh_token: new_refresh_token,
    access_token_expires_at,
    refresh_token_expires_at,
  };
}

export async function qboQuery<T = any>(conn: QboAuthLike, query: string): Promise<T> {
  const env: QboEnv = (conn as any).env ?? "sandbox";
  const realmId = pickRealmId(conn);

  const access_token = (conn as any).access_token ?? (conn as any).accessToken;
  const token = normalizeToken(access_token, "access_token");

  const url =
    `${getQboApiBase(env)}/v3/company/${realmId}/query` +
    `?query=${encodeURIComponent(query)}` +
    `&minorversion=75`;

  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`QBO query failed (${r.status}): ${txt}`);
  }

  return (await r.json()) as T;
}

export async function fetchOverdueInvoices(conn: QboAuthLike) {
  const query =
    "select Id, DocNumber, CustomerRef, TotalAmt, Balance, DueDate, TxnDate " +
    "from Invoice where Balance > '0' and DueDate < CURRENT_DATE maxresults 100";

  type Resp = { QueryResponse?: { Invoice?: any[] } };

  const json = await qboQuery<Resp>(conn, query);
  return json?.QueryResponse?.Invoice ?? [];
}

/**
 * Invoices that are due to be sent (intent-based).
 *
 * NOTE:
 * QBO does NOT allow filtering on EmailStatus in the WHERE clause ("EmailStatus is not queryable").
 * So we fetch a safe superset and filter EmailStatus in application code.
 *
 * Superset criteria:
 * - TotalAmt > 0
 * - TxnDate < CURRENT_DATE (invoice date has already passed; "today" is still OK and should not alert)
 */
export async function fetchInvoicesDueToSend(conn: QboAuthLike) {
  const query =
    "select Id, DocNumber, CustomerRef, TotalAmt, Balance, DueDate, TxnDate, EmailStatus " +
    "from Invoice where TotalAmt > '0' and TxnDate < CURRENT_DATE maxresults 100";

  type Resp = { QueryResponse?: { Invoice?: any[] } };

  const json = await qboQuery<Resp>(conn, query);
  return json?.QueryResponse?.Invoice ?? [];
}
