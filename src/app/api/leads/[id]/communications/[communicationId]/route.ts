import type { NextRequest } from "next/server";
import * as z from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/api/auth";
import type { AuthContext } from "@/lib/api/auth";
import { ApiErrors, handleSupabaseError } from "@/lib/api/errors";
import { singleResponse, noContentResponse } from "@/lib/api/responses";
import { assertCommunicationEditableByUser } from "@/lib/api/guards";
import { UuidSchema } from "@/lib/validation/common";
import { UpdateCommunicationSchema } from "@/lib/validation/lead";

// PATCH /api/leads/[id]/communications/[communicationId]
//
// Nur erlaubte Felder: status, content_summary, external_id.
// Gesperrte Felder: lead_id, offer_id, communication_type, direction, subject, created_by.
//
// Rollenlogik:
//   admin/manager → alle Communications
//   employee     → nur eigene (created_by === profileId)
//
// Scoping: .eq("id", communicationId).eq("lead_id", id) auf alle Queries.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; communicationId: string }> }
) {
  let auth: AuthContext;
  try {
    auth = await requireAuth();
  } catch (e) {
    return e as Response;
  }

  const { id, communicationId } = await params;
  if (!UuidSchema.safeParse(id).success) return ApiErrors.notFound("Lead");
  if (!UuidSchema.safeParse(communicationId).success)
    return ApiErrors.notFound("Communication");

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return ApiErrors.badRequest("Ungültiger JSON-Body");
  }

  const parsed = UpdateCommunicationSchema.safeParse(raw);
  if (!parsed.success) {
    return ApiErrors.unprocessable("Validierungsfehler", z.flattenError(parsed.error));
  }

  const body = parsed.data;

  if (Object.keys(body).length === 0) {
    return ApiErrors.badRequest("Mindestens ein Feld erforderlich");
  }

  const supabase = await createClient();

  // Communication lesen: created_by für Guard.
  const { data: communication, error: readError } = await supabase
    .from("communications_log")
    .select("id, created_by")
    .eq("id", communicationId)
    .eq("lead_id", id)
    .single();

  if (readError?.code === "PGRST116") return ApiErrors.notFound("Communication");
  if (readError) return handleSupabaseError(readError);

  try {
    assertCommunicationEditableByUser(
      auth.role,
      communication.created_by,
      auth.profileId
    );
  } catch (e) {
    return e as Response;
  }

  const { data, error } = await supabase
    .from("communications_log")
    .update(body)
    .eq("id", communicationId)
    .eq("lead_id", id)
    .select()
    .single();

  if (error?.code === "PGRST116") return ApiErrors.notFound("Communication");
  if (error) return handleSupabaseError(error);
  return singleResponse(data);
}

// DELETE /api/leads/[id]/communications/[communicationId]
// Admin-only. RLS (is_admin()) als Sicherheitsnetz.
// Idempotent: 204 auch wenn 0 rows (Communication nicht vorhanden oder bereits gelöscht).
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; communicationId: string }> }
) {
  let auth: AuthContext;
  try {
    auth = await requireAuth();
  } catch (e) {
    return e as Response;
  }

  const { id, communicationId } = await params;
  if (!UuidSchema.safeParse(id).success) return ApiErrors.notFound("Lead");
  if (!UuidSchema.safeParse(communicationId).success)
    return ApiErrors.notFound("Communication");

  if (auth.role !== "admin") {
    return ApiErrors.forbidden("Nur Admin darf Kommunikationseinträge löschen");
  }

  const supabase = await createClient();

  const { error } = await supabase
    .from("communications_log")
    .delete()
    .eq("id", communicationId)
    .eq("lead_id", id);

  if (error) return handleSupabaseError(error);
  return noContentResponse();
}
