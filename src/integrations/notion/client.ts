import { Client } from "@notionhq/client";
import { requireEnv } from "@/lib/api";

export function getNotion() {
  const key = requireEnv("NOTION_API_KEY");
  return new Client({ auth: key });
}
