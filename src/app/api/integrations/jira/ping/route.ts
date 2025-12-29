// src/app/api/integrations/jira/ping/route.ts
import { HttpError, jsonErr, jsonOk, requireEnv } from "@/lib/api";

export const runtime = "nodejs";

function jiraAuthHeader() {
  const email = requireEnv("JIRA_EMAIL");
  const token = requireEnv("JIRA_API_TOKEN");
  const basic = Buffer.from(`${email}:${token}`).toString("base64");
  return `Basic ${basic}`;
}

export async function GET() {
  try {
    const baseUrl = requireEnv("JIRA_BASE_URL").replace(/\/$/, "");

    const res = await fetch(`${baseUrl}/rest/api/3/myself`, {
      headers: {
        Authorization: jiraAuthHeader(),
        Accept: "application/json",
      },
      cache: "no-store",
    });

    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }

    if (!res.ok) {
      throw new HttpError(res.status, "Jira ping failed", {
    code: "JIRA_PING_FAILED",
    details: {
      jira_status: res.status,
      jira_body: json,
    },
  });
    }

    return jsonOk({
      ok: true,
      baseUrl,
      user: {
        displayName: json?.displayName ?? null,
        accountId: json?.accountId ?? null,
      },
    });
  } catch (err) {
    return jsonErr(err);
  }
}
