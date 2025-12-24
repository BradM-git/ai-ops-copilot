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
      error: {
        message: e.message,
        code: e.code,
        details: process.env.NODE_ENV === "development" ? e.details : undefined,
      },
    },
    { status: e.status }
  );
}
