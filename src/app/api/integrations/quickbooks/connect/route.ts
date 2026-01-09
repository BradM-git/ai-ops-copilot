// src/app/api/integrations/quickbooks/connect/route.ts
import { NextResponse } from "next/server";
import { getCurrentCustomerId } from "@/lib/currentCustomer";
import { getIntuitOAuthClient } from "@/integrations/quickbooks/oauth";

export const dynamic = "force-dynamic";

function baseUrlFromRequest(req: Request) {
  const u = new URL(req.url);
  return `${u.protocol}//${u.host}`;
}

function redirectToLogin(req: Request, returnTo: string) {
  const base = baseUrlFromRequest(req);
  const url = new URL("/login", base);
  url.searchParams.set("returnTo", returnTo);
  url.searchParams.set("quickbooks", "auth_required");
  return NextResponse.redirect(url, 307);
}

export async function HEAD(req: Request) {
  return GET(req);
}

export async function GET(req: Request) {
  let customerId: string | null = null;
  try {
    customerId = await getCurrentCustomerId();
  } catch {
    customerId = null;
  }
  if (!customerId) {
    return redirectToLogin(req, "/api/integrations/quickbooks/connect");
  }

  const oauth = getIntuitOAuthClient();

  const authUri = oauth.authorizeUri({
    scope: ["com.intuit.quickbooks.accounting"],
    state: JSON.stringify({
      customerId,
      ts: Date.now(),
    }),
  });

  console.log("[qbo connect] authUri:", authUri);

  return NextResponse.redirect(authUri, 307);
}
