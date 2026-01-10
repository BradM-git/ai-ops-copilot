import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireCron } from "@/lib/api";

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

function daysBetween(a: Date, b: Date) {
  const ms = a.getTime() - b.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

export async function GET(req: Request) {
  try {
    requireCron(req);

    const supabase = supabaseAdmin();

    // All customers (alpha-style). If you later add "is_active" or "integrations enabled",
    // filter here — but keep this route deterministic and defensive.
    const { data: customers, error: custErr } = await supabase.from("customers").select("id");
    if (custErr) return NextResponse.json({ error: custErr.message }, { status: 500 });

    const staleThresholdDays = 14;
    const alertType = "notion_stale";
    const sourceSystem = "notion";

    for (const c of customers || []) {
      const customerId = String((c as any).id);

      const { data: rows, error: rowsErr } = await supabase
        .from("notion_pages")
        .select("id,customer_id,title,last_edited_time,url")
        .eq("customer_id", customerId);

      if (rowsErr) return NextResponse.json({ error: rowsErr.message }, { status: 500 });

      const now = new Date();

      const withAge = (rows || []).map((r: any) => {
        const t = r.last_edited_time ? new Date(r.last_edited_time) : null;
        const ageDays = t ? daysBetween(now, t) : null;
        return { ...r, ageDays };
      });

      const stale = withAge.filter((r: any) => r.ageDays == null || r.ageDays >= staleThresholdDays);

      // Domain clocks for scoring + explainability
      const maxStaleDays =
        stale.length === 0
          ? 0
          : Math.max(...stale.map((r: any) => (typeof r.ageDays === "number" ? r.ageDays : staleThresholdDays)));

      const lastActivityAt = (() => {
        // Most recent edit across ALL pages (not only stale) — helps interpret "how dead is the workspace".
        const edits = withAge
          .map((r: any) => (typeof r.last_edited_time === "string" ? r.last_edited_time : null))
          .filter(Boolean) as string[];
        if (edits.length === 0) return null;
        edits.sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
        return edits[0];
      })();

      const context = {
        stale_threshold_days: staleThresholdDays,
        count: stale.length,
        max_stale_days: maxStaleDays,
        last_activity_at: lastActivityAt,
        // Keep payload small; sample top 10 stalest.
        items: stale
          .slice()
          .sort((a: any, b: any) => Number(b.ageDays ?? 0) - Number(a.ageDays ?? 0))
          .slice(0, 10)
          .map((r: any) => ({
            pageId: String(r.id),
            title: r.title ?? null,
            url: r.url ?? null,
            lastEditedAt: r.last_edited_time ?? null,
            staleDays: typeof r.ageDays === "number" ? r.ageDays : null,
          })),
        computed_at: new Date().toISOString(),
      };

      const message =
        stale.length === 0
          ? "No stale Notion items detected."
          : `${stale.length} Notion item${stale.length === 1 ? "" : "s"} stale (≥ ${staleThresholdDays}d).`;

      const nextStatus = stale.length === 0 ? "closed" : "open";

      // Close any open alert if healthy
      if (nextStatus === "closed") {
        const { data: openRows, error: openErr } = await supabase
          .from("alerts")
          .select("id")
          .eq("customer_id", customerId)
          .eq("type", alertType)
          .eq("status", "open");

        if (openErr) return NextResponse.json({ error: openErr.message }, { status: 500 });

        if (openRows && openRows.length > 0) {
          const { error: closeErr } = await supabase
            .from("alerts")
            .update({ status: "closed" })
            .in(
              "id",
              openRows.map((r: any) => r.id)
            );
          if (closeErr) return NextResponse.json({ error: closeErr.message }, { status: 500 });
        }

        continue;
      }

      // Upsert a single open alert row (idempotent per customer+type)
      const { data: existing, error: existErr } = await supabase
        .from("alerts")
        .select("id")
        .eq("customer_id", customerId)
        .eq("type", alertType)
        .eq("status", "open")
        .maybeSingle();

      if (existErr) return NextResponse.json({ error: existErr.message }, { status: 500 });

      const payload: any = {
        customer_id: customerId,
        type: alertType,
        message,
        status: "open",
        amount_at_risk: null,
        source_system: sourceSystem,
        primary_entity_type: "notion_page",
        primary_entity_id: null,
        context,
        confidence: null,
        confidence_reason: null,
        expected_amount_cents: null,
        observed_amount_cents: null,
        expected_at: null,
        observed_at: null,
      };

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
