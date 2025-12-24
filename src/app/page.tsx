import Link from "next/link";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type AlertRow = {
  id: string;
  type: string | null;
  message: string | null;
  amount_at_risk: number | null;
  status: string | null;
  created_at: string;
  customers?: { name: string | null; email: string | null } | null;
};

export default async function Home() {
  const { data: alerts, error } = await supabase
    .from("alerts")
    .select(
      "id,type,message,amount_at_risk,status,created_at,customers(name,email)"
    )
    .order("created_at", { ascending: false })
    .limit(50);

  const rows = (alerts ?? []) as AlertRow[];

  const open = rows.filter((a) => a.status === "open");
  const closed = rows.filter((a) => a.status !== "open");

  return (
    <main className="mx-auto max-w-4xl p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">AI Ops Copilot</h1>
          <p className="mt-1 text-sm text-slate-600">
            Automated revenue risk alerts from Stripe → Supabase (MVP)
          </p>
        </div>
        <div className="text-right text-sm text-slate-600">
          <div>{open.length} open</div>
          <div>{rows.length} total</div>
        </div>
      </header>

      <section className="mt-6 rounded-xl border bg-white p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Open alerts</h2>
          <Link
            className="text-sm text-blue-600 hover:underline"
            href="/api/cron/daily"
          >
            Run sync now
          </Link>
        </div>

        {error ? (
          <pre className="mt-3 overflow-auto rounded-lg bg-slate-50 p-3 text-xs">
            {JSON.stringify(error, null, 2)}
          </pre>
        ) : open.length === 0 ? (
          <p className="mt-3 text-sm text-slate-600">No open alerts 🎉</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {open.map((a) => (
              <li key={a.id} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-medium">
                    {a.customers?.name ?? "Unknown customer"}
                    <span className="ml-2 text-sm font-normal text-slate-600">
                      {a.customers?.email ?? ""}
                    </span>
                  </div>
                  <div className="text-sm text-slate-600">
                    {new Date(a.created_at).toLocaleString()}
                  </div>
                </div>

                <div className="mt-2 text-sm">{a.message}</div>

                <div className="mt-2 text-sm text-slate-700">
                  <span className="font-medium">At risk:</span>{" "}
                  {a.amount_at_risk != null
                    ? `$${(a.amount_at_risk / 100).toFixed(2)}`
                    : "—"}
                  <span className="ml-3 rounded-full bg-slate-100 px-2 py-0.5 text-xs">
                    {a.type ?? "alert"}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {closed.length > 0 && (
        <section className="mt-6 rounded-xl border bg-white p-4">
          <h2 className="font-semibold">Recent closed</h2>
          <ul className="mt-3 space-y-2 text-sm text-slate-600">
            {closed.slice(0, 10).map((a) => (
              <li key={a.id} className="flex justify-between gap-4">
                <span>
                  {a.customers?.name ?? "Unknown"} — {a.message}
                </span>
                <span>{new Date(a.created_at).toLocaleDateString()}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
