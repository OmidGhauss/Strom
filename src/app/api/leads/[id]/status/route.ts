import type { NextRequest } from "next/server";
import * as z from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuth } from "@/lib/api/auth";
import type { AuthContext } from "@/lib/api/auth";
import { ApiErrors, handleSupabaseError } from "@/lib/api/errors";
import { singleResponse } from "@/lib/api/responses";
import { assertStatusTransitionAllowedForRole } from "@/lib/api/guards";
import { UuidSchema } from "@/lib/validation/common";
import { UpdateLeadStatusSchema } from "@/lib/validation/lead";

// PATCH /api/leads/[id]/status
//
// Ablauf (Rev. 3):
//   Step 1: requireAuth()
//   Step 2: JSON parse + Zod
//   Step 3: assertStatusTransitionAllowedForRole (Employee darf terminale Statuse nicht setzen)
//   Step 4: user-aware RLS-Gate — prüft ob der User Zugriff auf diesen Lead hat
//   Step 5: No-op Guard — kein RPC, kein History-Eintrag wenn Status unverändert
//   Step 6: adminClient.rpc("change_lead_status") — atomar: UPDATE leads + INSERT lead_status_history
//
// adminClient wird ausschließlich nach positivem RLS-Gate (Step 4) aufgerufen.
// Zugriffsschutz liegt vollständig in dieser Route, nicht in der RPC-Funktion.
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

  const { id } = await params;
  if (!UuidSchema.safeParse(id).success) return ApiErrors.notFound("Lead");

  // Step 2: JSON + Zod
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return ApiErrors.badRequest("Ungültiger JSON-Body");
  }

  const parsed = UpdateLeadStatusSchema.safeParse(raw);
  if (!parsed.success) {
    return ApiErrors.unprocessable("Validierungsfehler", z.flattenError(parsed.error));
  }

  const body = parsed.data;

  // Step 3: Rollenbasierter Guard
  try {
    assertStatusTransitionAllowedForRole(auth.role, body.status);
  } catch (e) {
    return e as Response;
  }

  // Step 4: User-aware RLS-Gate
  // RLS (leads: select) wirkt: Employee sieht nur eigene Leads.
  // 0 Zeilen → PGRST116 → 404. adminClient.rpc wird NICHT aufgerufen.
  const supabase = await createClient();
  const { data: leadCheck, error: gateError } = await supabase
    .from("leads")
    .select("id, status")
    .eq("id", id)
    .single();

  if (gateError) return handleSupabaseError(gateError);

  const currentStatus = leadCheck.status;

  // Step 5: No-op Guard
  // Kein RPC-Aufruf und kein lead_status_history-Eintrag bei unverändertem Status.
  if (body.status === currentStatus) {
    return singleResponse({
      lead_id: id,
      old_status: currentStatus,
      new_status: currentStatus,
      changed: false,
    });
  }

  // Step 6: Atomarer Statuswechsel via Service Role RPC
  // changed_by = profileId aus requireAuth() — nie aus dem Request-Body.
  const adminClient = createAdminClient();
  const { data, error } = await adminClient.rpc("change_lead_status", {
    p_lead_id: id,
    p_new_status: body.status,
    p_changed_by: auth.profileId,
    p_reason: body.reason ?? null,
  });

  if (error) return handleSupabaseError(error);

  const row = Array.isArray(data) ? data[0] : data;
  return singleResponse({
    lead_id: (row as { lead_id: string } | undefined)?.lead_id ?? id,
    old_status: (row as { old_status: string } | undefined)?.old_status ?? currentStatus,
    new_status: (row as { new_status: string } | undefined)?.new_status ?? body.status,
    changed: true,
  });
}
