// src/app/layout.tsx
import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { supabaseServer } from "@/lib/supabaseServer";
import { UserMenu } from "@/components/UserMenu";

export const metadata: Metadata = {
  title: "Ops Copilot (Alpha)",
  description: "Attention and operational drift",
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
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-transparent text-[var(--ops-text-muted)] hover:bg-[var(--ops-hover)] focus:outline-none focus:ring-0"
    >
      {children}
    </Link>
  );
}

function CogIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
      <path
        d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M19.4 13a7.7 7.7 0 0 0 0-2l2-1.6-2-3.5-2.4 1a7.3 7.3 0 0 0-1.7-1L14.9 2h-3.8l-.4 2.9a7.3 7.3 0 0 0-1.7 1l-2.4-1-2 3.5 2 1.6a7.7 7.7 0 0 0 0 2l-2 1.6 2 3.5 2.4-1a7.3 7.3 0 0 0 1.7 1l.4 2.9h3.8l.4-2.9a7.3 7.3 0 0 0 1.7-1l2.4 1 2-3.5-2-1.6Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function BugIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
      <path
        d="M10 6a2 2 0 1 1 4 0"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M8 10h8v5a4 4 0 0 1-8 0v-5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M6 13H4m16 0h-2M7 8 5.5 6.5M17 8l1.5-1.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col bg-[var(--ops-bg)] text-[var(--ops-text)]">
        <header className="sticky top-0 z-50 border-b border-[var(--ops-border)] bg-[var(--ops-footer-bg)]">
          <div className="h-[3px] w-full bg-[var(--ops-brand-line)]" />

          <div className="flex h-16 w-full items-center justify-between px-4 sm:px-6">
            <Link
              href="/"
              className="h-9 w-9 rounded-lg focus:outline-none focus:ring-0"
              aria-label="Home"
            />

            <div className="flex items-center gap-2">
              {user ? (
                <>
                  <IconLink href="/settings" label="Settings">
                    <CogIcon />
                  </IconLink>
                  <IconLink href="/debug" label="Debug">
                    <BugIcon />
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

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6">
          {children}
        </main>

        <footer className="mt-auto border-t border-[var(--ops-border)] bg-[var(--ops-footer-bg)]">
          <div className="h-12" />
        </footer>
      </body>
    </html>
  );
}
