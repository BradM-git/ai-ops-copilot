// src/app/api/integrations/quickbooks/test/overdue/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCurrentCustomerId } from "@/lib/currentCustomer";
import {
  ensureFreshAccessToken,
  fetchOverdueInvoices,
  type QboConnectionRow,
} from "@/integrations/quickbooks/client";

export const dynamic = "force-dynamic";

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

function shape(v: unknown) {
  if (v == null) return { type: String(v) };
  if (typeof v === "string") return { type: "string", length: v.length };
  if (typeof v === "object")
    return { type: "object", keys: Object.keys(v as any).slice(0, 20) };
  return { type: typeof v };
}

function shouldIncludeDebug(url: URL) {
  // Only include token shape metadata in development, and only if explicitly enabled.
  if (process.env.NODE_ENV !== "development") return false;

  // Either a query param (?debug=1) or your existing debug flag
  if (url.searchParams.get("debug") === "1") return true;
  if (process.env.DEBUG_FIXTURES_ENABLED === "true") return true;

  return false;
}

function isReconnectRequiredError(msg: string) {
  // Intuit library message
  if (msg.includes("The Refresh token is invalid")) return true;
  if (msg.includes("please Authorize again")) return true;

  return false;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const includeDebug = shouldIncludeDebug(url);

    // Preferred: cookie-auth
    let customerId: string | null = null;
    try {
      customerId = await getCurrentCustomerId();
    } catch {
      customerId = null;
    }

    // Dev escape hatch
    if (!customerId && process.env.NODE_ENV === "development") {
      const fromQuery = url.searchParams.get("customerId");
      if (fromQuery) customerId = fromQuery;
    }

    if (!customerId) {
      return NextResponse.json(
        { ok: false, error: "not_authenticated" },
        { status: 401 }
      );
    }

    const supabase = supabaseAdmin();

    const { data: connRaw, error: connErr } = await supabase
      .from("qbo_connections")
      .select("*")
      .eq("customer_id", customerId)
      .maybeSingle();

    if (connErr) {
      return NextResponse.json(
        { ok: false, stage: "load_connection", error: connErr.message },
        { status: 500 }
      );
    }

    if (!connRaw) {
      return NextResponse.json(
        { ok: false, stage: "load_connection", error: "no_qbo_connection" },
        { status: 400 }
      );
    }

    const conn = connRaw as QboConnectionRow;

    const connShape = {
      env: (conn as any).env ?? null,
      realm_id: shape((conn as any).realm_id),
      access_token: shape((conn as any).access_token),
      refresh_token: shape((conn as any).refresh_token),
      access_token_expires_at: shape((conn as any).access_token_expires_at),
      refresh_token_expires_at: shape((conn as any).refresh_token_expires_at),
      updated_at: shape((conn as any).updated_at),
    };

    // If token is an object, stop here and report shape (no secrets).
    if (
      typeof (conn as any).access_token === "object" &&
      (conn as any).access_token
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: "access_token_is_object",
          ...(includeDebug ? { connShape } : {}),
          hint:
            "Your qbo_connections.access_token is an object. Fix the QBO callback/upsert to store raw string tokens.",
        },
        { status: 500 }
      );
    }

    const refreshedConn = await ensureFreshAccessToken(conn, {
      onTokenRefresh: async (update) => {
        await supabase
          .from("qbo_connections")
          .update({ ...update, updated_at: new Date().toISOString() })
          .eq("customer_id", customerId);
      },
    });

    const overdue = await fetchOverdueInvoices(refreshedConn);

    return NextResponse.json({
      ok: true,
      ...(includeDebug ? { connShape } : {}),
      count: overdue.length,
      invoices: overdue.slice(0, 10),
    });
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    console.error("[qbo test overdue] error:", err);

    // Important: return a stable code the UI can use to show a single reconnect CTA
    if (isReconnectRequiredError(msg)) {
      return NextResponse.json(
        { ok: false, code: "QBO_RECONNECT_REQUIRED", error: msg },
        { status: 401 }
      );
    }

    return NextResponse.json(
      { ok: false, stage: "uncaught", error: msg },
      { status: 500 }
    );
  }
}
