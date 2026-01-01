import { getNotion } from "@/integrations/notion";

async function databaseIdToDataSourceId(notion: any, databaseId: string): Promise<string> {
  const db = await notion.databases.retrieve({ database_id: databaseId });

  const dsId =
    db?.data_sources?.[0]?.id ??
    db?.data_sources?.[0]?.data_source_id ??
    (db as any)?.data_source_id ??
    null;

  if (!dsId) {
    throw new Error("Could not resolve data_source_id from database_id");
  }

  return dsId;
}

export async function testNotionRead() {
  const notion: any = getNotion();

  const databaseId = process.env.NOTION_DB_OPPS;
  if (!databaseId) throw new Error("NOTION_DB_OPPS not set");

  const dataSourceId = await databaseIdToDataSourceId(notion, databaseId);

  const res = await notion.dataSources.query({
    data_source_id: dataSourceId,
    page_size: 5,
  });

  console.log("Notion read OK. data_source_id:", dataSourceId, "rows:", res.results.length);
}
