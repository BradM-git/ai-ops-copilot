import Stripe from "stripe";
import { requireEnv } from "@/lib/api";

export function getStripe() {
  const key = requireEnv("STRIPE_SECRET_KEY");
  // Do not hardcode apiVersion; keeps typings + Stripe account settings aligned
  return new Stripe(key);
}

export async function listAllInvoices(stripe: Stripe, maxPages = 25) {
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
