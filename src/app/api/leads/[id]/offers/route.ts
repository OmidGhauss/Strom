import type { NextRequest } from "next/server";
import * as z from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/api/auth";
import type { AuthContext } from "@/lib/api/auth";
import { ApiErrors, handleSupabaseError } from "@/lib/api/errors";
import { singleResponse, listResponse } from "@/lib/api/responses";
import { UuidSchema, parsePagination, paginationRange } from "@/lib/validation/common";
import { CreateOfferSchema } from "@/lib/validation/lead";
import type { EnergyType } from "@/types/database";

// GET /api/leads/[id]/offers
// Angebote eines Leads paginiert auflisten, absteigend nach created_at.
// RLS (offers: select): can_access_lead(lead_id).
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
    .from("offers")
    .select(
      "id, lead_id, energy_demand_id, created_by, parent_offer_id, pdf_document_id, offer_number, version, provider_name, tariff_name, energy_type, monthly_price, annual_price, estimated_savings, status, valid_until, notes, created_at, updated_at",
      { count: "exact" }
    )
    .eq("lead_id", id)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) return handleSupabaseError(error);
  return listResponse(data ?? [], { count: count ?? 0, page, pageSize });
}

// POST /api/leads/[id]/offers
// Offer erstellen. Status immer serverseitig "draft". created_by aus auth.profileId.
// Wenn energy_demand_id angegeben: muss zum selben Lead gehören und energy_type muss übereinstimmen.
// RLS (offers: insert): can_access_lead(lead_id) — kein separates Lead-Gate.
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

  const parsed = CreateOfferSchema.safeParse(raw);
  if (!parsed.success) {
    return ApiErrors.unprocessable("Validierungsfehler", z.flattenError(parsed.error));
  }

  const body = parsed.data;

  const supabase = await createClient();

  // energy_demand_id Cross-Lead-Check + energy_type Konsistenz
  if (body.energy_demand_id != null) {
    const { data: demand, error: demandError } = await supabase
      .from("energy_demands")
      .select("id, energy_type")
      .eq("id", body.energy_demand_id)
      .eq("lead_id", id)
      .single();

    if (demandError?.code === "PGRST116") {
      return ApiErrors.unprocessable("energy_demand_id gehört nicht zu diesem Lead");
    }
    if (demandError) return handleSupabaseError(demandError);
    if (!demand) {
      return ApiErrors.unprocessable("energy_demand_id gehört nicht zu diesem Lead");
    }

    if ((demand.energy_type as EnergyType) !== body.energy_type) {
      return ApiErrors.unprocessable("energy_demand_id passt nicht zu energy_type");
    }
  }

  const { data, error } = await supabase
    .from("offers")
    .insert({
      lead_id:    id,
      created_by: auth.profileId,
      status:     "draft",
      ...body,
    })
    .select()
    .single();

  if (error) return handleSupabaseError(error);
  return singleResponse(data, 201);
}
