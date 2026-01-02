// src/lib/supabaseServer.ts
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/**
 * Server-side Supabase client for Server Components / read-only usage.
 * Note: In Server Components you generally should not set cookies.
 */
export async function supabaseServer() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          // Next's cookie objects -> { name, value } shape expected by @supabase/ssr
          return cookieStore.getAll().map((c) => ({ name: c.name, value: c.value }));
        },
        setAll() {
          // No-op in Server Components
        },
      },
    }
  );
}
