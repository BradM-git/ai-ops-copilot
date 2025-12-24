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

async function hit(path: string, headers?: Record<string, string>) {
  const base = requireEnv("APP_BASE_URL");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const res = await fetch(`${base}${path}`, {
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
      throw new HttpError(401, "Unauthorized cron request", { code: "CRON_UNAUTHORIZED" });
    }

    const cronSecret = process.env.CRON_SECRET;
    const headers = cronSecret ? { "x-cron-secret": cronSecret } : undefined;

    const results = [];
    results.push(await hit("/api/stripe/customers", headers));
    results.push(await hit("/api/stripe/invoices", headers));
    results.push(await hit("/api/logic/expected-revenue", headers));
    results.push(await hit("/api/logic/alerts/missed", headers));

    const ok = results.every((r) => r.ok);

    return jsonOk(
      { ran: true, ok, results },
      { status: ok ? 200 : 207 } // 207 = multi-status (partial failure)
    );
  } catch (err) {
    return jsonErr(err);
  }
}
