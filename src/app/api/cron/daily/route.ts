import { NextResponse } from "next/server";
import { requireCron } from "@/lib/api";

export async function GET(req: Request) {
  try {
    requireCron(req);

    const origin =
      process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000";

    // Alpha cron scope: only run routes that are green + supported by prod schema.
    const paths = [
      "/api/logic/customer-defaults",
      "/api/logic/alerts/missed",
      "/api/logic/alerts/notion-stale",
      "/api/logic/alerts/qbo-overdue-invoices",
      "/api/logic/alerts/suppress-inactive",
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

    return NextResponse.json({ ok: true, results });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "error" }, { status: 500 });
  }
}
