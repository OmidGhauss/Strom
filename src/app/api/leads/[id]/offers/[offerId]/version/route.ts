import type { NextRequest } from "next/server";
import * as z from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/api/auth";
import type { AuthContext } from "@/lib/api/auth";
import { ApiErrors, handleSupabaseError } from "@/lib/api/errors";
import { singleResponse } from "@/lib/api/responses";
import { UuidSchema } from "@/lib/validation/common";
import { CreateOfferVersionSchema } from "@/lib/validation/lead";
import type { EnergyType } from "@/types/database";

// Statuse die versioniert werden dürfen.
const VERSIONABLE_STATUSES = ["sent", "rejected", "expired"] as const;
type VersionableStatus = (typeof VERSIONABLE_STATUSES)[number];

function isVersionable(status: string): status is VersionableStatus {
  return (VERSIONABLE_STATUSES as readonly string[]).includes(status);
}

// POST /api/leads/[id]/offers/[offerId]/version
//
// Erstellt eine neue draft-Version basierend auf der alten Offer.
// Alte Offer → status = 'superseded'; neue Offer → status = 'draft'.
// Atomarität durch RPC (SECURITY INVOKER) — kein adminClient, kein service_role.
//
// Route-Checks sind Fast-Path/UX. Die RPC ist autoritativ für:
//   - OFFER_NOT_FOUND, OFFER_NOT_VERSIONABLE, OFFER_FORBIDDEN
//
// Feldauflösung: body override > alte Offer.
// Ausnahme: valid_until und notes werden NICHT kopiert (default null).
//
// energy_demand_id + energy_type: Konsistenzcheck gegen effectiven Zielzustand
// (gleiche Logik wie Block 14 PATCH).
export async function POST(
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

  // Leerer Body ist erlaubt (reine Kopie der alten Offer).
  let raw: unknown = {};
  try {
    const text = await request.text();
    raw = text.trim() ? (JSON.parse(text) as unknown) : {};
  } catch {
    return ApiErrors.badRequest("Ungültiger JSON-Body");
  }

  const parsed = CreateOfferVersionSchema.safeParse(raw);
  if (!parsed.success) {
    return ApiErrors.unprocessable("Validierungsfehler", z.flattenError(parsed.error));
  }

  const body = parsed.data;

  const supabase = await createClient();

  // Alte Offer laden — dient als RLS-Gate, Basis für Feldauflösung und Fast-Path-Checks.
  const { data: offer, error: offerError } = await supabase
    .from("offers")
    .select(
      "id, status, created_by, energy_demand_id, provider_name, tariff_name, energy_type, monthly_price, annual_price, estimated_savings"
    )
    .eq("id", offerId)
    .eq("lead_id", id)
    .single();

  if (offerError?.code === "PGRST116") return ApiErrors.notFound("Offer");
  if (offerError) return handleSupabaseError(offerError);

  // Fast-path Status-Check (TOCTOU-anfällig; RPC ist autoritativ).
  if (!isVersionable(offer.status)) {
    return ApiErrors.conflict(
      `Offer kann nicht versioniert werden (aktueller Status: ${offer.status})`
    );
  }

  // Fast-path Ownership-Check (RPC prüft nochmals autoritativ).
  if (auth.role === "employee" && offer.created_by !== auth.profileId) {
    return ApiErrors.forbidden("Employees dürfen nur eigene Angebote versionieren");
  }

  // Effektiven Zielzustand aller Felder berechnen.
  // Nullable Felder: "key in body"-Semantik, um null von "nicht angegeben" zu unterscheiden.
  const effectiveEnergyDemandId: string | null =
    "energy_demand_id" in body ? (body.energy_demand_id ?? null) : offer.energy_demand_id;

  const effectiveEnergyType: EnergyType =
    (body.energy_type ?? offer.energy_type) as EnergyType;

  // energy_demand_id + energy_type Konsistenzcheck (wenn nicht null).
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

  // Alle zu übergebenden Felder auflösen.
  // provider_name, tariff_name, energy_type: immer von alter Offer kopiert wenn nicht im Body —
  // offer-Werte sind NOT NULL in DB, daher immer vorhanden.
  const resolvedProviderName  = body.provider_name  ?? offer.provider_name;
  const resolvedTariffName    = body.tariff_name    ?? offer.tariff_name;
  const resolvedMonthlyPrice  = "monthly_price"  in body ? (body.monthly_price  ?? null) : offer.monthly_price;
  const resolvedAnnualPrice   = "annual_price"   in body ? (body.annual_price   ?? null) : offer.annual_price;
  const resolvedSavings       = "estimated_savings" in body ? (body.estimated_savings ?? null) : offer.estimated_savings;
  // valid_until und notes werden NICHT von alter Offer kopiert — default null.
  const resolvedValidUntil    = "valid_until" in body ? (body.valid_until ?? null) : null;
  const resolvedNotes         = "notes"       in body ? (body.notes       ?? null) : null;

  // Atomarer Versioning-Call via SECURITY INVOKER RPC.
  // RPC prüft OFFER_NOT_FOUND, OFFER_NOT_VERSIONABLE, OFFER_FORBIDDEN autoritativ.
  const { data, error: rpcError } = await supabase.rpc("create_offer_version", {
    p_lead_id:           id,
    p_offer_id:          offerId,
    p_energy_demand_id:  effectiveEnergyDemandId,
    p_provider_name:     resolvedProviderName,
    p_tariff_name:       resolvedTariffName,
    p_energy_type:       effectiveEnergyType,
    p_monthly_price:     resolvedMonthlyPrice,
    p_annual_price:      resolvedAnnualPrice,
    p_estimated_savings: resolvedSavings,
    p_valid_until:       resolvedValidUntil,
    p_notes:             resolvedNotes,
  });

  if (rpcError) return handleSupabaseError(rpcError);

  const result = Array.isArray(data) && data.length > 0 ? data[0] : null;
  if (!result) return ApiErrors.internal();

  return singleResponse(result, 201);
}
