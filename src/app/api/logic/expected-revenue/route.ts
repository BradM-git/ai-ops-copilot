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

    // Placeholder logic: compute expected revenue from invoices/customers
    const { data, error } = await supabase
      .from("stripe_invoices")
      .select("amount_due_cents,status");

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const open = (data || []).filter((i) => i.status === "open");
    const total = open.reduce((sum, i) => sum + (i.amount_due_cents ?? 0), 0);

    return NextResponse.json({ ok: true, expected_revenue_cents: total, open_count: open.length });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "error" }, { status: 500 });
  }
}
