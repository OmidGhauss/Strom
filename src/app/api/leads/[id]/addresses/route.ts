import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/api/auth";
import { ApiErrors, handleSupabaseError } from "@/lib/api/errors";
import { UuidSchema } from "@/lib/validation/common";

// GET /api/leads/[id]/addresses
// Alle Adressen eines Leads (max. 3 — eine pro address_type).
// RLS (addresses: select): can_access_lead(lead_id).
// Keine Pagination nötig (max. 3 Zeilen).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth();
  } catch (e) {
    return e as Response;
  }

  const { id } = await params;
  if (!UuidSchema.safeParse(id).success) return ApiErrors.notFound("Lead");

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("addresses")
    .select("*")
    .eq("lead_id", id)
    .order("address_type");

  if (error) return handleSupabaseError(error);
  return Response.json({ data: data ?? [] });
}
