// src/app/api/stripe/customers/route.ts
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
  return new Stripe(key, { apiVersion: "2024-06-20" });
}

async function listAllCustomers(stripe: Stripe, maxPages = 25) {
  const out: Stripe.Customer[] = [];
  let starting_after: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const res = await stripe.customers.list({ limit: 100, starting_after });
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

    let customers: Stripe.Customer[];
    try {
      customers = await listAllCustomers(stripe);
    } catch (e) {
      throw new HttpError(502, "Stripe customers.list failed", {
        code: "STRIPE_LIST_CUSTOMERS_FAILED",
        details: e,
      });
    }

    let upserted = 0;
    for (const c of customers) {
      const row = {
        stripe_customer_id: c.id,
        name: c.name ?? null,
        email: c.email ?? null,
      };

      const { error } = await supabase.from("customers").upsert(row, {
        onConflict: "stripe_customer_id",
      });

      if (error) {
        throw new HttpError(500, "Supabase upsert customers failed", {
          code: "SUPABASE_UPSERT_CUSTOMERS_FAILED",
          details: { error, row },
        });
      }

      upserted++;
    }

    return jsonOk({ synced: upserted, fetched: customers.length });
  } catch (err) {
    return jsonErr(err);
  }
}
