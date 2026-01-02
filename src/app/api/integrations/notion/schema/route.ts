// src/app/api/integrations/notion/schema/route.ts
import { jsonErr, jsonOk, requireEnv } from "@/lib/api";
import { getNotion } from "@/integrations/notion";

export const runtime = "nodejs";

async function databaseIdToDataSourceId(notion: any, databaseId: string): Promise<string> {
  const db = await notion.databases.retrieve({ database_id: databaseId });

  const dsId =
    db?.data_sources?.[0]?.id ??
    db?.data_sources?.[0]?.data_source_id ??
    db?.data_source_id ??
    null;

  if (!dsId) throw new Error("Could not resolve data_source_id from database_id");

  return dsId;
}

export async function GET() {
  try {
    const notion: any = getNotion();
    const databaseId = requireEnv("NOTION_DB_OPPS");

    const dataSourceId = await databaseIdToDataSourceId(notion, databaseId);

    // THIS is where schema typically lives now
    const ds = await notion.dataSources.retrieve({ data_source_id: dataSourceId });

    return jsonOk({
      ok: true,
      database_id: databaseId,
      data_source_id: dataSourceId,
      title: ds?.title?.[0]?.plain_text ?? null,
      properties: ds?.properties ?? {},
    });
  } catch (err) {
    return jsonErr(err);
  }
}
