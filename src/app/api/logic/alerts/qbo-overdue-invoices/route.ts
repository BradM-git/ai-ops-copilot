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

    const alertType = "qbo_overdue_invoice";
    const sourceSystem = "quickbooks";

    const { data: customers, error: custErr } = await supabase
      .from("customers")
      .select("id");
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

      const openByInvoiceId = new Map<string, { id: string }>();
      const legacyAggregatedIds: string[] = [];

      for (const row of openAlerts || []) {
        const invId = row?.primary_entity_id ? String(row.primary_entity_id) : "";
        if (invId) openByInvoiceId.set(invId, { id: String(row.id) });
        else legacyAggregatedIds.push(String(row.id));
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

      // Close legacy aggregated alert(s)
      if (legacyAggregatedIds.length > 0) {
        const { error: closeLegacyErr } = await supabase
          .from("alerts")
          .update({ status: "closed" })
          .in("id", legacyAggregatedIds);

        if (closeLegacyErr) {
          return NextResponse.json(
            { ok: false, stage: "close_legacy_aggregated", error: closeLegacyErr.message },
            { status: 500 }
          );
        }
      }

      // If healthy, close any open per-invoice alerts.
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

      // Close stale invoice alerts (no longer overdue)
      const currentInvoiceIds = new Set(overdue.map((x) => x.invoiceId));
      const openInvoiceIds = new Set(openByInvoiceId.keys());

      const staleToClose: string[] = [];
      for (const invId of openInvoiceIds) {
        if (!currentInvoiceIds.has(invId)) {
          const row = openByInvoiceId.get(invId);
          if (row?.id) staleToClose.push(row.id);
        }
      }

      if (staleToClose.length > 0) {
        const { error: closeStaleErr } = await supabase
          .from("alerts")
          .update({ status: "closed" })
          .in("id", staleToClose);

        if (closeStaleErr) {
          return NextResponse.json(
            { ok: false, stage: "close_stale_invoice_alerts", error: closeStaleErr.message },
            { status: 500 }
          );
        }
      }

      // Upsert each overdue invoice alert
      for (const inv0 of overdue) {
        const invoiceId = inv0.invoiceId;

        const payload: any = {
          customer_id: customerId,
          type: alertType,
          message: `Overdue invoice in QuickBooks (${inv0.docNumber || invoiceId}).`,
          status: "open",
          amount_at_risk: inv0.balanceCents,
          source_system: sourceSystem,
          primary_entity_type: "invoice",
          primary_entity_id: invoiceId,
          context: {
            invoice: inv0,
            url: inv0.url,
            computed_at: new Date().toISOString(),
          },
          confidence: null,
          confidence_reason: null,
          expected_amount_cents: null,
          observed_amount_cents: null,
          expected_at: null,
          observed_at: null,
        };

        const existing = openByInvoiceId.get(invoiceId);
        if (existing?.id) {
          const { error: updErr } = await supabase.from("alerts").update(payload).eq("id", existing.id);
          if (updErr) {
            return NextResponse.json(
              { ok: false, stage: "update_invoice_alert", invoiceId, error: updErr.message },
              { status: 500 }
            );
          }
        } else {
          const { error: insErr } = await supabase.from("alerts").insert(payload);
          if (insErr) {
            return NextResponse.json(
              { ok: false, stage: "insert_invoice_alert", invoiceId, error: insErr.message },
              { status: 500 }
            );
          }
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "error" }, { status: 500 });
  }
}
