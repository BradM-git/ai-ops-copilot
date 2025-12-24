import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { HttpError, jsonErr, jsonOk, requireEnv } from "@/lib/api";

export const runtime = "nodejs";

function getSupabase() {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return createClient(url, key);
}

function getStripe() {
  const key = requireEnv("STRIPE_SECRET_KEY");
  // Do not hardcode apiVersion; keeps typings + Stripe account settings aligned
  return new Stripe(key);
}

async function listAllInvoices(stripe: Stripe, maxPages = 25) {
  const out: Stripe.Invoice[] = [];
  let starting_after: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const res = await stripe.invoices.list({ limit: 100, starting_after });
    out.push(...res.data);
    if (!res.has_more) break;
    starting_after = res.data[res.data.length - 1]?.id;
    if (!starting_after) break;
  }

  return out;
}

export async function GET() {
  try {
    const stripe = getStripe();
    const supabase = getSupabase();

    const { data: dbCustomers, error: cErr } = await supabase
      .from("customers")
      .select("id,stripe_customer_id");

    if (cErr) {
      throw new HttpError(500, "Supabase read customers failed", {
        code: "SUPABASE_READ_CUSTOMERS_FAILED",
        details: cErr,
      });
    }

    const map = new Map<string, string>();
    for (const c of dbCustomers ?? []) {
      map.set((c as any).stripe_customer_id, (c as any).id);
    }

    let invoices: Stripe.Invoice[];
    try {
      invoices = await listAllInvoices(stripe);
    } catch (e) {
      throw new HttpError(502, "Stripe invoices.list failed", {
        code: "STRIPE_LIST_INVOICES_FAILED",
        details: e,
      });
    }

    let upserted = 0;
    let skippedNoCustomer = 0;
    let skippedUnmappedCustomer = 0;

    for (const inv of invoices) {
      const stripeCustomerId =
        typeof inv.customer === "string" ? inv.customer : (inv.customer as any)?.id;

      if (!stripeCustomerId) {
        skippedNoCustomer++;
        continue;
      }

      const customer_id = map.get(stripeCustomerId);
      if (!customer_id) {
        skippedUnmappedCustomer++;
        continue;
      }

      const row = {
        stripe_invoice_id: inv.id,
        customer_id,
        amount_due: inv.amount_due ?? null,
        status: inv.status ?? null,
        invoice_date: inv.created ? new Date(inv.created * 1000).toISOString() : null,
        paid_at: inv.status_transitions?.paid_at
          ? new Date(inv.status_transitions.paid_at * 1000).toISOString()
          : null,
      };

      const { error } = await supabase.from("invoices").upsert(row, {
        onConflict: "stripe_invoice_id",
      });

      if (error) {
        throw new HttpError(500, "Supabase upsert invoices failed", {
          code: "SUPABASE_UPSERT_INVOICES_FAILED",
          details: { error, row },
        });
      }

      upserted++;
    }

    return jsonOk({
      synced: upserted,
      fetched: invoices.length,
      skippedNoCustomer,
      skippedUnmappedCustomer,
    });
  } catch (err) {
    return jsonErr(err);
  }
}
