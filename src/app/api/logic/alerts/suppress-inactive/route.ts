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

    // If customer is inactive, force-disable all alerts (but do not delete them)
    const { data: customers, error: custErr } = await supabase
      .from("customers")
      .select("id,is_active");

    if (custErr) return NextResponse.json({ error: custErr.message }, { status: 500 });

    const inactiveIds = (customers || []).filter((c) => c.is_active === false).map((c) => c.id);

    if (inactiveIds.length > 0) {
      const { error: updErr } = await supabase
        .from("alerts")
        .update({ is_enabled: false })
        .in("customer_id", inactiveIds);

      if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, inactive_count: inactiveIds.length });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "error" }, { status: 500 });
  }
}
