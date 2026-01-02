// src/app/api/alerts/close/route.ts
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getCurrentCustomerId } from "@/lib/currentCustomer";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const alertId = body?.alertId;

    if (!alertId || typeof alertId !== "string") {
      return NextResponse.json({ error: "Missing alertId" }, { status: 400 });
    }

    const supabase = await supabaseServer();

    const { data: userRes, error: userErr } = await supabase.auth.getUser();
    if (userErr) return NextResponse.json({ error: userErr.message }, { status: 401 });
    if (!userRes.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    let customerId: string;
    try {
      customerId = await getCurrentCustomerId();
    } catch {
      return NextResponse.json({ error: "No customer membership" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("alerts")
      .update({ status: "closed" })
      .eq("id", alertId)
      .eq("customer_id", customerId)
      .select("id, status")
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Alert not found" }, { status: 404 });

    return NextResponse.json({ ok: true, alert: data });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}
