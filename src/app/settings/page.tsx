// src/app/settings/page.tsx
import { notFound } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { SettingsClientList } from "./SettingsClientList";
import { getCurrentCustomerId } from "@/lib/currentCustomer";

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

  // ✅ Never trust customer_id from the browser. Always scope to the logged-in customer.
  let customerId: string | null = null;
  try {
    customerId = await getCurrentCustomerId();
  } catch {
    customerId = null;
  }
  if (!customerId) notFound();

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

  let customerId: string | null = null;
  try {
    customerId = await getCurrentCustomerId();
  } catch {
    customerId = null;
  }
  if (!customerId) notFound();

  const supabase = supabaseAdmin();

  // ✅ Only load the logged-in customer
  const { data: customersRaw } = await supabase
    .from("customers")
    .select("id,name,email,created_at")
    .eq("id", customerId);

  const customers = (customersRaw || []) as Customer[];

  // ✅ Only load settings for the logged-in customer
  const { data: settingsRaw } = await supabase
    .from("customer_settings")
    .select(
      "customer_id,missed_payment_grace_days,missed_payment_low_conf_cutoff,missed_payment_low_conf_min_risk_cents,amount_drift_threshold_pct,jira_activity_lookback,updated_at"
    )
    .eq("customer_id", customerId);

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
          No customer found for this account.
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
