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
    .select("id, role, is_active")
    .eq("auth_user_id", user.id)
    .single();

  if (profileError || !profile) {
    throw ApiErrors.unauthorized();
  }

  // Schicht 1 (App): Deaktivierte Nutzer explizit ablehnen.
  // Nach der Block-22-Migration liefert die "profiles: select own row" RLS-Policy
  // für inaktive User bereits 0 Zeilen (→ profileError/!profile oben greift).
  // Dieser explizite Check dient als Defense-in-depth, konsistentem 401-Verhalten
  // und Server-Logging — unabhängig davon, ob RLS bereits blockiert hat.
  if (!profile.is_active) {
    console.error("[auth] Blocked inactive profile", { profileId: profile.id });
    throw ApiErrors.unauthorized();
  }

  return {
    authUserId: user.id,
    profileId: profile.id,
    role: profile.role as UserRole,
  };
}
