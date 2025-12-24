import { supabase } from "@/lib/supabase";

export default async function Home() {
  const { data: alerts, error } = await supabase
    .from("alerts")
    .select("id,type,message,amount_at_risk,status,created_at")
    .order("created_at", { ascending: false })
    .limit(20);

  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>AI Ops Copilot</h1>
      <p style={{ marginTop: 8, color: "#555" }}>
        Alerts (MVP)
      </p>

      <div style={{ marginTop: 16 }}>
        {error ? (
          <pre>{JSON.stringify(error, null, 2)}</pre>
        ) : (
          <pre>{JSON.stringify(alerts, null, 2)}</pre>
        )}
      </div>
    </main>
  );
}
