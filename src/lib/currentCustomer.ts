import { supabaseServer } from "@/lib/supabaseServer";

/**
 * Resolves the single customer_id for the currently logged-in user.
 * Alpha invariant: exactly 1 user → exactly 1 customer.
 */
export async function getCurrentCustomerId() {
  const supabase = await supabaseServer();

  const { data: userRes, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userRes.user) {
    throw new Error("Not authenticated");
  }

  const { data: memberships, error: memErr } = await supabase
    .from("customer_memberships")
    .select("customer_id")
    .eq("user_id", userRes.user.id);

  if (memErr) {
    throw new Error("Failed to resolve customer membership");
  }

  if (!memberships || memberships.length !== 1) {
    throw new Error("Expected exactly one customer membership");
  }

  return memberships[0].customer_id;
}
