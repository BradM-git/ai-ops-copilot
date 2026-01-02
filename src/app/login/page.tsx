"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";

export default function LoginPage() {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // If already signed in, immediately bounce to /
  useEffect(() => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        router.replace("/");
        router.refresh();
      }
    });
  }, [router]);

  async function signInWithGoogle() {
    setErr(null);
    setLoading(true);

    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      setErr(error.message);
      setLoading(false);
    }
    // if no error: browser will redirect away to Google
  }

  return (
    <div className="mx-auto max-w-md p-6">
      <div className="rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-surface)] p-6">
        <div className="text-lg font-semibold text-[var(--ops-text)]">Sign in</div>
        <div className="mt-1 text-sm text-[var(--ops-text-muted)]">
          Continue with Google to access your workspace.
        </div>

        <button
          className="mt-4 w-full rounded-xl bg-[var(--ops-accent)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
          onClick={signInWithGoogle}
          disabled={loading}
        >
          {loading ? "Redirecting…" : "Continue with Google"}
        </button>

        {err ? <div className="mt-3 text-sm text-red-500">{err}</div> : null}
      </div>
    </div>
  );
}
