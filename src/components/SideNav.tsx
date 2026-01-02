"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

function isActivePath(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname.startsWith(href);
}

function NavLink({
  href,
  label,
  isActive,
}: {
  href: string;
  label: string;
  isActive: boolean;
}) {
  return (
    <Link
      href={href}
      className={[
        "group flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ops-focus)]",
        isActive
          ? "bg-[var(--ops-surface)] text-[var(--ops-text)]"
          : "text-[var(--ops-text-muted)] hover:bg-[var(--ops-hover)] hover:text-[var(--ops-text)]",
      ].join(" ")}
    >
      <span
        className={[
          "h-5 w-1 rounded-full transition-colors",
          isActive ? "bg-[var(--ops-accent)]" : "bg-transparent",
        ].join(" ")}
      />
      <span>{label}</span>
    </Link>
  );
}

export default function SideNav() {
  const pathname = usePathname();

  return (
    <div>
      <div className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--ops-text-faint)]">
        Workspace
      </div>

      <nav className="space-y-1">
        <NavLink href="/" label="Attention" isActive={isActivePath(pathname, "/")} />
        <NavLink
          href="/debug"
          label="Debug"
          isActive={isActivePath(pathname, "/debug")}
        />
        <NavLink
          href="/settings"
          label="Settings"
          isActive={isActivePath(pathname, "/settings")}
        />
      </nav>

      <div className="mt-6 rounded-xl border border-[var(--ops-border)] bg-[var(--ops-surface)] px-3 py-2">
        <div className="text-xs font-semibold text-[var(--ops-text)]">
          Exception-first.
        </div>
        <div className="mt-0.5 text-xs text-[var(--ops-text-muted)]">
          Quiet when healthy.
        </div>
      </div>
    </div>
  );
}
