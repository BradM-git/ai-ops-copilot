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

  const supabase = supabaseAdmin();

  const payload: CustomerSettings = {
    customer_id: customerId,
    missed_payment_grace_days: Number(formData.get("missed_payment_grace_days") || 0),
    missed_payment_low_conf_cutoff: Number(formData.get("missed_payment_low_conf_cutoff") || 0),
    missed_payment_low_conf_min_risk_cents: Number(
      formData.get("missed_payment_low_conf_min_risk_cents") || 0
    ),
    amount_drift_threshold_pct: Number(formData.get("amount_drift_threshold_pct") || 0),
    jira_activity_lookback: String(formData.get("jira_activity_lookback") || "P14D"),
    updated_at: new Date().toISOString(),
  };

  await supabase.from("customer_settings").upsert(payload, { onConflict: "customer_id" });

  revalidatePath("/settings");
}

export default async function SettingsPage() {
  if (!isSettingsEnabled()) notFound();

  const supabase = supabaseAdmin();

  const { data: customersRaw } = await supabase
    .from("customers")
    .select("id,name,email,created_at")
    .order("created_at", { ascending: false });

  const customers = (customersRaw || []) as Customer[];

  const { data: settingsRaw } = await supabase
    .from("customer_settings")
    .select(
      "customer_id,missed_payment_grace_days,missed_payment_low_conf_cutoff,missed_payment_low_conf_min_risk_cents,amount_drift_threshold_pct,jira_activity_lookback,updated_at"
    );

  const settings = (settingsRaw || []) as CustomerSettings[];

  return (
    <div className="space-y-4">
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
