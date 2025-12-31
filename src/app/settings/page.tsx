// src/app/settings/page.tsx
import { notFound, redirect } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

function isSettingsEnabled() {
  if (process.env.NODE_ENV === "development") return true;
  return process.env.DEBUG_FIXTURES_ENABLED === "true";
}

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

type Customer = {
  id: string;
  name: string | null;
  email: string | null;
  created_at: string;
};

type CustomerSettings = {
  customer_id: string;
  missed_payment_grace_days: number;
  missed_payment_low_conf_cutoff: number;
  missed_payment_low_conf_min_risk_cents: number;
  amount_drift_threshold_pct: number;
  jira_activity_lookback: string;
  updated_at: string;
};

type CustomerState = {
  customer_id: string;
  status: string; // active|onboarding|paused|inactive
  reason: string | null;
  updated_at: string;
};

function money(cents: number) {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "USD" });
}

/**
 * Create default rows ONLY for customers that are missing rows.
 * Never overwrites existing rows.
 */
async function ensureDefaults(admin: ReturnType<typeof supabaseAdmin>, customers: Customer[]) {
  if (customers.length === 0) return;

  const ids = customers.map((c) => c.id);

  const [{ data: existingSettings, error: sErr }, { data: existingState, error: stErr }] = await Promise.all([
    admin.from("customer_settings").select("customer_id").in("customer_id", ids),
    admin.from("customer_state").select("customer_id").in("customer_id", ids),
  ]);

  if (sErr) throw new Error(`Failed to read customer_settings: ${sErr.message}`);
  if (stErr) throw new Error(`Failed to read customer_state: ${stErr.message}`);

  const haveSettings = new Set((existingSettings || []).map((r: any) => r.customer_id));
  const haveState = new Set((existingState || []).map((r: any) => r.customer_id));

  const now = new Date().toISOString();

  const missingSettings = customers
    .filter((c) => !haveSettings.has(c.id))
    .map((c) => ({
      customer_id: c.id,
      missed_payment_grace_days: 2,
      missed_payment_low_conf_cutoff: 0.5,
      missed_payment_low_conf_min_risk_cents: 500000,
      amount_drift_threshold_pct: 0.25,
      jira_activity_lookback: "7d",
      updated_at: now,
    }));

  const missingState = customers
    .filter((c) => !haveState.has(c.id))
    .map((c) => ({
      customer_id: c.id,
      status: "active",
      reason: null,
      updated_at: now,
    }));

  if (missingSettings.length > 0) {
    const { error } = await admin.from("customer_settings").insert(missingSettings);
    if (error && (error as any).code !== "23505") throw new Error(`Failed to insert default customer_settings: ${error.message}`);
  }

  if (missingState.length > 0) {
    const { error } = await admin.from("customer_state").insert(missingState);
    if (error && (error as any).code !== "23505") throw new Error(`Failed to insert default customer_state: ${error.message}`);
  }
}

function isActiveStatus(status: string) {
  return (status || "active").toLowerCase() === "active";
}

export default async function SettingsPage() {
  if (!isSettingsEnabled()) notFound();

  const admin = supabaseAdmin();

  const { data: customersRaw, error: cErr } = await admin
    .from("customers")
    .select("id, name, email, created_at")
    .order("created_at", { ascending: true });

  if (cErr) {
    return (
      <main className="px-0">
        <div className="rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-surface)] p-6">
          <p className="text-sm text-[var(--ops-text-secondary)]">Failed to load customers: {cErr.message}</p>
        </div>
      </main>
    );
  }

  const customers = (customersRaw || []) as Customer[];

  try {
    await ensureDefaults(admin, customers);
  } catch (e: any) {
    return (
      <main className="px-0">
        <div className="rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-surface)] p-6">
          <p className="text-sm text-[var(--ops-text-secondary)]">Defaults bootstrap failed: {String(e?.message || e)}</p>
        </div>
      </main>
    );
  }

  const ids = customers.map((c) => c.id);

  const { data: settingsRaw, error: setErr } = await admin
    .from("customer_settings")
    .select(
      "customer_id, missed_payment_grace_days, missed_payment_low_conf_cutoff, missed_payment_low_conf_min_risk_cents, amount_drift_threshold_pct, jira_activity_lookback, updated_at"
    )
    .in("customer_id", ids);

  const { data: stateRaw, error: stateErr } = await admin
    .from("customer_state")
    .select("customer_id, status, reason, updated_at")
    .in("customer_id", ids);

  if (setErr || stateErr) {
    return (
      <main className="px-0">
        <div className="rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-surface)] p-6">
          <p className="text-sm text-[var(--ops-text-secondary)]">
            Failed to load settings/state: {[setErr?.message, stateErr?.message].filter(Boolean).join(" / ")}
          </p>
        </div>
      </main>
    );
  }

  const settingsById = new Map((settingsRaw || []).map((s: any) => [s.customer_id, s as CustomerSettings]));
  const stateById = new Map((stateRaw || []).map((s: any) => [s.customer_id, s as CustomerState]));

  async function updateCustomer(formData: FormData) {
    "use server";
    const admin = supabaseAdmin();

    const customerId = String(formData.get("customer_id") || "").trim();
    if (!customerId) redirect("/settings");

    const status = String(formData.get("status") || "active").trim();
    const reason = String(formData.get("reason") || "").trim() || null;

    const graceDays = Number(formData.get("missed_payment_grace_days"));
    const lowConfCutoff = Number(formData.get("missed_payment_low_conf_cutoff"));
    const lowConfMinRisk = Number(formData.get("missed_payment_low_conf_min_risk_cents"));
    const driftPct = Number(formData.get("amount_drift_threshold_pct"));
    const lookback = String(formData.get("jira_activity_lookback") || "7d").trim();

    const safeGrace = Number.isFinite(graceDays) ? Math.max(0, Math.min(14, Math.floor(graceDays))) : 2;
    const safeCutoff = Number.isFinite(lowConfCutoff) ? Math.max(0, Math.min(1, lowConfCutoff)) : 0.5;
    const safeMinRisk = Number.isFinite(lowConfMinRisk) ? Math.max(0, Math.floor(lowConfMinRisk)) : 500000;
    const safeDrift = Number.isFinite(driftPct) ? Math.max(0.05, Math.min(1, driftPct)) : 0.25;
    const safeLookback = lookback || "7d";

    const now = new Date().toISOString();

    const { error: stErr } = await admin.from("customer_state").upsert(
      {
        customer_id: customerId,
        status,
        reason,
        updated_at: now,
      },
      { onConflict: "customer_id" }
    );
    if (stErr) throw new Error(`Failed to update customer_state: ${stErr.message}`);

    const { error: sErr } = await admin.from("customer_settings").upsert(
      {
        customer_id: customerId,
        missed_payment_grace_days: safeGrace,
        missed_payment_low_conf_cutoff: safeCutoff,
        missed_payment_low_conf_min_risk_cents: safeMinRisk,
        amount_drift_threshold_pct: safeDrift,
        jira_activity_lookback: safeLookback,
        updated_at: now,
      },
      { onConflict: "customer_id" }
    );
    if (sErr) throw new Error(`Failed to update customer_settings: ${sErr.message}`);

    // ✅ immediate suppression behavior
    if (!isActiveStatus(status)) {
      const { error: supErr } = await admin
        .from("alerts")
        .update({
          status: "resolved",
          confidence: "high",
          confidence_reason: `suppressed: customer not active (${status})`,
          context: { suppression_reason: "customer_status", customer_status: status, customer_reason: reason },
        })
        .eq("status", "open")
        .eq("customer_id", customerId);

      if (supErr) throw new Error(`Failed to suppress alerts for customer: ${supErr.message}`);
    }

    revalidatePath("/settings");
    revalidatePath("/");
    redirect("/settings");
  }

  return (
    <main className="px-0">
      {/* Removed the Settings header + description copy */}

      <div className="space-y-4">
        {customers.map((c) => {
          const s = settingsById.get(c.id);
          const st = stateById.get(c.id);

          const name = c.name || c.email || c.id.slice(0, 8);

          return (
            <div key={c.id} className="rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-surface)] p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-[var(--ops-text-faint)]">Customer</div>
                  <div className="mt-1 text-lg font-semibold text-[var(--ops-text)]">{name}</div>
                  <div className="mt-1 text-xs text-[var(--ops-text-faint)]">id: {c.id}</div>
                </div>

                <div className="text-xs text-[var(--ops-text-faint)]">
                  <div>Settings updated: {s?.updated_at ? new Date(s.updated_at).toLocaleString() : "—"}</div>
                  <div>Status updated: {st?.updated_at ? new Date(st.updated_at).toLocaleString() : "—"}</div>
                </div>
              </div>

              <form action={updateCustomer} className="mt-6 grid gap-4 md:grid-cols-2">
                <input type="hidden" name="customer_id" value={c.id} />

                <div className="rounded-xl border border-[var(--ops-border)] bg-white/60 p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-[var(--ops-text-faint)]">Client status</div>
                  <div className="mt-3 grid gap-3">
                    <label className="text-sm text-[var(--ops-text-secondary)]">
                      Status
                      <select
                        name="status"
                        defaultValue={st?.status || "active"}
                        className="mt-1 w-full rounded-lg border border-[var(--ops-border)] bg-[var(--ops-surface)] px-3 py-2 text-sm text-[var(--ops-text)]"
                      >
                        <option value="active">active</option>
                        <option value="onboarding">onboarding</option>
                        <option value="paused">paused</option>
                        <option value="inactive">inactive</option>
                      </select>
                    </label>

                    <label className="text-sm text-[var(--ops-text-secondary)]">
                      Reason (optional)
                      <input
                        name="reason"
                        defaultValue={st?.reason || ""}
                        className="mt-1 w-full rounded-lg border border-[var(--ops-border)] bg-[var(--ops-surface)] px-3 py-2 text-sm text-[var(--ops-text)]"
                        placeholder="e.g. onboarding phase, seasonal pause"
                      />
                    </label>

                    <div className="text-xs text-[var(--ops-text-faint)]">
                      Non-active statuses suppress client alerts immediately (they resolve) to avoid “technically true but practically wrong” noise.
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-[var(--ops-border)] bg-white/60 p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-[var(--ops-text-faint)]">Signal thresholds</div>

                  <div className="mt-3 grid gap-3">
                    <label className="text-sm text-[var(--ops-text-secondary)]">
                      Missed payment grace days
                      <input
                        name="missed_payment_grace_days"
                        type="number"
                        min={0}
                        max={14}
                        defaultValue={s?.missed_payment_grace_days ?? 2}
                        className="mt-1 w-full rounded-lg border border-[var(--ops-border)] bg-[var(--ops-surface)] px-3 py-2 text-sm text-[var(--ops-text)]"
                      />
                    </label>

                    <label className="text-sm text-[var(--ops-text-secondary)]">
                      Missed payment low-confidence cutoff (0–1)
                      <input
                        name="missed_payment_low_conf_cutoff"
                        type="number"
                        step="0.05"
                        min={0}
                        max={1}
                        defaultValue={s?.missed_payment_low_conf_cutoff ?? 0.5}
                        className="mt-1 w-full rounded-lg border border-[var(--ops-border)] bg-[var(--ops-surface)] px-3 py-2 text-sm text-[var(--ops-text)]"
                      />
                    </label>

                    <label className="text-sm text-[var(--ops-text-secondary)]">
                      Low-confidence minimum risk (cents)
                      <input
                        name="missed_payment_low_conf_min_risk_cents"
                        type="number"
                        min={0}
                        defaultValue={s?.missed_payment_low_conf_min_risk_cents ?? 500000}
                        className="mt-1 w-full rounded-lg border border-[var(--ops-border)] bg-[var(--ops-surface)] px-3 py-2 text-sm text-[var(--ops-text)]"
                      />
                      <div className="mt-1 text-xs text-[var(--ops-text-faint)]">
                        Current: {money(s?.missed_payment_low_conf_min_risk_cents ?? 500000)}. Below this, low-confidence “missed” alerts are suppressed.
                      </div>
                    </label>

                    <label className="text-sm text-[var(--ops-text-secondary)]">
                      Payment amount drift threshold (0–1)
                      <input
                        name="amount_drift_threshold_pct"
                        type="number"
                        step="0.05"
                        min={0.05}
                        max={1}
                        defaultValue={s?.amount_drift_threshold_pct ?? 0.25}
                        className="mt-1 w-full rounded-lg border border-[var(--ops-border)] bg-[var(--ops-surface)] px-3 py-2 text-sm text-[var(--ops-text)]"
                      />
                    </label>

                    <label className="text-sm text-[var(--ops-text-secondary)]">
                      Jira activity lookback (e.g. 7d, 14d)
                      <input
                        name="jira_activity_lookback"
                        defaultValue={s?.jira_activity_lookback ?? "7d"}
                        className="mt-1 w-full rounded-lg border border-[var(--ops-border)] bg-[var(--ops-surface)] px-3 py-2 text-sm text-[var(--ops-text)]"
                      />
                    </label>
                  </div>
                </div>

                <div className="md:col-span-2 flex items-center justify-end">
                  <button type="submit" className="ops-cta bg-[var(--ops-accent-dark)] text-white border-transparent hover:opacity-95">
                    Save
                  </button>
                </div>
              </form>
            </div>
          );
        })}
      </div>
    </main>
  );
}
