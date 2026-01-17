import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireCron } from "@/lib/api";

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

export async function GET(req: Request) {
  try {
    requireCron(req);

    const supabase = supabaseAdmin();

    // Find inactive customers
    const { data: customers, error: custErr } = await supabase
      .from("customers")
      .select("id,is_active");

    if (custErr) {
      return NextResponse.json({ ok: false, error: custErr.message }, { status: 500 });
    }

    const inactiveIds = (customers || [])
      .filter((c: any) => c.is_active === false)
      .map((c: any) => c.id);

    if (inactiveIds.length === 0) {
      return NextResponse.json({ ok: true, inactive_count: 0 });
    }

    // Close (do not delete) any open alerts for inactive customers
    const { error: updErr } = await supabase
      .from("alerts")
      .update({ status: "closed" })
      .in("customer_id", inactiveIds)
      .eq("status", "open");

    if (updErr) {
      return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, inactive_count: inactiveIds.length });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "error" }, { status: 500 });
  }
}
