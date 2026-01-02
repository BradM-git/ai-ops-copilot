import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireCron } from "@/lib/api";

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

export async function GET(req: Request) {
  try {
    requireCron(req);

    const supabase = supabaseAdmin();

    const { data: customers, error: custErr } = await supabase
      .from("customers")
      .select("id,name,is_active");

    if (custErr) return NextResponse.json({ error: custErr.message }, { status: 500 });

    const activeCustomers = (customers || []).filter((c) => c.is_active !== false);

    for (const c of activeCustomers) {
      // Notion items older than 14 days (example heuristic)
      const staleDays = 14;

      const { data: rows, error: rowsErr } = await supabase
        .from("notion_pages")
        .select("id,customer_id,title,last_edited_time,url")
        .eq("customer_id", c.id);

      if (rowsErr) return NextResponse.json({ error: rowsErr.message }, { status: 500 });

      const now = new Date();
      const stale = (rows || []).filter((r) => {
        const t = r.last_edited_time ? new Date(r.last_edited_time) : null;
        if (!t) return true;
        const ageDays = Math.floor((now.getTime() - t.getTime()) / (1000 * 60 * 60 * 24));
        return ageDays >= staleDays;
      });

      const title = "Stale Notion items";
      const description =
        stale.length === 0
          ? "No stale Notion items detected."
          : `${stale.length} Notion item(s) appear stale (not edited in ${staleDays}+ days).`;

      const actions =
        stale.length === 0
          ? []
          : stale.slice(0, 10).map((r) => ({
              label: r.title ? `Open: ${r.title}` : `Open item ${String(r.id).slice(0, 6)}…`,
              url: r.url || "https://www.notion.so/",
            }));

      const payload = {
        customer_id: c.id,
        type: "notion_stale",
        provider: "notion",
        title,
        description,
        status: stale.length === 0 ? "ok" : "issue",
        severity: stale.length === 0 ? "info" : "low",
        count: stale.length,
        actions,
        last_run_at: new Date().toISOString(),
      };

      const { data: existing, error: existErr } = await supabase
        .from("alerts")
        .select("id")
        .eq("customer_id", c.id)
        .eq("type", "notion_stale")
        .maybeSingle();

      if (existErr) return NextResponse.json({ error: existErr.message }, { status: 500 });

      if (existing?.id) {
        const { error: updErr } = await supabase.from("alerts").update(payload).eq("id", existing.id);
        if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
      } else {
        const { error: insErr } = await supabase.from("alerts").insert(payload);
        if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "error" }, { status: 500 });
  }
}
