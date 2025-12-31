import { requireEnv } from "@/lib/api";

export function jiraAuthHeader() {
  const email = requireEnv("JIRA_EMAIL");
  const token = requireEnv("JIRA_API_TOKEN");
  const basic = Buffer.from(`${email}:${token}`).toString("base64");
  return `Basic ${basic}`;
}

export function jiraBaseUrl() {
  return requireEnv("JIRA_BASE_URL").replace(/\/$/, "");
}

export async function jiraGet(path: string) {
  const baseUrl = jiraBaseUrl();

  return fetch(`${baseUrl}${path}`, {
    headers: {
      Authorization: jiraAuthHeader(),
      Accept: "application/json",
    },
    cache: "no-store",
  });
}
