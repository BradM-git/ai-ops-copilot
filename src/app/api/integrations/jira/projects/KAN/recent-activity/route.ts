// src/app/api/integrations/jira/projects/KAN/recent-activity/route.ts
import { jsonErr, jsonOk, requireEnv } from "@/lib/api";

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

    // JQL: any issue in the project updated in the last 7 days
    const jql = `project = KAN AND updated >= -7d ORDER BY updated DESC`;

    const url = new URL(`${baseUrl}/rest/api/3/search/jql`);
    url.searchParams.set("jql", jql);
    url.searchParams.set("maxResults", "5");
    url.searchParams.set("fields", "key,summary,updated,status");

    const res = await fetch(url.toString(), {
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
      return jsonOk({
        ok: false,
        jira_status: res.status,
        jira_body: json,
      });
    }

    const issues = (json?.issues || []).map((i: any) => ({
      key: i?.key ?? null,
      summary: i?.fields?.summary ?? null,
      updated: i?.fields?.updated ?? null,
      status: i?.fields?.status?.name ?? null,
    }));

    return jsonOk({
      ok: true,
      projectKey: "KAN",
      lookbackDays: 7,
      count: issues.length,
      issues,
    });
  } catch (err) {
    return jsonErr(err);
  }
}
