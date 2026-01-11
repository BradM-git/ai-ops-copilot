import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireCron } from "@/lib/api";
import {
  ensureFreshAccessToken,
  fetchOverdueInvoices,
  type QboConnectionRow,
} from "@/integrations/quickbooks/client";

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

function qboBaseHost(env: string | null | undefined) {
  // IMPORTANT: sandbox vs prod host determines whether Intuit finds the company.
  // This matches the "env":"sandbox" detail from your earlier debug output.
  return (env || "").toLowerCase() === "sandbox"
    ? "https://sandbox.qbo.intuit.com"
    : "https://app.qbo.intuit.com";
}

function qboInvoiceUrl(env: string | null | undefined, realmId: string, invoiceId: string) {
  const base = qboBaseHost(env);
  return `${base}/app/invoice?txnId=${encodeURIComponent(invoiceId)}&companyId=${encodeURIComponent(realmId)}`;
}

export async function GET(req: Request) {
  try {
    requireCron(req);

    const supabase = supabaseAdmin();

    // Keep the existing alert type key to avoid changing other code paths during this step.
    // Behavior changes: this type is now "pattern-based" (one alert per customer), not per invoice.
    const alertType = "qbo_overdue_invoice";
    const sourceSystem = "quickbooks";

    const { data: customers, error: custErr } = await supabase.from("customers").select("id");
    if (custErr) {
      return NextResponse.json(
        { ok: false, stage: "load_customers", error: custErr.message },
        { status: 500 }
      );
    }

    for (const c of customers || []) {
      const customerId = String((c as any).id);

      const { data: connRaw, error: connErr } = await supabase
        .from("qbo_connections")
        .select("*")
        .eq("customer_id", customerId)
        .maybeSingle();

      if (connErr) {
        return NextResponse.json(
          { ok: false, stage: "load_connection", error: connErr.message },
          { status: 500 }
        );
      }

      // Load any open alerts for this customer+type (could include legacy per-invoice alerts).
      const { data: openAlerts, error: openErr } = await supabase
        .from("alerts")
        .select("id,primary_entity_id")
        .eq("customer_id", customerId)
        .eq("type", alertType)
        .eq("status", "open");

      if (openErr) {
        return NextResponse.json(
          { ok: false, stage: "load_open_alerts", error: openErr.message },
          { status: 500 }
        );
      }

      const legacyPerInvoiceIds: string[] = [];
      let existingAggregatedId: string | null = null;

      for (const row of openAlerts || []) {
        const invId = row?.primary_entity_id ? String(row.primary_entity_id) : "";
        if (invId) legacyPerInvoiceIds.push(String(row.id));
        else existingAggregatedId = String(row.id);
      }

      // If no QBO connection, close any open alerts of this type.
      if (!connRaw) {
        if (openAlerts && openAlerts.length > 0) {
          const { error: closeErr } = await supabase
            .from("alerts")
            .update({ status: "closed" })
            .in(
              "id",
              openAlerts.map((r: any) => r.id)
            );

          if (closeErr) {
            return NextResponse.json(
              { ok: false, stage: "close_open_alerts_no_conn", error: closeErr.message },
              { status: 500 }
            );
          }
        }
        continue;
      }

      const conn = connRaw as QboConnectionRow;

      // Refresh token if needed and persist updates.
      const freshConn = await ensureFreshAccessToken(conn, {
        onTokenRefresh: async (u) => {
          const { error: updErr } = await supabase
            .from("qbo_connections")
            .update({
              access_token: u.access_token,
              refresh_token: u.refresh_token,
              access_token_expires_at: u.access_token_expires_at,
              refresh_token_expires_at: u.refresh_token_expires_at,
              updated_at: new Date().toISOString(),
            })
            .eq("customer_id", customerId);

          if (updErr) throw new Error(`Failed to persist refreshed QBO token: ${updErr.message}`);
        },
      });

      const realmId = String((freshConn as any).realm_id || "");
      const env = String((freshConn as any).env || "");

      if (!realmId) {
        return NextResponse.json(
          { ok: false, stage: "missing_realm_id", error: "qbo_connections.realm_id is missing" },
          { status: 500 }
        );
      }

      const invoicesRaw = await fetchOverdueInvoices(freshConn);

      const overdue = (invoicesRaw || [])
        .map((inv: any) => {
          const invoiceId = String(inv?.Id ?? "");
          const docNumber = inv?.DocNumber ?? null;
          const dueDate = inv?.DueDate ?? null;

          const balance = Number(inv?.Balance ?? 0);
          const balanceCents = Number.isFinite(balance) ? Math.round(balance * 100) : 0;

          if (!invoiceId || balanceCents <= 0) return null;

          const url = qboInvoiceUrl(env, realmId, invoiceId);

          return {
            invoiceId,
            docNumber,
            dueDate,
            balanceCents,
            url,
          };
        })
        .filter(Boolean) as Array<{
        invoiceId: string;
        docNumber: string | null;
        dueDate: string | null;
        balanceCents: number;
        url: string;
      }>;

      // If healthy, close any open alerts of this type (both aggregated and legacy per-invoice).
      if (overdue.length === 0) {
        const idsToClose = (openAlerts || []).map((r: any) => String(r.id));
        if (idsToClose.length > 0) {
          const { error: closeErr } = await supabase
            .from("alerts")
            .update({ status: "closed" })
            .in("id", idsToClose);

          if (closeErr) {
            return NextResponse.json(
              { ok: false, stage: "close_when_healthy", error: closeErr.message },
              { status: 500 }
            );
          }
        }
        continue;
      }

      // We are now pattern-based: close any legacy per-invoice open alerts.
      if (legacyPerInvoiceIds.length > 0) {
        const { error: closeLegacyPerInvErr } = await supabase
          .from("alerts")
          .update({ status: "closed" })
          .in("id", legacyPerInvoiceIds);

        if (closeLegacyPerInvErr) {
          return NextResponse.json(
            { ok: false, stage: "close_legacy_per_invoice", error: closeLegacyPerInvErr.message },
            { status: 500 }
          );
        }
      }

      const totalAtRiskCents = overdue.reduce((sum, x) => sum + (x.balanceCents || 0), 0);

      const worst = overdue
        .slice()
        .sort((a, b) => (b.balanceCents || 0) - (a.balanceCents || 0))[0];

      const baseUrl = qboBaseHost(env);

      const context = {
        source: "quickbooks",
        count: overdue.length,
        total_at_risk_cents: totalAtRiskCents,
        worst_invoice: worst
          ? {
              invoiceId: worst.invoiceId,
              docNumber: worst.docNumber ?? null,
              dueDate: worst.dueDate ?? null,
              balanceCents: worst.balanceCents,
              url: worst.url,
            }
          : null,
        invoices: overdue
          .slice()
          .sort((a, b) => (b.balanceCents || 0) - (a.balanceCents || 0))
          .slice(0, 25)
          .map((x) => ({
            invoiceId: x.invoiceId,
            docNumber: x.docNumber ?? null,
            dueDate: x.dueDate ?? null,
            balanceCents: x.balanceCents,
            url: x.url,
          })),
        url: baseUrl,
        computed_at: new Date().toISOString(),
      };

      const message =
        overdue.length === 1
          ? "1 overdue invoice in QuickBooks."
          : `${overdue.length} overdue invoices in QuickBooks.`;

      const payload: any = {
        customer_id: customerId,
        type: alertType,
        message,
        status: "open",
        amount_at_risk: totalAtRiskCents,
        source_system: sourceSystem,
        // Pattern-based: no single primary entity.
        primary_entity_type: "receivables",
        primary_entity_id: null,
        context,
        confidence: null,
        confidence_reason: null,
        expected_amount_cents: null,
        observed_amount_cents: null,
        expected_at: null,
        observed_at: null,
      };

      if (existingAggregatedId) {
        const { error: updErr } = await supabase.from("alerts").update(payload).eq("id", existingAggregatedId);
        if (updErr) {
          return NextResponse.json(
            { ok: false, stage: "update_aggregated_alert", error: updErr.message },
            { status: 500 }
          );
        }
      } else {
        const { error: insErr } = await supabase.from("alerts").insert(payload);
        if (insErr) {
          return NextResponse.json(
            { ok: false, stage: "insert_aggregated_alert", error: insErr.message },
            { status: 500 }
          );
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "error" }, { status: 500 });
  }
}
