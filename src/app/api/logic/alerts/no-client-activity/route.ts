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

type CustomerSettings = {
  customer_id: string;
  jira_activity_lookback: string;
};

type CustomerState = {
  customer_id: string;
  status: string;
  reason: string | null;
};

function isActive(state: CustomerState | null) {
  const s = (state?.status || "active").toLowerCase();
  return s === "active";
}

async function jiraSearch(jql: string) {
  const baseUrl = requireEnv("JIRA_BASE_URL").replace(/\/$/, "");
  const basic = jiraAuthBasic();

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
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    throw new HttpError(res.status, "Jira query failed", {
      code: "JIRA_QUERY_FAILED",
      details: { jira_status: res.status, jira_body: json },
    });
  }

  const total = Number(json?.total ?? (json?.issues?.length ?? 0));
  const latestUpdatedAt = json?.issues?.[0]?.fields?.updated ?? null;
  const latestIssueKey = json?.issues?.[0]?.key ?? null;

  return { total, latestUpdatedAt, latestIssueKey };
}

async function getAnyJiraActivity(projectKey: string) {
  const jql = `project = ${projectKey} ORDER BY updated DESC`;
  return jiraSearch(jql);
}

async function getRecentJiraActivity(projectKey: string, lookback: string) {
  const jql = `project = ${projectKey} AND updated >= -${lookback} ORDER BY updated DESC`;
  return jiraSearch(jql);
}

function allowDebugOverride() {
  const enabled = process.env.DEBUG_FIXTURES_ENABLED === "true";
  if (process.env.NODE_ENV === "development") return true;
  return enabled;
}

function jiraNoActivityConfidenceReason(args: {
  lookback: string;
  historical_total: number;
  historical_latest_updated_at: string | null;
  historical_latest_issue_key: string | null;
}) {
  const lastSeen = args.historical_latest_updated_at ? new Date(args.historical_latest_updated_at).toISOString() : "unknown";
  const key = args.historical_latest_issue_key ?? "unknown";
  return [`history_total=${args.historical_total}`, `last_seen=${lastSeen}`, `last_issue=${key}`, `no_updates_within=${args.lookback}`].join(
    " · ",
  );
}

async function upsertIntegrationError(admin: ReturnType<typeof supabaseAdmin>, details: any) {
  const type = "integration_error";
  const primaryEntityType = "integration";
  const primaryEntityId = "jira";

  const { data: existing, error: eErr } = await admin
    .from("alerts")
    .select("id")
    .eq("type", type)
    .eq("status", "open")
    .eq("primary_entity_type", primaryEntityType)
    .eq("primary_entity_id", primaryEntityId)
    .maybeSingle();

  if (eErr) throw new HttpError(500, "Failed to read integration alert", { details: eErr });

  const payload = {
    customer_id: null,
    type,
    status: "open",
    message: "Jira data unavailable — cannot evaluate client activity.",
    amount_at_risk: null,
    source_system: "jira",
    primary_entity_type: primaryEntityType,
    primary_entity_id: primaryEntityId,
    confidence: "high",
    confidence_reason: "integration data unavailable",
    expected_amount_cents: null,
    observed_amount_cents: null,
    expected_at: null,
    observed_at: new Date().toISOString(),
    context: { source: "jira", error: details },
  };

  if (existing?.id) {
    const { error: uErr } = await admin.from("alerts").update(payload).eq("id", existing.id);
    if (uErr) throw new HttpError(500, "Failed to update integration alert", { details: uErr });
  } else {
    const { error: iErr } = await admin.from("alerts").insert(payload);
    if (iErr && (iErr as any).code !== "23505") throw new HttpError(500, "Failed to create integration alert", { details: iErr });
  }
}

async function resolveIntegrationErrorIfAny(admin: ReturnType<typeof supabaseAdmin>) {
  const { data: existing, error: eErr } = await admin
    .from("alerts")
    .select("id")
    .eq("type", "integration_error")
    .eq("status", "open")
    .eq("primary_entity_type", "integration")
    .eq("primary_entity_id", "jira")
    .maybeSingle();

  if (eErr) return;
  if (!existing?.id) return;

  await admin.from("alerts").update({ status: "resolved", confidence_reason: "auto-resolved: jira readable again" }).eq("id", existing.id);
}

export async function POST(req: Request) {
  try {
    const admin = supabaseAdmin();

    // Demo wiring (unchanged)
    const customerId = "934b9356-edb2-408f-a01c-cb9cedf88e69";
    const projectKey = "KAN";

    // Load per-client settings + state
    const { data: sRaw } = await admin.from("customer_settings").select("customer_id, jira_activity_lookback").eq("customer_id", customerId).maybeSingle();
    const { data: stRaw } = await admin.from("customer_state").select("customer_id, status, reason").eq("customer_id", customerId).maybeSingle();

    const settings = (sRaw || null) as CustomerSettings | null;
    const state = (stRaw || null) as CustomerState | null;

    // Default is settings or env or 7d
    let lookback = settings?.jira_activity_lookback || process.env.JIRA_ACTIVITY_LOOKBACK || "7d";

    // Optional override (debug toggles)
    let body: any = null;
    try {
      body = await req.json();
    } catch {
      body = null;
    }
    if (body?.lookback && allowDebugOverride()) {
      lookback = String(body.lookback);
    }

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

    // Suppress if customer isn't active
    if (!isActive(state)) {
      if (existingOpen?.id) {
        const { error: rErr } = await admin
          .from("alerts")
          .update({
            status: "resolved",
            confidence: "high",
            confidence_reason: `suppressed: customer_status=${state?.status || "unknown"}${state?.reason ? ` (${state.reason})` : ""}`,
            context: { suppression_reason: "customer_status", customer_status: state?.status, customer_reason: state?.reason || null },
          })
          .eq("id", existingOpen.id);
        if (rErr) throw new HttpError(500, rErr.message);
      }

      return jsonOk({ ok: true, created: 0, resolved: existingOpen?.id ? 1 : 0, reason: "suppressed_customer_status", lookback });
    }

    // Integration hardening: if Jira is down, do not create client alerts; create integration_error instead.
    let historical;
    try {
      historical = await getAnyJiraActivity(projectKey);
      // If we can read Jira again, auto-resolve any prior integration_error.
      await resolveIntegrationErrorIfAny(admin);
    } catch (err: any) {
      await upsertIntegrationError(admin, err instanceof HttpError ? { status: err.status, code: err.code, details: err.details } : { error: String(err) });

      if (existingOpen?.id) {
        const { error: rErr } = await admin
          .from("alerts")
          .update({
            status: "resolved",
            confidence: "high",
            confidence_reason: "suppressed: jira unavailable",
            context: { suppression_reason: "integration_error", source: "jira", lookback },
          })
          .eq("id", existingOpen.id);
        if (rErr) throw new HttpError(500, rErr.message);
      }

      return jsonOk({ ok: true, created: 0, resolved: existingOpen?.id ? 1 : 0, reason: "jira_unavailable", lookback });
    }

    // Drift-only hardening: if the project has never had activity, suppress (likely misconfig or inactive-by-design).
    if (historical.total === 0) {
      if (existingOpen?.id) {
        const { error: updErr } = await admin
          .from("alerts")
          .update({
            status: "resolved",
            confidence: "high",
            confidence_reason: "suppressed: no historical Jira activity (no evidence of prior delivery activity)",
            context: { suppression_reason: "no_historical_activity", lookback, source: "jira", project_key: projectKey },
          })
          .eq("id", existingOpen.id);

        if (updErr) throw new HttpError(500, updErr.message);
      }

      return jsonOk({ ok: true, created: 0, resolved: existingOpen?.id ? 1 : 0, reason: "suppressed_no_history", lookback });
    }

    const recent = await getRecentJiraActivity(projectKey, lookback);

    // Activity exists => resolve
    if (recent.total > 0) {
      if (existingOpen?.id) {
        const { error: updErr } = await admin
          .from("alerts")
          .update({
            status: "resolved",
            observed_at: recent.latestUpdatedAt,
            confidence: "high",
            confidence_reason: `activity_found latest=${recent.latestIssueKey ?? "unknown"} at ${recent.latestUpdatedAt ?? "unknown"} within ${lookback}`,
            context: {
              latest_issue_key: recent.latestIssueKey,
              latest_updated_at: recent.latestUpdatedAt,
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
        latestIssueKey: recent.latestIssueKey,
        latestUpdatedAt: recent.latestUpdatedAt,
      });
    }

    // No recent activity => create/keep open
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
        confidence_reason: jiraNoActivityConfidenceReason({
          lookback,
          historical_total: historical.total,
          historical_latest_updated_at: historical.latestUpdatedAt,
          historical_latest_issue_key: historical.latestIssueKey,
        }),
        expected_at: null,
        observed_at: null,
        expected_amount_cents: null,
        observed_amount_cents: null,
        context: {
          lookback,
          historical_total_issues: historical.total,
          historical_latest_issue_key: historical.latestIssueKey,
          historical_latest_updated_at: historical.latestUpdatedAt,
          source: "jira",
          project_key: projectKey,
        },
      });

      if (insErr && (insErr as any).code !== "23505") throw new HttpError(500, insErr.message);

      return jsonOk({ ok: true, created: insErr ? 0 : 1, resolved: 0, reason: "no_recent_activity", lookback });
    }

    return jsonOk({ ok: true, created: 0, resolved: 0, reason: "already_open", lookback });
  } catch (err) {
    return jsonErr(err);
  }
}
