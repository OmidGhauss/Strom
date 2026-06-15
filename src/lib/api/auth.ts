import "server-only";

import { createClient } from "@/lib/supabase/server";
import { ApiErrors } from "@/lib/api/errors";
import type { UserRole } from "@/types/database";

export type AuthContext = {
  authUserId: string;
  profileId: string;
  role: UserRole;
};

// Call this as the first action in every protected Route Handler.
// Returns the authenticated user's profile data, or throws a Response with 401.
// Never returns null — if this function returns, the caller is authenticated.
export async function requireAuth(): Promise<AuthContext> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    throw ApiErrors.unauthorized();
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("auth_user_id", user.id)
    .single();

  if (profileError || !profile) {
    throw ApiErrors.unauthorized();
  }

  return {
    authUserId: user.id,
    profileId: profile.id,
    role: profile.role as UserRole,
  };
}
