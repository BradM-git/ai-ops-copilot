// src/app/api/integrations/jira/ping/route.ts
import { HttpError, jsonErr, jsonOk } from "@/lib/api";
import { jiraBaseUrl, jiraGet } from "@/integrations/jira";

export const runtime = "nodejs";

export async function GET() {
  try {
    const baseUrl = jiraBaseUrl();

    const res = await jiraGet("/rest/api/3/myself");

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
