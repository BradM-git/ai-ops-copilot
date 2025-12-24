import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

export async function GET() {
  const stripeKey = process.env.STRIPE_SECRET_KEY!;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  const stripe = new Stripe(stripeKey);
  const supabase = createClient(supabaseUrl, supabaseKey);

  const customers = await stripe.customers.list({ limit: 10 });

  for (const c of customers.data) {
    await supabase.from("customers").upsert({
      stripe_customer_id: c.id,
      name: c.name,
      email: c.email,
    });
  }

  return Response.json({
    synced: customers.data.length,
  });
}
