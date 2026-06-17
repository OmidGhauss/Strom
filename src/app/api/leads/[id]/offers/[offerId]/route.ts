import type { NextRequest } from "next/server";
import * as z from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/api/auth";
import type { AuthContext } from "@/lib/api/auth";
import { ApiErrors, handleSupabaseError } from "@/lib/api/errors";
import { singleResponse } from "@/lib/api/responses";
import { assertOfferEditableByUser } from "@/lib/api/guards";
import { UuidSchema } from "@/lib/validation/common";
import { UpdateOfferSchema } from "@/lib/validation/lead";
import type { EnergyType } from "@/types/database";

// PATCH /api/leads/[id]/offers/[offerId]
//
// Draft-Only Guard: nur Offers mit status = "draft" dürfen bearbeitet werden.
// Rollenlogik:
//   admin/manager → alle draft-Offers
//   employee      → nur eigene draft-Offers (created_by === profileId)
//
// energy_demand_id + energy_type Konsistenz:
//   Effektiver Zielzustand wird berechnet aus bestehenden Werten + Body.
//   Wenn effectiveEnergyDemandId !== null: Check gegen energy_demands.
//   Auch wenn weder energy_demand_id noch energy_type geändert werden,
//   wird gegen die bestehende Kombination geprüft (Korrektheit vor Komfort).
//
// Scoping: .eq("id", offerId).eq("lead_id", id) auf alle Queries.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; offerId: string }> }
) {
  let auth: AuthContext;
  try {
    auth = await requireAuth();
  } catch (e) {
    return e as Response;
  }

  const { id, offerId } = await params;
  if (!UuidSchema.safeParse(id).success) return ApiErrors.notFound("Lead");
  if (!UuidSchema.safeParse(offerId).success) return ApiErrors.notFound("Offer");

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return ApiErrors.badRequest("Ungültiger JSON-Body");
  }

  const parsed = UpdateOfferSchema.safeParse(raw);
  if (!parsed.success) {
    return ApiErrors.unprocessable("Validierungsfehler", z.flattenError(parsed.error));
  }

  const body = parsed.data;

  if (Object.keys(body).length === 0) {
    return ApiErrors.badRequest("Mindestens ein Feld erforderlich");
  }

  const supabase = await createClient();

  // Offer laden: status, created_by für Guard; energy_type + energy_demand_id für Konsistenzcheck.
  const { data: offer, error: offerError } = await supabase
    .from("offers")
    .select("id, status, created_by, energy_type, energy_demand_id")
    .eq("id", offerId)
    .eq("lead_id", id)
    .single();

  if (offerError?.code === "PGRST116") return ApiErrors.notFound("Offer");
  if (offerError) return handleSupabaseError(offerError);

  try {
    assertOfferEditableByUser(auth.role, offer.created_by, auth.profileId, offer.status);
  } catch (e) {
    return e as Response;
  }

  // Effektiven Zielzustand berechnen.
  // body.energy_type fehlt → bestehendes energy_type bleibt.
  // "energy_demand_id" in body → explizit gesetzt (auch null); sonst bestehendes übernehmen.
  const effectiveEnergyType: EnergyType =
    (body.energy_type ?? offer.energy_type) as EnergyType;

  const effectiveEnergyDemandId: string | null =
    "energy_demand_id" in body
      ? (body.energy_demand_id ?? null)
      : offer.energy_demand_id;

  // energy_demand_id Cross-Lead-Check + energy_type Konsistenz.
  // Wird auch ausgeführt wenn weder energy_demand_id noch energy_type im Body stehen —
  // fängt bestehende Drift in der DB auf (Korrektheit vor Komfort).
  if (effectiveEnergyDemandId !== null) {
    const { data: demand, error: demandError } = await supabase
      .from("energy_demands")
      .select("id, energy_type")
      .eq("id", effectiveEnergyDemandId)
      .eq("lead_id", id)
      .single();

    if (demandError?.code === "PGRST116") {
      return ApiErrors.unprocessable("energy_demand_id gehört nicht zu diesem Lead");
    }
    if (demandError) return handleSupabaseError(demandError);
    if (!demand) {
      return ApiErrors.unprocessable("energy_demand_id gehört nicht zu diesem Lead");
    }

    if ((demand.energy_type as EnergyType) !== effectiveEnergyType) {
      return ApiErrors.unprocessable("energy_demand_id passt nicht zu energy_type");
    }
  }

  const { data, error } = await supabase
    .from("offers")
    .update(body)
    .eq("id", offerId)
    .eq("lead_id", id)
    .select()
    .single();

  if (error?.code === "PGRST116") return ApiErrors.notFound("Offer");
  if (error) return handleSupabaseError(error);
  return singleResponse(data);
}
