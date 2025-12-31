// src/app/layout.tsx
import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import "./globals.css";

export const metadata: Metadata = {
  title: "GIMO",
  description: "AI Ops Copilot",
};

function NavLink({
  href,
  label,
  isActive = false,
}: {
  href: string;
  label: string;
  isActive?: boolean;
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

function IconLink({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--ops-border)] bg-white text-[var(--ops-icon)] hover:bg-[var(--ops-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--ops-focus)]"
    >
      {children}
    </Link>
  );
}

function CogIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z" />
      <path d="M19.4 15a1.8 1.8 0 0 0 .36 1.98l.04.04a2.2 2.2 0 0 1-1.55 3.75 2.2 2.2 0 0 1-1.56-.65l-.04-.04a1.8 1.8 0 0 0-1.98-.36 1.8 1.8 0 0 0-1.08 1.64V21a2.2 2.2 0 0 1-4.4 0v-.05a1.8 1.8 0 0 0-1.08-1.64 1.8 1.8 0 0 0-1.98.36l-.04.04a2.2 2.2 0 0 1-3.11 0 2.2 2.2 0 0 1 0-3.11l.04-.04A1.8 1.8 0 0 0 4.6 15a1.8 1.8 0 0 0-1.64-1.08H2.9a2.2 2.2 0 0 1 0-4.4h.05A1.8 1.8 0 0 0 4.6 8.4a1.8 1.8 0 0 0-.36-1.98l-.04-.04a2.2 2.2 0 1 1 3.11-3.11l.04.04A1.8 1.8 0 0 0 9.33 3.6a1.8 1.8 0 0 0 1.08-1.64V1.9a2.2 2.2 0 0 1 4.4 0v.05a1.8 1.8 0 0 0 1.08 1.64 1.8 1.8 0 0 0 1.98-.36l.04-.04a2.2 2.2 0 0 1 3.11 3.11l-.04.04A1.8 1.8 0 0 0 19.4 8.4a1.8 1.8 0 0 0 1.64 1.08H21.1a2.2 2.2 0 0 1 0 4.4h-.05A1.8 1.8 0 0 0 19.4 15z" />
    </svg>
  );
}

function ProfileIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="8" r="3" />
      <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
    </svg>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      {/* Flex column so footer can push to bottom */}
      <body className="flex min-h-screen flex-col bg-[var(--ops-bg)] text-[var(--ops-text)]">
        {/* Header locked at top while scrolling */}
        <header className="sticky top-0 z-50 border-b border-[var(--ops-border)] bg-white/70 backdrop-blur">
          <div className="h-[2px] w-full bg-[var(--ops-brand-line)]" />

          <div className="flex h-16 w-full items-center justify-between px-4 sm:px-6">
            <Link
              href="/"
              className="flex items-end rounded-lg pb-1 pl-1 focus:outline-none focus:ring-2 focus:ring-[var(--ops-focus)]"
              title="Home"
            >
              <div className="relative h-16 w-[240px] overflow-hidden">
                <Image src="/brand/gimo-logo.png" alt="GIMO" fill className="object-contain object-left" priority />
              </div>
            </Link>

            <div className="flex items-center gap-2">
              <Link
                href="/join"
                className="hidden sm:inline-flex rounded-lg bg-[var(--ops-accent-dark)] px-3 py-2 text-sm font-semibold text-white hover:opacity-95 focus:outline-none focus:ring-2 focus:ring-[var(--ops-focus)]"
              >
                Sign up
              </Link>

              <IconLink href="/settings" label="Settings">
                <CogIcon />
              </IconLink>

              <IconLink href="/profile" label="Profile">
                <ProfileIcon />
              </IconLink>
            </div>
          </div>
        </header>

        {/* Main shell grows to fill available height */}
        <div className="grid w-full flex-1 grid-cols-1 sm:grid-cols-[240px_1fr]">
          <aside
            className="hidden border-r border-[var(--ops-border)] sm:block"
            style={{ background: "var(--ops-rail-bg)" }}
          >
            <div className="sticky top-16 px-3 py-4">
              <div className="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-[var(--ops-text-faint)]">
                Workspace
              </div>

              <nav className="space-y-1">
                <NavLink href="/" label="Attention" isActive />
                <NavLink href="/customers" label="Customers" />
                <NavLink href="/integrations" label="Integrations" />
                <NavLink href="/rules" label="Rules & Thresholds" />
                <NavLink href="/debug" label="Debug" />
              </nav>

              <div className="mt-6 px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-[var(--ops-text-faint)]">
                Later
              </div>
              <nav className="space-y-1">
                <NavLink href="/history" label="Resolved history" />
                <NavLink href="/notifications" label="Notifications" />
                <NavLink href="/team" label="Team" />
              </nav>

              <div className="mt-4 rounded-xl border border-[var(--ops-border)] bg-white/70 px-3 py-2">
                <div className="text-xs font-semibold text-[var(--ops-text)]">Quiet confidence.</div>
                <div className="mt-0.5 text-xs text-[var(--ops-text-muted)]">Exception-first. No dashboards.</div>
              </div>
            </div>
          </aside>

          <main className="min-w-0 px-4 py-6 sm:px-6">{children}</main>
        </div>

        {/* Footer locked to bottom on short pages */}
        <footer className="mt-auto border-t border-[var(--ops-border)]" style={{ background: "var(--ops-footer-bg)" }}>
          <div className="flex w-full items-center justify-between px-4 py-4 text-sm sm:px-6">
            <div className="text-[var(--ops-text-muted)]">© 2026 GIMO</div>
            <div className="flex items-center gap-4">
              <a className="text-[var(--ops-text-muted)] hover:text-[var(--ops-text)]" href="/about">
                About
              </a>
              <a className="text-[var(--ops-text-muted)] hover:text-[var(--ops-text)]" href="/privacy">
                Privacy
              </a>
              <a className="text-[var(--ops-text-muted)] hover:text-[var(--ops-text)]" href="/contact">
                Contact
              </a>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
