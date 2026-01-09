import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    nodeEnv: process.env.NODE_ENV,
    intuitEnv: process.env.INTUIT_ENV ?? null,
    intuitRedirect: process.env.INTUIT_REDIRECT_URI ?? null,
    intuitClientIdPrefix: process.env.INTUIT_CLIENT_ID
      ? process.env.INTUIT_CLIENT_ID.slice(0, 6)
      : null,
  });
}
