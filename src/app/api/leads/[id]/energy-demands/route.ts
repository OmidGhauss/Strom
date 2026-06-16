import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/api/auth";
import { ApiErrors, handleSupabaseError } from "@/lib/api/errors";
import { UuidSchema } from "@/lib/validation/common";

// GET /api/leads/[id]/energy-demands
// Alle Energiebedarfe eines Leads (max. 2 — eine pro energy_type: electricity/gas).
// RLS (energy_demands: select): can_access_lead(lead_id).
// Keine Pagination nötig (max. 2 Zeilen).
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
    .from("energy_demands")
    .select("*")
    .eq("lead_id", id)
    .order("energy_type");

  if (error) return handleSupabaseError(error);
  return Response.json({ data: data ?? [] });
}
