import type { NextRequest } from "next/server";
import * as z from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/api/auth";
import { ApiErrors, handleSupabaseError } from "@/lib/api/errors";
import { UuidSchema } from "@/lib/validation/common";
import { EnergyTypeSchema, UpdateEnergyDemandSchema } from "@/lib/validation/lead";

// PATCH /api/leads/[id]/energy-demands/[energyType]
// Energiebedarf partiell updaten (UPDATE-only — kein Upsert, kein Insert).
//
// Wenn kein energy_demand für energyType existiert, signalisiert 404 dem Client,
// zuerst den product_type zu setzen (Block 12b). Ein stiller Upsert würde
// den product_type/energy_demands-Konsistenzvertrag untergraben.
//
// hot_water_with_gas: DB-CHECK erlaubt dieses Feld nur für gas.
// Wird inline vor dem DB-Aufruf geprüft, da Zod den URL-Parameter nicht kennt.
//
// RLS: energy_demands UPDATE = can_access_lead(lead_id) → user-aware Client reicht.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; energyType: string }> }
) {
  try {
    await requireAuth();
  } catch (e) {
    return e as Response;
  }

  const { id, energyType } = await params;
  if (!UuidSchema.safeParse(id).success) return ApiErrors.notFound("Lead");
  if (!EnergyTypeSchema.safeParse(energyType).success) {
    return ApiErrors.badRequest(`Ungültiger Energietyp: ${energyType}`);
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return ApiErrors.badRequest("Ungültiger JSON-Body");
  }

  const parsed = UpdateEnergyDemandSchema.safeParse(raw);
  if (!parsed.success) {
    return ApiErrors.unprocessable("Validierungsfehler", z.flattenError(parsed.error));
  }

  const body = parsed.data;

  if (Object.keys(body).length === 0) {
    return ApiErrors.badRequest("Keine Felder zum Aktualisieren");
  }

  if (body.hot_water_with_gas !== undefined && body.hot_water_with_gas !== null && energyType === "electricity") {
    return ApiErrors.unprocessable("hot_water_with_gas ist nur für gas erlaubt");
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("energy_demands")
    .update(body)
    .eq("lead_id", id)
    .eq("energy_type", energyType)
    .select()
    .single();

  if (error?.code === "PGRST116") return ApiErrors.notFound("EnergyDemand");
  if (error) return handleSupabaseError(error);
  return Response.json({ data });
}
