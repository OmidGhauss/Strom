import type { NextRequest } from "next/server";
import * as z from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/api/auth";
import { ApiErrors, handleSupabaseError } from "@/lib/api/errors";
import { UuidSchema } from "@/lib/validation/common";
import { AddressTypeSchema, UpdateAddressSchema } from "@/lib/validation/lead";
import type { Address, AddressType } from "@/types/database";

// PATCH /api/leads/[id]/addresses/[addressType]
// Adresse anlegen oder partiell updaten (echte PATCH-Semantik).
//
// Strategie: try-UPDATE-then-INSERT — kein .upsert(), das omitted fields auf NULL setzen würde.
//   1. UPDATE: nur explizit übergebene Felder ändern sich; omitted = unverändert.
//   2. PGRST116 (0 rows): Adresse existiert noch nicht → INSERT.
//   3. 23505 beim INSERT (TOCTOU-Konflikt) → 409 via handleSupabaseError.
//
// RLS: addresses INSERT + UPDATE = can_access_lead(lead_id) → user-aware Client reicht.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; addressType: string }> }
) {
  try {
    await requireAuth();
  } catch (e) {
    return e as Response;
  }

  const { id, addressType } = await params;
  if (!UuidSchema.safeParse(id).success) return ApiErrors.notFound("Lead");
  if (!AddressTypeSchema.safeParse(addressType).success) {
    return ApiErrors.badRequest(`Ungültiger Adresstyp: ${addressType}`);
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return ApiErrors.badRequest("Ungültiger JSON-Body");
  }

  const parsed = UpdateAddressSchema.safeParse(raw);
  if (!parsed.success) {
    return ApiErrors.unprocessable("Validierungsfehler", z.flattenError(parsed.error));
  }

  const body = parsed.data;

  if (Object.keys(body).length === 0) {
    return ApiErrors.badRequest("Keine Felder zum Aktualisieren");
  }

  const supabase = await createClient();

  const { data: updated, error: updateError } = await supabase
    .from("addresses")
    .update(body)
    .eq("lead_id", id)
    .eq("address_type", addressType)
    .select()
    .single();

  if (!updateError) return Response.json({ data: updated });

  if (updateError.code === "PGRST116") {
    const { data: inserted, error: insertError } = await supabase
      .from("addresses")
      .insert({
        lead_id: id,
        address_type: addressType as AddressType,
        ...body,
      } as unknown as Omit<Address, "id" | "created_at" | "updated_at">)
      .select()
      .single();

    if (insertError) return handleSupabaseError(insertError);
    return Response.json({ data: inserted });
  }

  return handleSupabaseError(updateError);
}
