// src/components/AlertViewSelect.tsx
"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

type SortKey = "urgency" | "recent";

const LABELS: Record<SortKey, string> = {
  urgency: "Urgency",
  recent: "Most recent",
};

export default function AlertViewSelect() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const current = (searchParams.get("sort") as SortKey) || "urgency";

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value as SortKey;

    const params = new URLSearchParams(searchParams.toString());

    // default sort: keep URL clean (no ?sort=)
    if (next === "urgency") params.delete("sort");
    else params.set("sort", next);

    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <div className="flex items-center gap-2">
      <div className="text-xs font-semibold text-[var(--ops-text-muted)]">Sort by</div>

      <select
        value={current}
        onChange={onChange}
        className="rounded-lg border border-[var(--ops-border)] bg-[var(--ops-surface)] px-2 py-1 text-xs text-[var(--ops-text)]"
        aria-label="Sort alerts"
      >
        {Object.entries(LABELS).map(([k, label]) => (
          <option key={k} value={k}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}
