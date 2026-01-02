// src/lib/api.ts
import { NextResponse } from "next/server";

export type ApiOk<T> = { ok: true; data: T };
export type ApiErr = {
  ok: false;
  error: { message: string; code?: string; details?: unknown };
};

export class HttpError extends Error {
  status: number;
  code?: string;
  details?: unknown;

  constructor(status: number, message: string, opts?: { code?: string; details?: unknown }) {
    super(message);
    this.status = status;
    this.code = opts?.code;
    this.details = opts?.details;
  }
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new HttpError(500, `Missing required env var: ${name}`, { code: "MISSING_ENV" });
  return v;
}

export function cronAuthorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // do not break existing cron config

  const header = req.headers.get("x-cron-secret");
  const auth = req.headers.get("authorization");
  const bearer = auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length) : null;

  return header === secret || bearer === secret;
}

export function requireCron(req: Request) {
  if (!cronAuthorized(req)) {
    throw new HttpError(401, "Unauthorized cron request", { code: "CRON_UNAUTHORIZED" });
  }
}

export function jsonOk<T>(data: T, init?: ResponseInit) {
  return NextResponse.json<ApiOk<T>>({ ok: true, data }, { status: 200, ...init });
}

export function jsonErr(err: unknown) {
  const e =
    err instanceof HttpError
      ? err
      : err instanceof Error
        ? new HttpError(500, err.message || "Internal Server Error", { code: "INTERNAL" })
        : new HttpError(500, "Internal Server Error", { code: "INTERNAL" });

  return NextResponse.json<ApiErr>(
    {
      ok: false,
      error: { message: e.message, code: e.code, details: e.details },
    },
    { status: e.status }
  );
}
