// src/app/settings/page.tsx
import { notFound } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { SettingsClientList } from "./SettingsClientList";

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

async function upsertCustomerSettings(formData: FormData) {
  "use server";

  if (!isSettingsEnabled()) notFound();

  const customerId = String(formData.get("customer_id") || "");
  if (!customerId) return;

  const missed_payment_grace_days = Number(formData.get("missed_payment_grace_days"));
  const missed_payment_low_conf_cutoff = Number(formData.get("missed_payment_low_conf_cutoff"));
  const missed_payment_low_conf_min_risk_cents = Number(
    formData.get("missed_payment_low_conf_min_risk_cents")
  );
  const amount_drift_threshold_pct = Number(formData.get("amount_drift_threshold_pct"));
  const jira_activity_lookback = String(formData.get("jira_activity_lookback") || "").trim();

  const sb = supabaseAdmin();

  await sb.from("customer_settings").upsert(
    {
      customer_id: customerId,
      missed_payment_grace_days: Number.isFinite(missed_payment_grace_days)
        ? missed_payment_grace_days
        : 0,
      missed_payment_low_conf_cutoff: Number.isFinite(missed_payment_low_conf_cutoff)
        ? missed_payment_low_conf_cutoff
        : 0,
      missed_payment_low_conf_min_risk_cents: Number.isFinite(missed_payment_low_conf_min_risk_cents)
        ? missed_payment_low_conf_min_risk_cents
        : 0,
      amount_drift_threshold_pct: Number.isFinite(amount_drift_threshold_pct)
        ? amount_drift_threshold_pct
        : 0,
      jira_activity_lookback,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "customer_id" }
  );

  revalidatePath("/settings");
}

export default async function SettingsPage() {
  if (!isSettingsEnabled()) notFound();

  const sb = supabaseAdmin();

  const { data: customersRaw, error: customersErr } = await sb
    .from("customers")
    .select("id,name,email,created_at")
    .order("created_at", { ascending: false });

  if (customersErr) {
    throw new Error(`Failed to load customers: ${customersErr.message}`);
  }

  const customers = (customersRaw || []) as Customer[];

  const { data: settingsRaw, error: settingsErr } = await sb
    .from("customer_settings")
    .select(
      "customer_id,missed_payment_grace_days,missed_payment_low_conf_cutoff,missed_payment_low_conf_min_risk_cents,amount_drift_threshold_pct,jira_activity_lookback,updated_at"
    );

  if (settingsErr) {
    throw new Error(`Failed to load customer settings: ${settingsErr.message}`);
  }

  const settings = (settingsRaw || []) as CustomerSettings[];

  // UX/Brand parity: keep page surfaces using ops tokens, no slate-*
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between">
        <div>
          <div className="text-lg font-semibold" style={{ color: "var(--ops-text)" }}>
            Settings
          </div>
          <div className="text-sm mt-1" style={{ color: "var(--ops-muted)" }}>
            Pilot controls (internal).
          </div>
        </div>
      </div>

      {customers.length === 0 ? (
        <div
          className="rounded-xl border p-4 text-sm"
          style={{
            background: "var(--ops-surface)",
            borderColor: "var(--ops-border)",
            color: "var(--ops-muted)",
          }}
        >
          No customers found.
        </div>
      ) : (
        <SettingsClientList
          customers={customers}
          settings={settings}
          defaultOpenCustomerId={customers[0]?.id ?? null}
          upsertCustomerSettings={upsertCustomerSettings}
        />
      )}
    </div>
  );
}
