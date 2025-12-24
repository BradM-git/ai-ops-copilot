import Link from "next/link";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type CustomerRow = {
  id: string;
  name: string | null;
  email: string | null;
  stripe_customer_id: string | null;
  expected_revenue?: {
    expected_amount: number | null;
    cadence_days: number | null;
    last_paid_at: string | null;
  } | null;
};

export default async function CustomersPage() {
  const { data, error } = await supabase
    .from("customers")
    .select("id,name,email,stripe_customer_id,expected_revenue(expected_amount,cadence_days,last_paid_at)")
    .order("created_at", { ascending: false })
    .limit(100);

  const rows = (data ?? []) as CustomerRow[];

  return (
    <main className="mx-auto max-w-4xl p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Customers</h1>
          <p className="mt-1 text-sm text-slate-600">
            Stripe customers + inferred expected revenue (MVP)
          </p>
        </div>
        <Link className="text-sm text-blue-600 hover:underline" href="/">
          Back to alerts
        </Link>
      </header>

      {error ? (
        <pre className="mt-4 overflow-auto rounded-lg bg-slate-50 p-3 text-xs">
          {JSON.stringify(error, null, 2)}
        </pre>
      ) : (
        <div className="mt-6 overflow-hidden rounded-xl border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left">
              <tr>
                <th className="p-3">Customer</th>
                <th className="p-3">Expected</th>
                <th className="p-3">Cadence</th>
                <th className="p-3">Last paid</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const e = c.expected_revenue;
                return (
                  <tr key={c.id} className="border-t">
                    <td className="p-3">
                      <div className="font-medium">{c.name ?? "Unknown"}</div>
                      <div className="text-slate-600">{c.email ?? ""}</div>
                    </td>
                    <td className="p-3">
                      {e?.expected_amount != null
                        ? `$${(e.expected_amount / 100).toFixed(2)}`
                        : "—"}
                    </td>
                    <td className="p-3">{e?.cadence_days ? `${e.cadence_days}d` : "—"}</td>
                    <td className="p-3">
                      {e?.last_paid_at ? new Date(e.last_paid_at).toLocaleDateString() : "—"}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td className="p-3 text-slate-600" colSpan={4}>
                    No customers yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
