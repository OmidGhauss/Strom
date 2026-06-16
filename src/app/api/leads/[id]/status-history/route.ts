import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/api/auth";
import { ApiErrors, handleSupabaseError } from "@/lib/api/errors";
import { listResponse } from "@/lib/api/responses";
import { UuidSchema } from "@/lib/validation/common";
import { parsePagination, paginationRange } from "@/lib/validation/common";

// GET /api/leads/[id]/status-history
// Vollständige Statushistorie eines Leads, paginiert.
// RLS (lead_status_history: select): can_access_lead(lead_id).
// changed_by wird als UUID zurückgegeben — Dashboard löst Profilnamen für Manager/Admin separat auf.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth();
  } catch (e) {
    return e as Response;
  }

  const { id } = await params;
  if (!UuidSchema.safeParse(id).success) return ApiErrors.notFound("Lead");

  const { page, pageSize } = parsePagination(request.nextUrl.searchParams);
  const { from, to } = paginationRange(page, pageSize);

  const supabase = await createClient();

  const { data, error, count } = await supabase
    .from("lead_status_history")
    .select("id, lead_id, old_status, new_status, changed_by, reason, created_at", {
      count: "exact",
    })
    .eq("lead_id", id)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) return handleSupabaseError(error);
  return listResponse(data ?? [], { count: count ?? 0, page, pageSize });
}
