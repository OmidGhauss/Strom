import type { NextRequest } from "next/server";
import * as z from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/api/auth";
import type { AuthContext } from "@/lib/api/auth";
import { ApiErrors, handleSupabaseError } from "@/lib/api/errors";
import { singleResponse, listResponse } from "@/lib/api/responses";
import { UuidSchema, parsePagination, paginationRange } from "@/lib/validation/common";
import { CreateNoteSchema } from "@/lib/validation/lead";

// GET /api/leads/[id]/notes
// Alle Notes eines Leads, paginiert, absteigend nach created_at.
// RLS (lead_notes: select): can_access_lead(lead_id).
// Unzugänglicher Lead → leere Liste (kein Info-Leak ob Lead oder Notes existieren).
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
    .from("lead_notes")
    .select("id, lead_id, created_by, note, created_at, updated_at", { count: "exact" })
    .eq("lead_id", id)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) return handleSupabaseError(error);
  return listResponse(data ?? [], { count: count ?? 0, page, pageSize });
}

// POST /api/leads/[id]/notes
// Note erstellen. created_by kommt ausschließlich aus auth.profileId — nie aus dem Body.
// RLS (lead_notes: insert): can_access_lead(lead_id).
// Kein separates RLS-Gate für POST — RLS INSERT reicht für V1.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let auth: AuthContext;
  try {
    auth = await requireAuth();
  } catch (e) {
    return e as Response;
  }

  const { id } = await params;
  if (!UuidSchema.safeParse(id).success) return ApiErrors.notFound("Lead");

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return ApiErrors.badRequest("Ungültiger JSON-Body");
  }

  const parsed = CreateNoteSchema.safeParse(raw);
  if (!parsed.success) {
    return ApiErrors.unprocessable("Validierungsfehler", z.flattenError(parsed.error));
  }

  const body = parsed.data;

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("lead_notes")
    .insert({ lead_id: id, created_by: auth.profileId, note: body.note })
    .select()
    .single();

  if (error) return handleSupabaseError(error);
  return singleResponse(data, 201);
}
