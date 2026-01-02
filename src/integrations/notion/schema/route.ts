import { jsonErr, jsonOk } from "@/lib/api";
import { getNotion } from "@/integrations/notion";

export const runtime = "nodejs";

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

export async function GET() {
  try {
    const notion: any = getNotion();

    const keys = ["NOTION_DB_OPPS", "NOTION_DB_OPS", "NOTION_DB_INTERNAL_PROJECTS"] as const;

    const out: any[] = [];

    for (const k of keys) {
      const databaseId = process.env[k];
      if (!databaseId) {
        out.push({ env: k, ok: false, error: "missing env var" });
        continue;
      }

      const db = await notion.databases.retrieve({ database_id: databaseId });
      const dataSourceId = await databaseIdToDataSourceId(notion, databaseId);

      const props = db?.properties ?? {};
      const propertyNames = Object.keys(props).sort();

      out.push({
        env: k,
        ok: true,
        databaseId,
        dataSourceId,
        title: (db?.title ?? []).map((t: any) => t?.plain_text ?? "").join(""),
        propertyNames,
        propertyTypes: Object.fromEntries(
          Object.entries(props).map(([name, v]: any) => [name, v?.type ?? null])
        ),
      });
    }

    return jsonOk({ ok: true, databases: out });
  } catch (err) {
    return jsonErr(err);
  }
}
