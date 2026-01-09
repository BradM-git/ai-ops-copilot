// src/app/api/integrations/quickbooks/callback/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getIntuitOAuthClient } from "@/integrations/quickbooks/oauth";

export const dynamic = "force-dynamic";

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const realmId = url.searchParams.get("realmId");
    const stateRaw = url.searchParams.get("state");

    if (!code || !realmId || !stateRaw) {
      return NextResponse.redirect(new URL("/login?quickbooks=missing_params", url.origin));
    }

    let state: any = {};
    try {
      state = JSON.parse(decodeURIComponent(stateRaw));
    } catch {
      // allow plain JSON as well
      state = JSON.parse(stateRaw);
    }

    const customerId = String(state?.customerId || "");
    if (!customerId) {
      return NextResponse.redirect(new URL("/login?quickbooks=missing_customer", url.origin));
    }

    const oauth = getIntuitOAuthClient();

    // IMPORTANT: exchange code for tokens
    // intuit-oauth expects the *full callback URL* (including code/realmId/state)
    const tokenResp = await oauth.createToken(req.url);
    const j = tokenResp.getJson();

    const shape = (v: unknown) => {
  if (v == null) return { type: String(v) };
  if (typeof v === "string") return { type: "string", length: v.length };
  if (typeof v === "object") return { type: "object", keys: Object.keys(v as any).slice(0, 20) };
  return { type: typeof v };
};

console.log("[qbo callback] tokenResp shape:", {
  access_token: shape((j as any).access_token),
  refresh_token: shape((j as any).refresh_token),
  expires_in: shape((j as any).expires_in),
  x_refresh_token_expires_in: shape((j as any).x_refresh_token_expires_in),
});


    function mustToken(name: string, v: unknown) {
  if (typeof v !== "string") throw new Error(`${name} is not a string`);
  const t = v.trim();
  // Access tokens are usually ~600; refresh tokens should also be "long opaque strings".
  // Your observed refresh_token length ~41 is definitely wrong.
  if (t.length < 20) throw new Error(`${name} looks malformed (len=${t.length})`);
  return t;
  }

    const access_token = mustToken("access_token", (j as any).access_token);
    const refresh_token = mustToken("refresh_token", (j as any).refresh_token);
    const access_expires_in = Number(j.expires_in ?? 0); // seconds
    const refresh_expires_in = Number(j.x_refresh_token_expires_in ?? 0); // seconds

    if (!access_token || !refresh_token) {
      return NextResponse.redirect(new URL("/login?quickbooks=token_exchange_failed", url.origin));
    }

    const now = Date.now();
    const access_token_expires_at = new Date(now + access_expires_in * 1000).toISOString();
    const refresh_token_expires_at = new Date(now + refresh_expires_in * 1000).toISOString();

    const supabase = supabaseAdmin();

    // NOTE: adjust table/column names if yours differ
    const { error } = await supabase.from("qbo_connections").upsert(
      {
        customer_id: customerId,
        realm_id: String(realmId),
        access_token,
        refresh_token,
        access_token_expires_at,
        refresh_token_expires_at,
        env: (process.env.INTUIT_ENV ?? "sandbox"),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "customer_id" }
    );

    if (error) {
      console.error("[qbo callback] upsert error:", error);
      return NextResponse.redirect(new URL("/?quickbooks=save_failed", url.origin));
    }

    return NextResponse.redirect(new URL("/?quickbooks=connected", url.origin));
  } catch (e: any) {
    console.error("[qbo callback] error:", e);
    const origin = new URL(req.url).origin;
    return NextResponse.redirect(new URL("/?quickbooks=callback_error", origin));
  }
}
