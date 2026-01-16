import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireCron } from "@/lib/api";
import { getNotionStaleActivitySummary } from "@/integrations/notion/staleActivity";

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

export async function GET(req: Request) {
  try {
    requireCron(req);

    const supabase = supabaseAdmin();

    // Only run for active customers.
    const { data: customers, error: custErr } = await supabase
      .from("customers")
      .select("id")
      .eq("is_active", true);

    if (custErr) {
      return NextResponse.json(
        { ok: false, stage: "load_customers", error: custErr.message },
        { status: 500 }
      );
    }

    const alertType = "notion_stale_activity";
    const sourceSystem = "notion";

    // Reads Notion live using NOTION_DB_MAIN.
    const summary = await getNotionStaleActivitySummary();

    const total = Number(summary?.total ?? 0);
    const nowIso = new Date().toISOString();

    const context = {
      source: "notion",
      total,
      data: summary,
      computed_at: nowIso,
    };

    const message =
      total === 0
        ? "No stale Notion items detected."
        : `${total} Notion items may be stale (no recent edits).`;

    const nextStatus = total === 0 ? "closed" : "open";

    for (const c of customers || []) {
      const customerId = String((c as any).id);

      if (nextStatus === "closed") {
        // Close any open alert if healthy
        const { data: openRows, error: openErr } = await supabase
          .from("alerts")
          .select("id")
          .eq("customer_id", customerId)
          .eq("type", alertType)
          .eq("status", "open");

        if (openErr) {
          return NextResponse.json(
            { ok: false, stage: "load_open_alerts", error: openErr.message },
            { status: 500 }
          );
        }

        if (openRows && openRows.length > 0) {
          const { error: closeErr } = await supabase
            .from("alerts")
            .update({ status: "closed" })
            .in(
              "id",
              openRows.map((r: any) => r.id)
            );

          if (closeErr) {
            return NextResponse.json(
              { ok: false, stage: "close_open_alerts", error: closeErr.message },
              { status: 500 }
            );
          }
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

      if (existErr) {
        return NextResponse.json(
          { ok: false, stage: "load_existing_open", error: existErr.message },
          { status: 500 }
        );
      }

      const payload: any = {
        customer_id: customerId,
        type: alertType,
        message,
        status: "open",
        amount_at_risk: null,
        source_system: sourceSystem,
        primary_entity_type: "customer",
        primary_entity_id: customerId,
        context,
        confidence: "medium",
        confidence_reason: "items have not been edited within the stale threshold window",
        expected_amount_cents: null,
        observed_amount_cents: null,
        expected_at: null,
        observed_at: nowIso,
      };

      if (existing?.id) {
        const { error: updErr } = await supabase.from("alerts").update(payload).eq("id", existing.id);
        if (updErr) {
          return NextResponse.json(
            { ok: false, stage: "update_alert", error: updErr.message },
            { status: 500 }
          );
        }
      } else {
        const { error: insErr } = await supabase.from("alerts").insert(payload);
        if (insErr) {
          return NextResponse.json(
            { ok: false, stage: "insert_alert", error: insErr.message },
            { status: 500 }
          );
        }
      }
    }

    return NextResponse.json({ ok: true, total });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "error" }, { status: 500 });
  }
}
