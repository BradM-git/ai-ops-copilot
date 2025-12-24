import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { id } = await req.json().catch(() => ({}));

  if (!id) return Response.json({ error: "Missing id" }, { status: 400 });

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { error } = await supabase
    .from("alerts")
    .update({ status: "closed" })
    .eq("id", id);

  if (error) return Response.json({ error }, { status: 500 });

  return Response.json({ ok: true });
}
