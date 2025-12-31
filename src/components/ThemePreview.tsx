// src/components/ThemePreview.tsx
"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Dev-only palette preview via query param:
 *   /?theme=slate|stone|midnight
 *
 * No UI. No product behavior changes.
 */
export default function ThemePreview() {
  const searchParams = useSearchParams();

  useEffect(() => {
    // Don’t ship theme switching as a product surface.
    // In production, this will simply default to :root values unless you keep it intentionally.
    const t = (searchParams.get("theme") || "slate").toLowerCase();

    const allowed = new Set(["slate", "stone", "midnight"]);
    const theme = allowed.has(t) ? t : "slate";

    document.documentElement.dataset.theme = theme;
  }, [searchParams]);

  return null;
}
