import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

export async function GET() {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data: dbCustomers, error: cErr } = await supabase
    .from("customers")
    .select("id,stripe_customer_id");

  if (cErr) return Response.json({ error: cErr }, { status: 500 });

  const map = new Map<string, string>();
  for (const c of dbCustomers ?? []) map.set(c.stripe_customer_id, c.id);

  const invoices = await stripe.invoices.list({ limit: 25 });

  let synced = 0;
  for (const inv of invoices.data) {
    const stripeCustomerId =
      typeof inv.customer === "string" ? inv.customer : inv.customer?.id;
    if (!stripeCustomerId) continue;

    const customer_id = map.get(stripeCustomerId);
    if (!customer_id) continue;

    const { error } = await supabase.from("invoices").upsert({
      stripe_invoice_id: inv.id,
      customer_id,
      amount_due: inv.amount_due ?? null,
      status: inv.status ?? null,
      invoice_date: inv.created ? new Date(inv.created * 1000).toISOString() : null,
      paid_at: inv.status_transitions?.paid_at
        ? new Date(inv.status_transitions.paid_at * 1000).toISOString()
        : null,
    });

    if (!error) synced++;
  }

  return Response.json({ synced });
}
