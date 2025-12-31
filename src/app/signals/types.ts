export type SignalSource = "stripe" | "jira" | "notion" | "quickbooks";

export type SignalInstance = {
  externalId: string;   // stable id from tool
  title: string;        // human label
  url?: string;         // deep link if available
  lastUpdatedAt?: string;
  ageDays?: number;
};

export type SignalResult = {
  customerId: string;
  source: SignalSource;
  alertType: string;    // stable key: e.g. "notion_pipeline_stale"
  title: string;        // card title
  summary: string;      // 1–2 line summary
  instances: SignalInstance[];
};
