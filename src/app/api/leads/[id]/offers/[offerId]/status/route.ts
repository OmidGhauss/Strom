import type { NextRequest } from "next/server";
import * as z from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/api/auth";
import type { AuthContext } from "@/lib/api/auth";
import { ApiErrors, handleSupabaseError } from "@/lib/api/errors";
import { singleResponse } from "@/lib/api/responses";
import { assertOfferStatusTransition } from "@/lib/api/guards";
import { UuidSchema } from "@/lib/validation/common";
import { UpdateOfferStatusSchema } from "@/lib/validation/lead";

// PATCH /api/leads/[id]/offers/[offerId]/status
//
// Statuswechsel nach erlaubter State Machine:
//   draft → sent
//   sent  → accepted | rejected | expired
//   accepted / rejected / expired / superseded → keine weiteren Wechsel
//
// Rollenregeln:
//   accepted: nur Manager/Admin (employee → 403)
//   alle anderen Übergänge: employee nur eigene Offers (created_by === profileId)
//
// Compare-and-Set: UPDATE mit .eq("status", currentStatus) verhindert Lost Updates
// durch parallele Requests. PGRST116 beim UPDATE → 409.
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

  const parsed = UpdateOfferStatusSchema.safeParse(raw);
  if (!parsed.success) {
    return ApiErrors.unprocessable("Validierungsfehler", z.flattenError(parsed.error));
  }

  const body = parsed.data;

  const supabase = await createClient();

  // Offer lesen: currentStatus für Transition-Check und CAS; created_by für Rollencheck.
  const { data: offer, error: readError } = await supabase
    .from("offers")
    .select("id, status, created_by")
    .eq("id", offerId)
    .eq("lead_id", id)
    .single();

  if (readError?.code === "PGRST116") return ApiErrors.notFound("Offer");
  if (readError) return handleSupabaseError(readError);

  const currentStatus = offer.status;

  assertOfferStatusTransition(currentStatus, body.status);

  // accepted: nur Manager/Admin
  if (body.status === "accepted" && auth.role === "employee") {
    return ApiErrors.forbidden("Nur Manager und Admin dürfen Angebote als angenommen markieren");
  }

  // Alle anderen Übergänge: Employee nur eigene Offers
  if (auth.role === "employee" && offer.created_by !== auth.profileId) {
    return ApiErrors.forbidden("Employees dürfen nur eigene Angebote ändern");
  }

  // Compare-and-Set: UPDATE greift nur wenn status seit dem READ unverändert ist.
  // Paralleler Request hat status bereits geändert → PGRST116 → 409.
  const { data, error: updateError } = await supabase
    .from("offers")
    .update({ status: body.status })
    .eq("id", offerId)
    .eq("lead_id", id)
    .eq("status", currentStatus)
    .select()
    .single();

  if (updateError?.code === "PGRST116") {
    return ApiErrors.conflict("Offer-Status wurde zwischenzeitlich geändert");
  }
  if (updateError) return handleSupabaseError(updateError);
  return singleResponse(data);
}
