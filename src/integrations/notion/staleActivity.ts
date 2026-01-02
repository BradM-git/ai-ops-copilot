import { getNotion } from "@/integrations/notion";
import { HttpError } from "@/lib/api";

type StaleItem = {
  title: string | null;
  url: string | null;
  lastEditedAt: string | null;
  status: string | null;
};

type BucketResult = {
  bucket: string;
  thresholdDays: number;
  propertyName: string;
  statuses: string[];
  items: StaleItem[];
};

type DataSourceConfig = {
  label: string;
  databaseEnvKey: "NOTION_DB_OPPS" | "NOTION_DB_OPS" | "NOTION_DB_INTERNAL_PROJECTS";
  buckets: Array<{
    bucket: string;
    thresholdDays: number;
    propertyName: string;
    statuses: string[];
  }>;
};

const CONFIGS: DataSourceConfig[] = [
  // A) Opportunities & Relationships
  {
    label: "Opportunities & Relationships",
    databaseEnvKey: "NOTION_DB_OPPS",
    buckets: [
      {
        bucket: "Qualified Opportunity (7d)",
        thresholdDays: 7,
        propertyName: "Status",
        statuses: ["Qualified Opportunity"],
      },
      {
        bucket: "Proposal Stage (5d)",
        thresholdDays: 5,
        propertyName: "Status",
        statuses: ["Proposal Stage"],
      },
      {
        bucket: "In Negotiation (3d)",
        thresholdDays: 3,
        propertyName: "Status",
        statuses: ["In Negotiation"],
      },
    ],
  },

  // B) Ops Dashboard
  {
    label: "Ops Dashboard",
    databaseEnvKey: "NOTION_DB_OPS",
    buckets: [
      { bucket: "In Progress (7d)", thresholdDays: 7, propertyName: "Status", statuses: ["In Progress"] },
      { bucket: "Plan (30d)", thresholdDays: 30, propertyName: "Status", statuses: ["Plan"] },
    ],
  },

  // C) Internal Projects
  {
    label: "Internal Projects",
    databaseEnvKey: "NOTION_DB_INTERNAL_PROJECTS",
    buckets: [
      { bucket: "In Progress (7d)", thresholdDays: 7, propertyName: "Project Status", statuses: ["In Progress"] },
    ],
  },
];

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

function statusValue(p: any, propertyName: string): string | null {
  const prop = p?.properties?.[propertyName];
  if (!prop) return null;

  // Notion returns lowercase types like "status" / "select"
  if (prop.type === "status") return prop.status?.name ?? null;
  if (prop.type === "select") return prop.select?.name ?? null;

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

type PropType = "status" | "select";

async function getPropertyType(
  notion: any,
  dataSourceId: string,
  propertyName: string
): Promise<PropType> {
  const ds = await notion.dataSources.retrieve({ data_source_id: dataSourceId });
  const prop = ds?.properties?.[propertyName];
  const t = prop?.type;

  if (t === "status") return "status";
  if (t === "select") return "select";

  throw new Error(`Unsupported or missing property "${propertyName}" on dataSource ${dataSourceId} (type=${t})`);
}

async function queryStaleItems(args: {
  notion: any;
  dataSourceId: string;
  beforeIso: string;
  propertyName: string;
  propertyType: PropType;
  statuses: string[];
  pageSize?: number;
}): Promise<StaleItem[]> {
  const pageSize = args.pageSize ?? 25;

  // Build OR filter for status/select correctly per database
  const statusOr =
    args.propertyType === "status"
      ? args.statuses.map((s) => ({
          property: args.propertyName,
          status: { equals: s },
        }))
      : args.statuses.map((s) => ({
          property: args.propertyName,
          select: { equals: s },
        }));

  const filter = {
    and: [
      { timestamp: "last_edited_time", last_edited_time: { before: args.beforeIso } },
      { or: statusOr },
    ],
  };

  const res = await args.notion.dataSources.query({
    data_source_id: args.dataSourceId,
    filter,
    sorts: [{ timestamp: "last_edited_time", direction: "ascending" }],
    page_size: pageSize,
  });

  return (res?.results ?? []).map((p: any) => ({
    title: pageTitle(p),
    url: p?.url ?? null,
    lastEditedAt: p?.last_edited_time ?? null,
    status: statusValue(p, args.propertyName),
  }));
}

export async function getNotionStaleActivitySummary() {
  const notion: any = getNotion();

  // Cache property types per data source + property name to avoid repeated retrieves
  const propTypeCache = new Map<string, PropType>();

  const dataSources: Array<{
    label: string;
    databaseId: string;
    dataSourceId: string;
    buckets: BucketResult[];
  }> = [];

  for (const cfg of CONFIGS) {
    const databaseId = process.env[cfg.databaseEnvKey];
    if (!databaseId) {
      throw new HttpError(500, `Missing env var ${cfg.databaseEnvKey}`, {
        code: "NOTION_ENV_MISSING",
        details: { key: cfg.databaseEnvKey },
      });
    }

    const dataSourceId = await databaseIdToDataSourceId(notion, databaseId);

    const buckets: BucketResult[] = [];
    for (const b of cfg.buckets) {
      const beforeIso = daysAgoIso(b.thresholdDays);

      const cacheKey = `${dataSourceId}::${b.propertyName}`;
      let propertyType = propTypeCache.get(cacheKey);
      if (!propertyType) {
        propertyType = await getPropertyType(notion, dataSourceId, b.propertyName);
        propTypeCache.set(cacheKey, propertyType);
      }

      const items = await queryStaleItems({
        notion,
        dataSourceId,
        beforeIso,
        propertyName: b.propertyName,
        propertyType,
        statuses: b.statuses,
        pageSize: 50,
      });

      buckets.push({
        bucket: b.bucket,
        thresholdDays: b.thresholdDays,
        propertyName: b.propertyName,
        statuses: b.statuses,
        items,
      });
    }

    dataSources.push({ label: cfg.label, databaseId, dataSourceId, buckets });
  }

  const total = dataSources.reduce(
    (sum, ds) => sum + ds.buckets.reduce((s2, b) => s2 + b.items.length, 0),
    0
  );

  return { total, dataSources };
}
