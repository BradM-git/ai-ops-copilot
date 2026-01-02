// src/app/api/debug/alerts/list/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabaseServer";

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

function ensureEnabled() {
  const enabled = process.env.DEBUG_FIXTURES_ENABLED === "true";
  if (process.env.NODE_ENV !== "development" && !enabled) return false;
  return true;
}

export async function GET() {
  if (!ensureEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Auth-gate ALL debug APIs (middleware skips /api)
  const supabase = await supabaseServer();
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = supabaseAdmin();

  // Resolve customer_id using admin (bypass RLS), but only after user auth passes.
  const { data: memberships, error: memErr } = await admin
    .from("customer_memberships")
    .select("customer_id")
    .eq("user_id", userRes.user.id);

  if (memErr) return NextResponse.json({ error: memErr.message }, { status: 500 });
  if (!memberships || memberships.length !== 1) {
    return NextResponse.json({ error: "No customer membership" }, { status: 400 });
  }

  const customerId = memberships[0].customer_id as string;

  // Pull a larger slice, then collapse to latest per (customer_id, type).
  const { data, error } = await admin
    .from("alerts")
    .select("id, customer_id, type, status, amount_at_risk, source_system, created_at")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as Array<{
    id: string;
    customer_id: string;
    type: string;
    status: string;
    amount_at_risk: number | null;
    source_system: string | null;
    created_at: string;
  }>;

  // Keep only the newest alert for each (customer_id, type)
  const seen = new Set<string>();
  const latest: typeof rows = [];

  for (const r of rows) {
    const key = `${r.customer_id}:${r.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    latest.push(r);
  }

  // ✅ Include customerId so the client debug page can toggle even when there are 0 alerts
  return NextResponse.json({ ok: true, customerId, alerts: latest });
}
