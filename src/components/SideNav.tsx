"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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
        "relative block rounded-lg px-3 py-2 text-sm font-semibold",
        isActive
          ? "text-[var(--ops-text)] bg-white/60"
          : "text-[var(--ops-text-secondary)] hover:bg-white/50 hover:text-[var(--ops-text)]",
        "focus:outline-none focus:ring-2 focus:ring-[var(--ops-focus)]",
      ].join(" ")}
    >
      {isActive ? (
        <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-full bg-[var(--ops-accent)]" />
      ) : null}
      <span className={isActive ? "pl-2" : ""}>{label}</span>
    </Link>
  );
}

function isActivePath(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export default function SideNav() {
  const pathname = usePathname() || "/";

  return (
    <div>
      <div className="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-[var(--ops-text-faint)]">
        Workspace
      </div>

      <nav className="space-y-1">
        <NavLink
          href="/"
          label="Attention"
          isActive={isActivePath(pathname, "/")}
        />
        <NavLink
          href="/debug"
          label="Debug"
          isActive={isActivePath(pathname, "/debug")}
        />
      </nav>

      <div className="mt-6 rounded-xl border border-[var(--ops-border)] bg-white/70 px-3 py-2">
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
