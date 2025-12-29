// src/app/api/logic/alerts/no-client-activity/route.ts
import { HttpError, jsonErr, jsonOk, requireEnv } from "@/lib/api";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function supabaseAdmin() {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

function jiraAuthBasic() {
  const email = requireEnv("JIRA_EMAIL");
  const token = requireEnv("JIRA_API_TOKEN");
  return Buffer.from(`${email}:${token}`).toString("base64");
}

async function getRecentJiraActivityCount(projectKey: string, lookback: string) {
  const baseUrl = requireEnv("JIRA_BASE_URL").replace(/\/$/, "");
  const basic = jiraAuthBasic();

  // lookback examples: "7d", "1d", "1h", "1m"
  const jql = `project = ${projectKey} AND updated >= -${lookback} ORDER BY updated DESC`;

  const url = new URL(`${baseUrl}/rest/api/3/search/jql`);
  url.searchParams.set("jql", jql);
  url.searchParams.set("maxResults", "1");
  url.searchParams.set("fields", "key,updated");

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Basic ${basic}`,
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
    throw new HttpError(res.status, "Jira activity check failed", {
  code: "JIRA_ACTIVITY_CHECK_FAILED",
  details: {
    jira_status: res.status,
    jira_body: json,
  },
});
  }

  const count = Number(json?.total ?? (json?.issues?.length ?? 0));
  const latestUpdatedAt = json?.issues?.[0]?.fields?.updated ?? null;
  const latestIssueKey = json?.issues?.[0]?.key ?? null;

  return { count, latestUpdatedAt, latestIssueKey };
}

function allowDebugOverride() {
  // Debug toggles hit this endpoint; allow override in dev OR when explicitly enabled.
  const enabled = process.env.DEBUG_FIXTURES_ENABLED === "true";
  if (process.env.NODE_ENV === "development") return true;
  return enabled;
}

export async function POST(req: Request) {
  try {
    const admin = supabaseAdmin();

    // For now: we target the demo customer you already created.
    // Later we’ll map Jira project -> customer dynamically.
    const customerId = "934b9356-edb2-408f-a01c-cb9cedf88e69";

    // For now: single demo “client workspace” = Jira project KAN
    const projectKey = "KAN";

    // Default is env var or 7d
    let lookback = process.env.JIRA_ACTIVITY_LOOKBACK ?? "7d";

    // Optional override (used by debug toggles)
    let body: any = null;
    try {
      body = await req.json();
    } catch {
      body = null;
    }

    if (body?.lookback && allowDebugOverride()) {
      lookback = String(body.lookback);
    }

    const { count, latestUpdatedAt, latestIssueKey } = await getRecentJiraActivityCount(projectKey, lookback);

    const alertType = "no_recent_client_activity";
    const sourceSystem = "jira";

    const { data: existingOpen, error: exErr } = await admin
      .from("alerts")
      .select("id")
      .eq("customer_id", customerId)
      .eq("type", alertType)
      .eq("status", "open")
      .maybeSingle();

    if (exErr) throw new HttpError(500, exErr.message);

    // If there IS activity: resolve any open alert
    if (count > 0) {
      if (existingOpen?.id) {
        const { error: updErr } = await admin
          .from("alerts")
          .update({
            status: "resolved",
            observed_at: latestUpdatedAt,
            context: {
              latest_issue_key: latestIssueKey,
              latest_updated_at: latestUpdatedAt,
              lookback,
              source: "jira",
              project_key: projectKey,
            },
          })
          .eq("id", existingOpen.id);

        if (updErr) throw new HttpError(500, updErr.message);
      }

      return jsonOk({
        ok: true,
        created: 0,
        resolved: existingOpen?.id ? 1 : 0,
        reason: "recent_activity_found",
        lookback,
        latestIssueKey,
        latestUpdatedAt,
      });
    }

    // If there is NO activity: create (or keep) an open alert
    if (!existingOpen?.id) {
      const { error: insErr } = await admin.from("alerts").insert({
        customer_id: customerId,
        type: alertType,
        status: "open",
        message: `No visible client activity in the last ${lookback}.`,
        amount_at_risk: null,
        source_system: sourceSystem,
        primary_entity_type: "customer",
        primary_entity_id: customerId,
        confidence: "medium",
        confidence_reason: `No Jira issues updated in the last ${lookback}.`,
        expected_at: null,
        observed_at: null,
        expected_amount_cents: null,
        observed_amount_cents: null,
        context: {
          lookback,
          source: "jira",
          project_key: projectKey,
        },
      });

      if (insErr) throw new HttpError(500, insErr.message);

      return jsonOk({ ok: true, created: 1, resolved: 0, reason: "no_recent_activity", lookback });
    }

    return jsonOk({ ok: true, created: 0, resolved: 0, reason: "already_open", lookback });
  } catch (err) {
    return jsonErr(err);
  }
}
