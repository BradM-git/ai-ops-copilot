// src/app/api/debug/alerts/list/route.ts
import { NextResponse } from "next/server";
import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabaseServer";
import { getCurrentCustomerId } from "@/lib/currentCustomer";

export const dynamic = "force-dynamic";

function isDebugEnabled() {
  if (process.env.NODE_ENV === "development") return true;
  return process.env.DEBUG_FIXTURES_ENABLED === "true";
}

// Alpha scope: ONLY show Notion + QuickBooks alerts.
const ALPHA_ALLOWED_ALERT_TYPES = new Set<string>([
  "notion_stale",
  "qbo_overdue_invoice",
]);

export async function GET() {
  if (!isDebugEnabled()) notFound();

  let customerId: string | null = null;
  try {
    customerId = await getCurrentCustomerId();
  } catch {
    customerId = null;
  }
  if (!customerId) {
    return NextResponse.json(
      { ok: false, error: "no_customer" },
      { status: 401 }
    );
  }

  const supabase = await supabaseServer();

  const { data: alertsRaw, error } = await supabase
    .from("alerts")
    .select("id,customer_id,type,status,amount_at_risk,source_system,created_at")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }

  const alerts = (alertsRaw || [])
    .filter((a: any) => a.status === "open")
    .filter((a: any) => ALPHA_ALLOWED_ALERT_TYPES.has(String(a.type)))
    // belt + suspenders: never show stripe in alpha debug
    .filter((a: any) => String(a.source_system || "").toLowerCase() !== "stripe");

  return NextResponse.json({
    ok: true,
    customerId,
    alerts,
  });
}
