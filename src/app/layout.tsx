// src/app/layout.tsx
import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { supabaseServer } from "@/lib/supabaseServer";
import { UserMenu } from "@/components/UserMenu";
import SideNav from "@/components/SideNav";

export const metadata: Metadata = {
  title: "AI Ops Copilot",
  description: "AI Ops Copilot",
};

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
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z" />
      <path d="M19.4 15a1.8 1.8 0 0 0 .36 1.98l.04.04a2.2 2.2 0 0 1-1.55 3.75 2.2 2.2 0 0 1-1.56-.65l-.04-.04a1.8 1.8 0 0 0-1.98-.36 1.8 1.8 0 0 0-1.08 1.64V21a2.2 2.2 0 0 1-4.4 0v-.05a1.8 1.8 0 0 0-1.08-1.64 1.8 1.8 0 0 0-1.98.36l-.04.04a2.2 2.2 0 0 1-3.11 0 2.2 2.2 0 0 1 0-3.11l.04-.04A1.8 1.8 0 0 0 4.6 15a1.8 1.8 0 0 0-1.64-1.08H2.9a2.2 2.2 0 0 1 0-4.4h.05A1.8 1.8 0 0 0 4.6 8.4a1.8 1.8 0 0 0-.36-1.98l-.04-.04a2.2 2.2 0 1 1 3.11-3.11l.04.04A1.8 1.8 0 0 0 9.33 3.6a1.8 1.8 0 0 0 1.08-1.64V1.9a2.2 2.2 0 0 1 4.4 0v.05a1.8 1.8 0 0 0 1.08 1.64 1.8 1.8 0 0 0 1.98-.36l.04-.04a2.2 2.2 0 0 1 3.11 3.11l-.04.04A1.8 1.8 0 0 0 19.4 8.4a1.8 1.8 0 0 0 1.64 1.08H21.1a2.2 2.2 0 0 1 0 4.4h-.05A1.8 1.8 0 0 0 19.4 15z" />
    </svg>
  );
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  const user = data.user;

  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col bg-[var(--ops-bg)] text-[var(--ops-text)]">
        <header className="sticky top-0 z-50 border-b border-[var(--ops-border)] bg-[rgba(31,41,55,0.06)] backdrop-blur">
          <div className="h-[3px] w-full bg-[var(--ops-brand-line)]" />

          <div className="flex h-16 w-full items-center justify-between px-4 sm:px-6">
            <Link
              href="/"
              className="flex items-center rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--ops-focus)]"
              title="Home"
            >
              <span className="sr-only">Home</span>
            </Link>

            <div className="flex items-center gap-2">
              {user ? (
                <>
                  <IconLink href="/settings" label="Settings">
                    <CogIcon />
                  </IconLink>

                  <UserMenu
                    email={user.email}
                    fullName={
                      (user.user_metadata?.full_name ||
                        user.user_metadata?.name ||
                        null) as any
                    }
                  />
                </>
              ) : null}
            </div>
          </div>
        </header>

        <div className="grid w-full flex-1 grid-cols-1 sm:grid-cols-[240px_1fr]">
          <aside
            className="hidden border-r border-[var(--ops-border)] sm:block"
            style={{ background: "var(--ops-rail-bg)" }}
          >
            <div className="sticky top-16 px-3 py-4">
              <SideNav />
            </div>
          </aside>

          <main className="min-w-0 px-4 py-6 sm:px-6">{children}</main>
        </div>

        <footer
          className="mt-auto border-t border-[var(--ops-border)]"
          style={{ background: "var(--ops-footer-bg)" }}
        >
          <div className="flex w-full items-center justify-between px-4 py-4 text-sm sm:px-6">
            <div className="text-[var(--ops-text-muted)]">© 2026</div>
            <div />
          </div>
        </footer>
      </body>
    </html>
  );
}
