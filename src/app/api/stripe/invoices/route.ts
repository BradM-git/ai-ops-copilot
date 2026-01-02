import { NextResponse } from "next/server";
import Stripe from "stripe";
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

    const stripeKey = process.env.STRIPE_SECRET_KEY!;
    const stripe = new Stripe(stripeKey); // <-- remove apiVersion to match installed typings

    const invoices = await stripe.invoices.list({ limit: 100 });

    const supabase = supabaseAdmin();

    // Persist minimal invoice fields
    for (const inv of invoices.data) {
      const row = {
        id: inv.id,
        customer_id: typeof inv.customer === "string" ? inv.customer : inv.customer?.id ?? null,
        status: inv.status ?? null,
        amount_due_cents: inv.amount_due ?? 0,
        amount_paid_cents: inv.amount_paid ?? 0,
        due_date: inv.due_date ? new Date(inv.due_date * 1000).toISOString() : null,
      };

      const { error } = await supabase.from("stripe_invoices").upsert(row, { onConflict: "id" });
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, count: invoices.data.length });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "error" }, { status: 500 });
  }
}
