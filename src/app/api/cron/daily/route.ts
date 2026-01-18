// src/app/api/cron/daily/route.ts
import { NextResponse } from "next/server";
import { requireCron } from "@/lib/api";
import { createClient } from "@supabase/supabase-js";

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

function hasQboConfig() {
  // QuickBooks auth is via Intuit OAuth. QBO_* env vars are legacy and should not gate cron.
  return Boolean(process.env.INTUIT_CLIENT_ID && process.env.INTUIT_CLIENT_SECRET);
}

export async function GET(req: Request) {
  const supabase = supabaseAdmin();

  try {
    requireCron(req);

    const origin =
      process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000";

    const paths = [
      "/api/logic/customer-defaults",
      "/api/logic/alerts/missed",

      // Notion (single DB)
      "/api/logic/alerts/notion-stale-activity",
      "/api/logic/alerts/notion-stale-past-due",

      // QuickBooks
      ...(hasQboConfig()
        ? [
            "/api/logic/alerts/qbo-overdue-invoices",
            "/api/logic/alerts/qbo-invoices-due-to-send",
          ]
        : []),

      "/api/logic/alerts/suppress-inactive",
    ];

    const skipped = hasQboConfig()
      ? []
      : [
          {
            path: "/api/logic/alerts/qbo-overdue-invoices",
            reason: "Skipped: missing required Intuit env vars (INTUIT_CLIENT_ID/INTUIT_CLIENT_SECRET)",
          },
          {
            path: "/api/logic/alerts/qbo-invoices-due-to-send",
            reason: "Skipped: missing required Intuit env vars (INTUIT_CLIENT_ID/INTUIT_CLIENT_SECRET)",
          },
        ];

    const results = await Promise.all(
      paths.map(async (p) => {
        const r = await fetch(`${origin}${p}`, {
          headers: {
            "x-cron-secret": req.headers.get("x-cron-secret") ?? "",
            authorization: req.headers.get("authorization") ?? "",
          },
          cache: "no-store",
        });
        return { path: p, status: r.status, ok: r.ok, body: await r.text() };
      })
    );

    // Record successful cron run
    await supabase.from("cron_runs").insert({
      source: "cron/daily",
      ok: true,
      results: [...results, ...skipped],
    });

    return NextResponse.json({ ok: true, results: [...results, ...skipped] });
  } catch (e: any) {
    // Record failed cron run
    await supabase.from("cron_runs").insert({
      source: "cron/daily",
      ok: false,
      results: [{ error: e?.message || "error" }],
    });

    return NextResponse.json({ ok: false, error: e?.message || "error" }, { status: 500 });
  }
}
