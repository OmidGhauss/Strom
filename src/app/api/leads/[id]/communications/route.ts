import type { NextRequest } from "next/server";
import * as z from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/api/auth";
import type { AuthContext } from "@/lib/api/auth";
import { ApiErrors, handleSupabaseError } from "@/lib/api/errors";
import { singleResponse, listResponse } from "@/lib/api/responses";
import { UuidSchema, parsePagination, paginationRange } from "@/lib/validation/common";
import { CreateCommunicationSchema } from "@/lib/validation/lead";

// GET /api/leads/[id]/communications
// Kommunikationseinträge eines Leads paginiert auflisten, absteigend nach created_at.
// RLS (communications_log: select): can_access_lead(lead_id).
// Unzugänglicher Lead → leere Liste (kein Info-Leak).
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
    .from("communications_log")
    .select(
      "id, lead_id, offer_id, created_by, communication_type, direction, subject, content_summary, status, external_id, created_at, updated_at",
      { count: "exact" }
    )
    .eq("lead_id", id)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) return handleSupabaseError(error);
  return listResponse(data ?? [], { count: count ?? 0, page, pageSize });
}

// POST /api/leads/[id]/communications
// Manuellen Kommunikationseintrag erstellen. created_by aus auth.profileId.
// communication_type "system" ist NICHT erlaubt (reserviert für automatische Prozesse).
//
// Lead-Gate vor offer_id-Check: verhindert falsches 422 bei fehlendem Lead-Zugriff.
// PGRST116 im Lead-Gate bedeutet "nicht existent oder RLS blocked" → 404 (kein Info-Leak).
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

  const parsed = CreateCommunicationSchema.safeParse(raw);
  if (!parsed.success) {
    return ApiErrors.unprocessable("Validierungsfehler", z.flattenError(parsed.error));
  }

  const body = parsed.data;

  const supabase = await createClient();

  // Lead-Gate: sichert saubere Fehlersemantik für nachfolgende Checks.
  const { error: leadError } = await supabase
    .from("leads")
    .select("id")
    .eq("id", id)
    .single();

  if (leadError?.code === "PGRST116") return ApiErrors.notFound("Lead");
  if (leadError) return handleSupabaseError(leadError);

  // offer_id Cross-Lead-Check: offer muss zum selben Lead gehören.
  if (body.offer_id != null) {
    const { data: offer, error: offerError } = await supabase
      .from("offers")
      .select("id")
      .eq("id", body.offer_id)
      .eq("lead_id", id)
      .single();

    if (offerError?.code === "PGRST116") {
      return ApiErrors.unprocessable("offer_id gehört nicht zu diesem Lead");
    }
    if (offerError) return handleSupabaseError(offerError);
    if (!offer) {
      return ApiErrors.unprocessable("offer_id gehört nicht zu diesem Lead");
    }
  }

  const { data, error } = await supabase
    .from("communications_log")
    .insert({ lead_id: id, created_by: auth.profileId, ...body })
    .select()
    .single();

  if (error) return handleSupabaseError(error);
  return singleResponse(data, 201);
}
