// src/app/api/logic/expected-revenue/route.ts
import { createClient } from "@supabase/supabase-js";
import { HttpError, jsonErr, jsonOk, requireEnv } from "@/lib/api";

export const runtime = "nodejs";

function getSupabase() {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return createClient(url, key);
}

export async function GET() {
  try {
    const supabase = getSupabase();

    const { data: invoices, error: invErr } = await supabase
      .from("invoices")
      .select("customer_id, amount_due, paid_at")
      .not("paid_at", "is", null)
      .order("paid_at", { ascending: false })
      .limit(5000);

    if (invErr) {
      throw new HttpError(500, "Supabase read invoices failed", {
        code: "SUPABASE_READ_INVOICES_FAILED",
        details: invErr,
      });
    }

    if (!invoices || invoices.length === 0) {
      return jsonOk({ expected_created: 0, message: "no paid invoices" });
    }

    const seen = new Set<string>();
    let created = 0;

    for (const inv of invoices as any[]) {
      if (!inv.customer_id) continue;
      if (seen.has(inv.customer_id)) continue;
      seen.add(inv.customer_id);

      const row = {
        customer_id: inv.customer_id,
        cadence_days: 30, // MVP assumption
        expected_amount: inv.amount_due ?? null,
        last_paid_at: inv.paid_at ?? null,
        confidence: 0.9,
      };

      const { error } = await supabase.from("expected_revenue").upsert(row, {
        onConflict: "customer_id",
      });

      if (error) {
        throw new HttpError(500, "Supabase upsert expected_revenue failed", {
          code: "SUPABASE_UPSERT_EXPECTED_REVENUE_FAILED",
          details: { error, row },
        });
      }

      created++;
    }

    return jsonOk({ expected_created: created });
  } catch (err) {
    return jsonErr(err);
  }
}
