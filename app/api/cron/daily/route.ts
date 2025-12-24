export const runtime = "nodejs";

async function hit(path: string) {
  const base = process.env.APP_BASE_URL!;
  const res = await fetch(`${base}${path}`, { cache: "no-store" });
  const json = await res.json().catch(() => ({}));
  return { path, ok: res.ok, status: res.status, json };
}

export async function GET() {
  if (!process.env.APP_BASE_URL) {
    return Response.json({ error: "Missing APP_BASE_URL" }, { status: 500 });
  }

  const results = [];
  results.push(await hit("/api/stripe/customers"));
  results.push(await hit("/api/stripe/invoices"));
  results.push(await hit("/api/logic/expected-revenue"));
  results.push(await hit("/api/logic/alerts/missed"));

  return Response.json({ ran: true, results });
}
