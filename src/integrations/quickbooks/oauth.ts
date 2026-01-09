import OAuthClient from "intuit-oauth";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export function getIntuitOAuthClient() {
  return new OAuthClient({
    clientId: requireEnv("INTUIT_CLIENT_ID"),
    clientSecret: requireEnv("INTUIT_CLIENT_SECRET"),
    environment: (process.env.INTUIT_ENV ?? "sandbox") as "sandbox" | "production",
    redirectUri: requireEnv("INTUIT_REDIRECT_URI"),
  });
}
