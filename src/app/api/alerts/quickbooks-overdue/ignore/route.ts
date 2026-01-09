// src/app/api/alerts/quickbooks-overdue/ignore/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

type Body = {
  alertId: string;
  invoiceId: string;
  mode: "ignore" | "unignore";
};

function asStringArray(x: any): string[] {
  if (!Array.isArray(x)) return [];
  return x.map((v) => String(v)).filter(Boolean);
}

export async function POST(req: Request) {
  try {
    const supabase = await supabaseServer();
    const { data: userRes, error: userErr } = await supabase.auth.getUser();
    if (userErr) {
      return NextResponse.json({ ok: false, error: userErr.message }, { status: 401 });
    }
    if (!userRes.user) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as Partial<Body>;
    const alertId = String(body.alertId || "");
    const invoiceId = String(body.invoiceId || "");
    const mode = body.mode === "unignore" ? "unignore" : body.mode === "ignore" ? "ignore" : null;

    if (!alertId || !invoiceId || !mode) {
      return NextResponse.json(
        { ok: false, error: "Missing alertId, invoiceId, or mode" },
        { status: 400 }
      );
    }

    const admin = supabaseAdmin();

    // Resolve customer_id for this user (bypass RLS only after user auth passes)
    const { data: memberships, error: memErr } = await admin
      .from("customer_memberships")
      .select("customer_id")
      .eq("user_id", userRes.user.id);

    if (memErr) return NextResponse.json({ ok: false, error: memErr.message }, { status: 500 });
    if (!memberships || memberships.length !== 1) {
      return NextResponse.json({ ok: false, error: "No customer membership" }, { status: 400 });
    }

    const customerId = String((memberships[0] as any).customer_id);

    // Load the alert and validate ownership/type
    const { data: alert, error: alertErr } = await admin
      .from("alerts")
      .select("id, customer_id, type, context")
      .eq("id", alertId)
      .maybeSingle();

    if (alertErr) return NextResponse.json({ ok: false, error: alertErr.message }, { status: 500 });
    if (!alert) return NextResponse.json({ ok: false, error: "Alert not found" }, { status: 404 });

    if (String((alert as any).customer_id) !== customerId) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    if (String((alert as any).type) !== "qbo_overdue_invoice") {
      return NextResponse.json({ ok: false, error: "Wrong alert type" }, { status: 400 });
    }

    const ctx: any = (alert as any).context ?? {};
    const current = new Set<string>(asStringArray(ctx.ignoredInvoiceIds));

    if (mode === "ignore") current.add(invoiceId);
    if (mode === "unignore") current.delete(invoiceId);

    const nextContext = {
      ...ctx,
      ignoredInvoiceIds: Array.from(current),
      ignoredUpdatedAt: new Date().toISOString(),
    };

    const { error: updErr } = await admin
      .from("alerts")
      .update({ context: nextContext })
      .eq("id", alertId);

    if (updErr) return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 });

    return NextResponse.json({
      ok: true,
      alertId,
      invoiceId,
      ignored: mode === "ignore",
      ignoredInvoiceIds: Array.from(current),
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "error" }, { status: 500 });
  }
}
