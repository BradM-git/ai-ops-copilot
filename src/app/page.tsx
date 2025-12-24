// src/app/page.tsx
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import CloseAlertButton from "@/components/CloseAlertButton";

export const dynamic = "force-dynamic";

type CustomerMini = {
  name: string | null;
  email: string | null;
};

type AlertRow = {
  id: string;
  type: string | null;
  message: string | null;
  amount_at_risk: number | null;
  status: string | null;
  created_at: string | null;
  // Supabase relation select returns an array
  customers?: CustomerMini[] | null;
};

function dollarsFromCents(cents: number | null) {
  if (cents == null) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}

export default async function HomePage() {
  const { data: alerts, error } = await supabase
    .from("alerts")
    .select("id,type,message,amount_at_risk,status,created_at,customers(name,email)")
    .order("created_at", { ascending: false })
    .limit(50);

  const rows = (alerts ?? []) as AlertRow[];

  const open = rows.filter((a) => a.status === "open");
  const closed = rows.filter((a) => a.status !== "open");

  const amountAtRisk = open.reduce((sum, a) => sum + (a.amount_at_risk ?? 0), 0);

  return (
    <main className="mx-auto max-w-4xl p-6">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">AI Ops Copilot</h1>
          <p className="mt-1 text-sm text-slate-600">
            Detect likely missed or at-risk recurring revenue from Stripe (MVP).
          </p>
        </div>
        <Link className="text-sm text-blue-600 hover:underline" href="/customers">
          Customers →
        </Link>
      </header>

      {error ? (
        <pre className="mt-4 overflow-auto rounded-lg bg-slate-50 p-3 text-xs">
          {JSON.stringify(error, null, 2)}
        </pre>
      ) : (
        <>
          <section className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border bg-white p-4">
              <div className="text-sm text-slate-600">Open alerts</div>
              <div className="mt-1 text-2xl font-bold">{open.length}</div>
            </div>
            <div className="rounded-xl border bg-white p-4">
              <div className="text-sm text-slate-600">Amount at risk</div>
              <div className="mt-1 text-2xl font-bold">{dollarsFromCents(amountAtRisk)}</div>
            </div>
          </section>

          <section className="mt-8">
            <h2 className="text-lg font-semibold">Open alerts</h2>
            <div className="mt-3 space-y-3">
              {open.map((a) => {
                const c = a.customers?.[0] ?? null;
                const title = c?.name ? `Likely missed from ${c.name}` : "Likely missed payment";
                return (
                  <div key={a.id} className="rounded-xl border bg-white p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="font-medium">{title}</div>
                        <div className="mt-1 text-sm text-slate-600">
                          {a.message ?? ""}
                          {a.amount_at_risk != null ? ` • ${dollarsFromCents(a.amount_at_risk)}` : ""}
                        </div>
                        {c?.email && <div className="mt-1 text-xs text-slate-500">{c.email}</div>}
                      </div>

                      <CloseAlertButton id={a.id} />
                    </div>
                  </div>
                );
              })}
              {open.length === 0 && (
                <div className="rounded-xl border bg-white p-4 text-sm text-slate-600">
                  No open alerts.
                </div>
              )}
            </div>
          </section>

          <section className="mt-10">
            <h2 className="text-lg font-semibold">Recently closed</h2>
            <div className="mt-3 space-y-3">
              {closed.slice(0, 10).map((a) => {
                const c = a.customers?.[0] ?? null;
                return (
                  <div key={a.id} className="rounded-xl border bg-white p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="font-medium">
                          {c?.name ? c.name : "Customer"} — closed
                        </div>
                        <div className="mt-1 text-sm text-slate-600">{a.message ?? ""}</div>
                      </div>
                      <div className="text-xs text-slate-500">
                        {a.created_at ? new Date(a.created_at).toLocaleDateString() : ""}
                      </div>
                    </div>
                  </div>
                );
              })}
              {closed.length === 0 && (
                <div className="rounded-xl border bg-white p-4 text-sm text-slate-600">
                  No closed alerts yet.
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
