// src/app/api/cron/daily/route.ts
import { HttpError, jsonErr, jsonOk, requireEnv } from "@/lib/api";

export const runtime = "nodejs";

function cronAuthorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // do not break existing cron config

  const header = req.headers.get("x-cron-secret");
  const auth = req.headers.get("authorization");
  const bearer = auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length) : null;

  return header === secret || bearer === secret;
}

async function hit(
  path: string,
  headers?: Record<string, string>,
  method: "GET" | "POST" = "GET"
) {
  const base = requireEnv("APP_BASE_URL");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const res = await fetch(`${base}${path}`, {
      method,
      cache: "no-store",
      headers,
      signal: controller.signal,
    });

    const json = await res.json().catch(() => ({}));
    return { path, ok: res.ok, status: res.status, json };
  } catch (e: any) {
    return {
      path,
      ok: false,
      status: 0,
      json: { error: "fetch_failed", message: e?.message ?? String(e) },
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(req: Request) {
  try {
    if (!cronAuthorized(req)) {
      throw new HttpError(401, "Unauthorized cron request", {
        code: "CRON_UNAUTHORIZED",
      });
    }

    const cronSecret = process.env.CRON_SECRET;
    const headers = cronSecret ? { "x-cron-secret": cronSecret } : undefined;

    const results = [];

    // Pull external data (read-only)
    results.push(await hit("/api/stripe/customers", headers, "GET"));
    results.push(await hit("/api/stripe/invoices", headers, "GET"));
    results.push(await hit("/api/logic/expected-revenue", headers, "GET"));

    // ✅ ensure every customer has settings/state rows
    results.push(await hit("/api/logic/customer-defaults", headers, "GET"));

    // ✅ globally suppress alerts for inactive customers
    results.push(await hit("/api/logic/alerts/suppress-inactive", headers, "POST"));

    // Compute expectations + generate alerts
    results.push(await hit("/api/logic/alerts/missed", headers, "POST"));
    results.push(await hit("/api/logic/alerts/no-client-activity", headers, "POST"));
    results.push(await hit("/api/alerts/amount-drift", headers, "POST"));

    const ok = results.every((r) => r.ok);

    return jsonOk(
      { ran: true, ok, results },
      { status: ok ? 200 : 207 }
    );
  } catch (err) {
    return jsonErr(err);
  }
}
