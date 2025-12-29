// src/app/api/debug/toggles/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

function ensureEnabled() {
  const enabled = process.env.DEBUG_FIXTURES_ENABLED === "true";
  if (process.env.NODE_ENV !== "development" && !enabled) return false;
  return true;
}

function isoDaysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

// Toggle key names are stable, source-agnostic identifiers.
// In the debug UI we’ll compute key from alert.type.
type ToggleKey =
  | "stripe.missed_expected_payment"
  | "stripe.payment_amount_drift"
  | "jira.no_recent_client_activity";

export async function POST(req: Request) {
  if (!ensureEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const admin = supabaseAdmin();

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const enabled = Boolean(body?.enabled);
  const key = String(body?.key || "") as ToggleKey;
  const alertId = body?.alertId ? String(body.alertId) : null;
  const targetId = body?.targetId ? String(body.targetId) : null;

  if (!key) return NextResponse.json({ error: "Missing key" }, { status: 400 });

  // If alertId provided, use it to derive targetId (customer_id) + validate type
  let resolvedTargetId = targetId;

  if (alertId) {
    const { data: aRow, error: aErr } = await admin
      .from("alerts")
      .select("id, customer_id, type")
      .eq("id", alertId)
      .maybeSingle();

    if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 });
    if (!aRow) return NextResponse.json({ error: "Alert not found" }, { status: 404 });

    resolvedTargetId = aRow.customer_id ?? null;

    // Basic safety: ensure the key matches the alert.type we’re toggling
    if (key === "stripe.missed_expected_payment" && aRow.type !== "missed_expected_payment") {
      return NextResponse.json({ error: `Key ${key} does not match alert.type ${aRow.type}` }, { status: 400 });
    }

    if (key === "stripe.payment_amount_drift" && aRow.type !== "payment_amount_drift") {
      return NextResponse.json({ error: `Key ${key} does not match alert.type ${aRow.type}` }, { status: 400 });
    }

    if (key === "jira.no_recent_client_activity" && aRow.type !== "no_recent_client_activity") {
      return NextResponse.json({ error: `Key ${key} does not match alert.type ${aRow.type}` }, { status: 400 });
    }
  }

  if (!resolvedTargetId) {
    return NextResponse.json(
      { error: "Missing targetId (customer_id). Provide alertId or targetId." },
      { status: 400 }
    );
  }

  // -------------------------
  // Handler: stripe.missed_expected_payment
  // Real upstream control: mutate expected_revenue.last_paid_at for that customer_id
  // -------------------------
  if (key === "stripe.missed_expected_payment") {
    const customerId = resolvedTargetId;

    const { data: expRow, error: expErr } = await admin
      .from("expected_revenue")
      .select("customer_id, cadence_days, last_paid_at")
      .eq("customer_id", customerId)
      .maybeSingle();

    if (expErr) return NextResponse.json({ error: expErr.message }, { status: 500 });
    if (!expRow) {
      return NextResponse.json(
        {
          error:
            "No expected_revenue row for this customer_id. This alert type requires expected_revenue as the upstream expectation source.",
        },
        { status: 400 }
      );
    }

    const cadence = expRow.cadence_days ?? null;
    if (!cadence || cadence <= 0) {
      return NextResponse.json(
        { error: "cadence_days missing/invalid for this customer. Set cadence_days so drift can be evaluated." },
        { status: 400 }
      );
    }

    const SNAPSHOT_KEY = `${key}:${customerId}`;

    if (enabled) {
      // Create drift: set last_paid_at far enough back to be overdue
      const forcedLastPaid = isoDaysAgo(cadence + 15);

      // Snapshot original once
      const { data: snapExisting, error: snapReadErr } = await admin
        .from("debug_mutations")
        .select("id")
        .eq("key", SNAPSHOT_KEY)
        .maybeSingle();

      if (snapReadErr) return NextResponse.json({ error: snapReadErr.message }, { status: 500 });

      if (!snapExisting) {
        const { error: snapErr } = await admin.from("debug_mutations").insert({
          key: SNAPSHOT_KEY,
          table_name: "expected_revenue",
          row_id: customerId,
          original: { last_paid_at: expRow.last_paid_at ?? null },
          mutated: { last_paid_at: forcedLastPaid },
        });
        if (snapErr) return NextResponse.json({ error: snapErr.message }, { status: 500 });
      }

      const { error: uErr } = await admin
        .from("expected_revenue")
        .update({ last_paid_at: forcedLastPaid })
        .eq("customer_id", customerId);

      if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });

      // Run real generator
      const baseUrl = new URL(req.url);
      const genUrl = new URL("/api/logic/alerts/missed", baseUrl.origin);

      const genRes = await fetch(genUrl.toString(), { method: "POST" });
      const genJson = await genRes.json().catch(() => ({}));
      if (!genRes.ok) return NextResponse.json({ error: "Generator failed", details: genJson }, { status: 500 });

      return NextResponse.json({
        ok: true,
        key,
        enabled: true,
        targetId: customerId,
        mutated: { expected_revenue: { last_paid_at: forcedLastPaid } },
        generator: genJson,
      });
    }

    // Disable: restore original last_paid_at and remove snapshot
    const { data: snap, error: snapErr } = await admin
      .from("debug_mutations")
      .select("id, original")
      .eq("key", SNAPSHOT_KEY)
      .maybeSingle();

    if (snapErr) return NextResponse.json({ error: snapErr.message }, { status: 500 });

    const restoreLastPaid =
      (snap?.original as any)?.last_paid_at ??
      isoDaysAgo(Math.max(1, cadence - 2));

    const { error: restoreErr } = await admin
      .from("expected_revenue")
      .update({ last_paid_at: restoreLastPaid })
      .eq("customer_id", customerId);

    if (restoreErr) return NextResponse.json({ error: restoreErr.message }, { status: 500 });

    if (snap?.id) {
      const { error: delErr } = await admin.from("debug_mutations").delete().eq("id", snap.id);
      if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
    }

    const baseUrl = new URL(req.url);
    const genUrl = new URL("/api/logic/alerts/missed", baseUrl.origin);

    const genRes = await fetch(genUrl.toString(), { method: "POST" });
    const genJson = await genRes.json().catch(() => ({}));
    if (!genRes.ok) return NextResponse.json({ error: "Generator failed", details: genJson }, { status: 500 });

    return NextResponse.json({
      ok: true,
      key,
      enabled: false,
      targetId: customerId,
      restored: { expected_revenue: { last_paid_at: restoreLastPaid } },
      generator: genJson,
    });
  }

  // -------------------------
  // Handler: stripe.payment_amount_drift
  // Real upstream control: mutate the latest payments.amount for that customer_id
  // -------------------------
  if (key === "stripe.payment_amount_drift") {
    const customerId = resolvedTargetId;

    const { data: payRaw, error: payErr } = await admin
      .from("payments")
      .select("id, amount, paid_at")
      .eq("customer_id", customerId)
      .order("paid_at", { ascending: false })
      .limit(10);

    if (payErr) return NextResponse.json({ error: payErr.message }, { status: 500 });

    const rows = (payRaw || []) as Array<{ id: string; amount: number | null; paid_at: string | null }>;
    const paid = rows.filter((r) => r.paid_at && typeof r.amount === "number") as Array<{ id: string; amount: number; paid_at: string }>;

    if (paid.length < 4) {
      return NextResponse.json(
        { error: "Not enough payment history for this customer. Need at least 4 paid payments to evaluate drift." },
        { status: 400 }
      );
    }

    const latest = paid[0];
    const baselineAmounts = paid.slice(1).map((p) => p.amount);
    baselineAmounts.sort((a, b) => a - b);
    const mid = Math.floor(baselineAmounts.length / 2);
    const baseline = baselineAmounts.length % 2 === 0 ? Math.round((baselineAmounts[mid - 1] + baselineAmounts[mid]) / 2) : baselineAmounts[mid];

    if (!baseline || baseline <= 0) {
      return NextResponse.json({ error: "Baseline could not be computed for this customer." }, { status: 400 });
    }

    const SNAPSHOT_KEY = `${key}:${customerId}`;

    if (enabled) {
      const forcedAmount = Math.max(100, Math.round(baseline * 0.55));

      const { data: snapExisting, error: snapReadErr } = await admin
        .from("debug_mutations")
        .select("id")
        .eq("key", SNAPSHOT_KEY)
        .maybeSingle();

      if (snapReadErr) return NextResponse.json({ error: snapReadErr.message }, { status: 500 });

      if (!snapExisting) {
        const { error: snapErr } = await admin.from("debug_mutations").insert({
          key: SNAPSHOT_KEY,
          table_name: "payments",
          row_id: latest.id,
          original: { id: latest.id, amount: latest.amount },
          mutated: { id: latest.id, amount: forcedAmount },
        });
        if (snapErr) return NextResponse.json({ error: snapErr.message }, { status: 500 });
      }

      const { error: uErr } = await admin.from("payments").update({ amount: forcedAmount }).eq("id", latest.id);
      if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });

      const baseUrl = new URL(req.url);
      const genUrl = new URL("/api/alerts/amount-drift", baseUrl.origin);

      const genRes = await fetch(genUrl.toString(), { method: "POST" });
      const genJson = await genRes.json().catch(() => ({}));
      if (!genRes.ok) return NextResponse.json({ error: "Generator failed", details: genJson }, { status: 500 });

      return NextResponse.json({
        ok: true,
        key,
        enabled: true,
        targetId: customerId,
        mutated: { payments: { id: latest.id, amount: forcedAmount } },
        generator: genJson,
      });
    }

    const { data: snap, error: snapErr } = await admin
      .from("debug_mutations")
      .select("id, original")
      .eq("key", SNAPSHOT_KEY)
      .maybeSingle();

    if (snapErr) return NextResponse.json({ error: snapErr.message }, { status: 500 });

    const restoreAmount = (snap?.original as any)?.amount ?? baseline;
    const restoreId = (snap?.original as any)?.id ?? latest.id;

    const { error: restoreErr } = await admin.from("payments").update({ amount: restoreAmount }).eq("id", restoreId);
    if (restoreErr) return NextResponse.json({ error: restoreErr.message }, { status: 500 });

    if (snap?.id) {
      const { error: delErr } = await admin.from("debug_mutations").delete().eq("id", snap.id);
      if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
    }

    const baseUrl = new URL(req.url);
    const genUrl = new URL("/api/alerts/amount-drift", baseUrl.origin);

    const genRes = await fetch(genUrl.toString(), { method: "POST" });
    const genJson = await genRes.json().catch(() => ({}));
    if (!genRes.ok) return NextResponse.json({ error: "Generator failed", details: genJson }, { status: 500 });

    return NextResponse.json({
      ok: true,
      key,
      enabled: false,
      targetId: customerId,
      restored: { payments: { id: restoreId, amount: restoreAmount } },
      generator: genJson,
    });
  }

  // -------------------------
  // Handler: jira.no_recent_client_activity
  // Real upstream control: NONE (external system). Debug control: run generator with lookback override.
  // -------------------------
  if (key === "jira.no_recent_client_activity") {
    const customerId = resolvedTargetId;
    const SNAPSHOT_KEY = `${key}:${customerId}`;

    const baseUrl = new URL(req.url);
    const genUrl = new URL("/api/logic/alerts/no-client-activity", baseUrl.origin);

    if (enabled) {
      const forcedLookback = "1m";

      const { data: snapExisting, error: snapReadErr } = await admin
        .from("debug_mutations")
        .select("id")
        .eq("key", SNAPSHOT_KEY)
        .maybeSingle();

      if (snapReadErr) return NextResponse.json({ error: snapReadErr.message }, { status: 500 });

      if (!snapExisting) {
        const { error: snapErr } = await admin.from("debug_mutations").insert({
          key: SNAPSHOT_KEY,
          table_name: "alerts", // no real upstream table; this is just a debug snapshot
          row_id: customerId,
          original: { lookback: process.env.JIRA_ACTIVITY_LOOKBACK ?? "7d" },
          mutated: { lookback: forcedLookback },
        });
        if (snapErr) return NextResponse.json({ error: snapErr.message }, { status: 500 });
      }

      const genRes = await fetch(genUrl.toString(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lookback: forcedLookback }),
      });

      const genJson = await genRes.json().catch(() => ({}));
      if (!genRes.ok) return NextResponse.json({ error: "Generator failed", details: genJson }, { status: 500 });

      return NextResponse.json({
        ok: true,
        key,
        enabled: true,
        targetId: customerId,
        mutated: { lookback: forcedLookback },
        generator: genJson,
      });
    }

    // Disable: restore to normal lookback (from snapshot if present, else 7d)
    const { data: snap, error: snapErr } = await admin
      .from("debug_mutations")
      .select("id, original")
      .eq("key", SNAPSHOT_KEY)
      .maybeSingle();

    if (snapErr) return NextResponse.json({ error: snapErr.message }, { status: 500 });

    const restoreLookback = (snap?.original as any)?.lookback ?? (process.env.JIRA_ACTIVITY_LOOKBACK ?? "7d");

    if (snap?.id) {
      const { error: delErr } = await admin.from("debug_mutations").delete().eq("id", snap.id);
      if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
    }

    const genRes = await fetch(genUrl.toString(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lookback: restoreLookback }),
    });

    const genJson = await genRes.json().catch(() => ({}));
    if (!genRes.ok) return NextResponse.json({ error: "Generator failed", details: genJson }, { status: 500 });

    return NextResponse.json({
      ok: true,
      key,
      enabled: false,
      targetId: customerId,
      restored: { lookback: restoreLookback },
      generator: genJson,
    });
  }

  return NextResponse.json({ error: `Unknown toggle key: ${key}` }, { status: 400 });
}
