import { requireAuth } from "@/lib/api/auth";
import { createClient } from "@/lib/supabase/server";
import { singleResponse } from "@/lib/api/responses";
import { ApiErrors } from "@/lib/api/errors";

// GET /api/me — Gibt das eigene Profil zurück (für das Frontend nach dem Login).
export async function GET() {
  let auth;
  try {
    auth = await requireAuth();
  } catch (errorResponse) {
    return errorResponse as Response;
  }

  const supabase = await createClient();
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, full_name, email, role, is_active")
    .eq("id", auth.profileId)
    .single();

  if (error || !profile) {
    return ApiErrors.unauthorized();
  }

  return singleResponse({
    profileId: auth.profileId,
    authUserId: auth.authUserId,
    role: auth.role,
    full_name: profile.full_name,
    email: profile.email,
    is_active: profile.is_active,
  });
}
