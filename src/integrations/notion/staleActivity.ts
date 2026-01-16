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

async function databaseIdToDataSourceId(notion: any, databaseId: string): Promise<string> {
  const db = await notion.databases.retrieve({ database_id: databaseId });
  const dsId =
    db?.data_sources?.[0]?.id ??
    db?.data_sources?.[0]?.data_source_id ??
    (db as any)?.data_source_id ??
    null;

  if (!dsId) throw new Error("Could not resolve data_source_id from database_id");
  return dsId;
}

/**
 * Single-DB stale activity summary.
 * - Env: NOTION_DB_MAIN
 * - Stale condition: last_edited_time before (now - thresholdDays)
 * - Uses dataSources.query (matches existing Notion integration style in this codebase)
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

  const thresholdDays = 7;
  const beforeIso = daysAgoIso(thresholdDays);

  const dataSourceId = await databaseIdToDataSourceId(notion, databaseId);

  const res = await notion.dataSources.query({
    data_source_id: dataSourceId,
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
      dataSourceId,
      thresholdDays,
      beforeIso,
      items,
    },
  };
}
