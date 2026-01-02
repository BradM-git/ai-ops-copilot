import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

function displayNameFromUser(user: any) {
  const md = user?.user_metadata || {};
  return (
    md.full_name ||
    md.name ||
    user?.email?.split("@")?.[0] ||
    "New Workspace"
  );
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const origin = url.origin;

  if (!code) return NextResponse.redirect(`${origin}/login`);

  // We create the response up-front so we can set cookies on it
  const response = NextResponse.redirect(`${origin}/`);

  // Supabase SSR client that can read incoming cookies and set outgoing cookies
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll().map((c) => ({ name: c.name, value: c.value }));
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  // Exchange code for a session (this is what sets the auth cookies)
  const { error: exchangeErr } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeErr) {
    return NextResponse.redirect(
      `${origin}/login?error=oauth_callback_failed&message=${encodeURIComponent(exchangeErr.message)}`
    );
  }

  // Fetch user now that session exists
  const { data: userRes, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userRes.user) {
    return NextResponse.redirect(`${origin}/login?error=unauthorized`);
  }

  // Ensure the user belongs to a customer (workspace)
  const admin = supabaseAdmin();
  const userId = userRes.user.id;

  // 1) Check if membership already exists
  const existing = await admin
    .from("customer_memberships")
    .select("customer_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (existing.error) {
    return NextResponse.redirect(
      `${origin}/login?error=onboarding_failed&message=${encodeURIComponent(existing.error.message)}`
    );
  }

  if (!existing.data?.customer_id) {
    // 2) Create customer
    const customerName = displayNameFromUser(userRes.user);

    const createdCustomer = await admin
      .from("customers")
      .insert({ name: customerName })
      .select("id")
      .single();

    if (createdCustomer.error) {
      return NextResponse.redirect(
        `${origin}/login?error=onboarding_failed&message=${encodeURIComponent(createdCustomer.error.message)}`
      );
    }

    const customerId = createdCustomer.data.id as string;

    // 3) Create membership
    const createdMembership = await admin
      .from("customer_memberships")
      .insert({
        user_id: userId,
        customer_id: customerId,
        role: "owner",
        is_primary: true,
      })
      .select("customer_id")
      .single();

    if (createdMembership.error) {
      return NextResponse.redirect(
        `${origin}/login?error=onboarding_failed&message=${encodeURIComponent(createdMembership.error.message)}`
      );
    }
  }

  // Optional: add a signed-in flag for a one-time toast on homepage
  response.headers.set("location", `${origin}/?signed_in=1`);
  return response;
}
