import { NextResponse } from "next/server";
import Stripe from "stripe";
import { requireCron } from "@/lib/api";

export async function GET(req: Request) {
  try {
    requireCron(req);

    const stripeKey = process.env.STRIPE_SECRET_KEY!;
    const stripe = new Stripe(stripeKey); // <-- remove apiVersion to match installed typings

    const customers = await stripe.customers.list({ limit: 100 });

    return NextResponse.json({ ok: true, customers: customers.data });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "error" }, { status: 500 });
  }
}
