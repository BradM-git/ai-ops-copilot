"use client";

import { useEffect, useMemo, useState } from "react";

type UserMenuProps = {
  email?: string | null;
  fullName?: string | null;
};

function initialsFrom(email?: string | null, fullName?: string | null) {
  const name = (fullName || "").trim();
  const base = name || (email?.split("@")[0] || "").trim() || "User";
  const parts = base.split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return "U";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function UserMenu({ email, fullName }: UserMenuProps) {
  const initials = useMemo(() => initialsFrom(email, fullName), [email, fullName]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!open) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("[data-user-menu-root]")) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  return (
    <div className="relative" data-user-menu-root>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Account"
        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--ops-border)] bg-white text-xs font-semibold text-[var(--ops-text)] hover:bg-[var(--ops-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--ops-focus)]"
      >
        {initials}
      </button>

      {open ? (
        <div className="absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-xl border border-[var(--ops-border)] bg-white shadow-lg">
          <div className="px-3 py-2">
            <div className="text-xs font-semibold text-[var(--ops-text)]">Signed in</div>
            <div className="mt-0.5 truncate text-xs text-[var(--ops-text-muted)]">{email || ""}</div>
          </div>

          <div className="h-px bg-[var(--ops-border)]" />

          <div className="p-1">
            <a
              href="/auth/logout"
              onClick={() => setOpen(false)}
              className="block rounded-lg px-3 py-2 text-sm text-[var(--ops-text)] hover:bg-[var(--ops-hover)]"
            >
              Log out
            </a>
          </div>
        </div>
      ) : null}
    </div>
  );
}
