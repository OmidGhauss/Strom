import type { NextRequest } from "next/server";
import * as z from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuth } from "@/lib/api/auth";
import type { AuthContext } from "@/lib/api/auth";
import { ApiErrors, handleSupabaseError } from "@/lib/api/errors";
import { singleResponse } from "@/lib/api/responses";
import { assertManagerOrAbove } from "@/lib/api/guards";
import { UuidSchema } from "@/lib/validation/common";
import { UpdateProductTypeSchema } from "@/lib/validation/lead";
import type { EnergyType, ProductType } from "@/types/database";

// Deterministisches Mapping product_type → energy_types (electricity immer vor gas).
// Wird im No-op Guard genutzt, ohne extra DB-Roundtrip.
const ENERGY_TYPES_BY_PRODUCT_TYPE: Record<ProductType, EnergyType[]> = {
  electricity: ["electricity"],
  gas:         ["gas"],
  both:        ["electricity", "gas"],
};

// PATCH /api/leads/[id]/product-type
//
// Ändert leads.product_type und energy_demands-Struktur atomar via RPC.
// Nur Manager und Admin dürfen product_type ändern (assertManagerOrAbove).
//
// Route-Flow (Rev. 3):
//   Step 1: requireAuth()
//   Step 2: assertManagerOrAbove → 403 für employee
//   Step 3: UUID validieren
//   Step 4: JSON parse + Zod
//   Step 5: user-aware RLS-Gate
//   Step 6: No-op Guard → 200 changed:false ohne RPC
//   Step 7: adminClient.rpc("change_lead_product_type") → atomar
//
// Locking in der RPC (adminClient = service_role bypassed RLS):
//   - SELECT leads FOR UPDATE → keine parallelen product_type-Wechsel
//   - SELECT energy_demands FOR UPDATE → Offer-Insert-Race verhindert
//   - Offers-Conflict-Check nach Locking → stabil, kein TOCTOU
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Step 1: Auth
  let auth: AuthContext;
  try {
    auth = await requireAuth();
  } catch (e) {
    return e as Response;
  }

  // Step 2: Rollenguard — nur Manager und Admin
  try {
    assertManagerOrAbove(auth.role);
  } catch (e) {
    return e as Response;
  }

  // Step 3: UUID validieren
  const { id } = await params;
  if (!UuidSchema.safeParse(id).success) return ApiErrors.notFound("Lead");

  // Step 4: JSON + Zod
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return ApiErrors.badRequest("Ungültiger JSON-Body");
  }

  const parsed = UpdateProductTypeSchema.safeParse(raw);
  if (!parsed.success) {
    return ApiErrors.unprocessable("Validierungsfehler", z.flattenError(parsed.error));
  }

  const body = parsed.data;

  // Step 5: User-aware RLS-Gate
  // RLS (leads: select): Employee sieht nur eigene Leads (hier ohnehin 403 vorher).
  // 0 Zeilen → PGRST116 → 404. adminClient.rpc wird nicht aufgerufen.
  const supabase = await createClient();
  const { data: leadCheck, error: gateError } = await supabase
    .from("leads")
    .select("id, product_type")
    .eq("id", id)
    .single();

  if (gateError) return handleSupabaseError(gateError);

  const currentProductType = leadCheck.product_type as ProductType;

  // Step 6: No-op Guard
  // Kein RPC, keine DB-Änderungen, keine energy_demand-Struktur-Änderungen.
  if (body.product_type === currentProductType) {
    return singleResponse({
      lead_id:          id,
      old_product_type: currentProductType,
      new_product_type: currentProductType,
      energy_types:     ENERGY_TYPES_BY_PRODUCT_TYPE[currentProductType],
      changed:          false,
    });
  }

  // Step 7: Atomarer Wechsel via Service Role RPC
  // adminClient wird ausschließlich nach positivem RLS-Gate aufgerufen.
  const adminClient = createAdminClient();
  const { data, error } = await adminClient.rpc("change_lead_product_type", {
    p_lead_id:      id,
    p_product_type: body.product_type,
  });

  if (error) return handleSupabaseError(error);

  const row = Array.isArray(data) ? data[0] : data;
  return singleResponse({
    lead_id:          (row as { lead_id: string } | undefined)?.lead_id          ?? id,
    old_product_type: (row as { old_product_type: string } | undefined)?.old_product_type ?? currentProductType,
    new_product_type: (row as { new_product_type: string } | undefined)?.new_product_type ?? body.product_type,
    energy_types:     (row as { energy_types: string[] } | undefined)?.energy_types       ?? ENERGY_TYPES_BY_PRODUCT_TYPE[body.product_type],
    changed:          true,
  });
}
