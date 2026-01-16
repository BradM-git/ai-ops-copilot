import { getNotion } from "@/integrations/notion";
import { HttpError } from "@/lib/api";

type StaleItem = {
  title: string | null;
  url: string | null;
  lastEditedAt: string | null;
};

function daysAgoIso(days: number) {
  const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return d.toISOString();
}

function pageTitle(p: any): string | null {
  const props = p?.properties ?? {};
  for (const key of Object.keys(props)) {
    const v = props[key];
    if (v?.type === "title" && Array.isArray(v?.title)) {
      const t = v.title.map((x: any) => x?.plain_text ?? "").join("").trim();
      return t || null;
    }
  }
  return null;
}

/**
 * Single-DB stale activity summary.
 * - Env: NOTION_DB_MAIN
 * - Stale condition: last_edited_time before (now - thresholdDays)
 * - Aggregated output (one dataset)
 */
export async function getNotionStaleActivitySummary() {
  const notion: any = getNotion();

  const databaseId = process.env.NOTION_DB_MAIN;
  if (!databaseId) {
    throw new HttpError(500, "Missing env var NOTION_DB_MAIN", {
      code: "NOTION_ENV_MISSING",
      details: { key: "NOTION_DB_MAIN" },
    });
  }

  // Keep this dead simple. If you want a different number later, change this constant.
  const thresholdDays = 7;
  const beforeIso = daysAgoIso(thresholdDays);

  const res = await notion.databases.query({
    database_id: databaseId,
    filter: {
      timestamp: "last_edited_time",
      last_edited_time: { before: beforeIso },
    },
    sorts: [{ timestamp: "last_edited_time", direction: "ascending" }],
    page_size: 100,
  });

  const items: StaleItem[] = (res?.results ?? []).map((p: any) => ({
    title: pageTitle(p),
    url: p?.url ?? null,
    lastEditedAt: p?.last_edited_time ?? null,
  }));

  return {
    total: items.length,
    database: {
      label: "Notion Main Database",
      databaseId,
      thresholdDays,
      beforeIso,
      items,
    },
  };
}
