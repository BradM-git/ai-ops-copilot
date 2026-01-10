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
        "relative flex items-center rounded-xl px-3 py-2 text-sm",
        isActive
          ? "bg-[var(--ops-surface-2)] text-[var(--ops-text)]"
          : "text-[var(--ops-text-muted)] hover:bg-[var(--ops-surface-2)] hover:text-[var(--ops-text)]",
      ].join(" ")}
    >
      {/* Left rail */}
      {isActive ? (
        <span
          aria-hidden
          className="absolute left-1 top-1 bottom-1 w-1 rounded-full bg-[var(--ops-accent)]"
        />
      ) : null}

      <span className="ml-3 font-medium">{label}</span>
    </Link>
  );
}

export default function SideNav() {
  const pathname = usePathname() || "/";

  return (
    <div className="w-full">
      <nav className="space-y-1">
        <NavLink href="/" label="Attention" isActive={isActivePath(pathname, "/")} />
        <NavLink
          href="/how-it-works"
          label="How it works"
          isActive={isActivePath(pathname, "/how-it-works")}
        />
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
