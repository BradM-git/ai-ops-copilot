// src/app/api/alerts/close/route.ts
import { createClient } from "@supabase/supabase-js";
import { HttpError, jsonErr, jsonOk, requireEnv } from "@/lib/api";

export const runtime = "nodejs";

function getSupabase() {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return createClient(url, key);
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const id = body?.id;

    if (!id || typeof id !== "string") {
      throw new HttpError(400, "Missing id", { code: "MISSING_ID" });
    }

    const supabase = getSupabase();

    const { error } = await supabase.from("alerts").update({ status: "closed" }).eq("id", id);

    if (error) {
      throw new HttpError(500, "Supabase update alert failed", {
        code: "SUPABASE_UPDATE_ALERT_FAILED",
        details: error,
      });
    }

    return jsonOk({ ok: true });
  } catch (err) {
    return jsonErr(err);
  }
}
