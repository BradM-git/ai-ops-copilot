import { createClient } from "@supabase/supabase-js";

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data: exp } = await supabase
    .from("expected_revenue")
    .select("customer_id,cadence_days,expected_amount,last_paid_at,confidence");

  if (!exp?.length) return Response.json({ message: "no expected_revenue" });

  const now = Date.now();
  let created = 0;

  for (const e of exp) {
    const last = e.last_paid_at ? new Date(e.last_paid_at).getTime() : null;
    if (!last) continue;

    const dueAt = last + (e.cadence_days ?? 30) * 24 * 60 * 60 * 1000;

    // only alert if overdue by 3+ days (reduces noise)
    if (now < dueAt + 3 * 24 * 60 * 60 * 1000) continue;

    // if there is a paid invoice after last_paid_at, skip
    const { data: newerPaid } = await supabase
      .from("invoices")
      .select("id")
      .eq("customer_id", e.customer_id)
      .not("paid_at", "is", null)
      .gt("paid_at", e.last_paid_at)
      .limit(1);

    if (newerPaid && newerPaid.length > 0) continue;

    // create alert (idempotent-ish: avoid duplicates)
    const msg = `Likely missed payment: last paid ${new Date(last).toISOString().slice(0, 10)}. Expected every ${(e.cadence_days ?? 30)} days.`;

    const { data: existing } = await supabase
      .from("alerts")
      .select("id")
      .eq("customer_id", e.customer_id)
      .eq("type", "missed_expected_payment")
      .eq("status", "open")
      .limit(1);

    if (existing && existing.length > 0) continue;

    await supabase.from("alerts").insert({
      customer_id: e.customer_id,
      type: "missed_expected_payment",
      message: msg,
      amount_at_risk: e.expected_amount ?? null,
      status: "open",
    });

    created++;
  }

  return Response.json({ alerts_created: created });
}
