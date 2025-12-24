import { createClient } from "@supabase/supabase-js";

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // get last paid invoice per customer
  const { data: invoices } = await supabase
    .from("invoices")
    .select("customer_id, amount_due, paid_at")
    .not("paid_at", "is", null)
    .order("paid_at", { ascending: false });

  if (!invoices || invoices.length === 0)
    return Response.json({ message: "no paid invoices" });

  const seen = new Set<string>();
  let created = 0;

  for (const inv of invoices) {
    if (seen.has(inv.customer_id)) continue;
    seen.add(inv.customer_id);

    await supabase.from("expected_revenue").upsert({
      customer_id: inv.customer_id,
      cadence_days: 30,               // MVP assumption
      expected_amount: inv.amount_due,
      last_paid_at: inv.paid_at,
      confidence: 0.9,
    });

    created++;
  }

  return Response.json({ expected_created: created });
}
