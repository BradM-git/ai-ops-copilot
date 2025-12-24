import { supabase } from "@/lib/supabase";

export default async function Home() {
  const { data, error } = await supabase
    .from("accounts")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(20);

  return (
    <main style={{ padding: 24 }}>
      <h1>AI Ops Copilot</h1>
      <pre>{JSON.stringify(error ?? data, null, 2)}</pre>
    </main>
  );
}
