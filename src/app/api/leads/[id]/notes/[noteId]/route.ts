import type { NextRequest } from "next/server";
import * as z from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/api/auth";
import type { AuthContext } from "@/lib/api/auth";
import { ApiErrors, handleSupabaseError } from "@/lib/api/errors";
import { singleResponse, noContentResponse } from "@/lib/api/responses";
import { assertNoteEditableByUser } from "@/lib/api/guards";
import { UuidSchema } from "@/lib/validation/common";
import { UpdateNoteSchema } from "@/lib/validation/lead";

// PATCH /api/leads/[id]/notes/[noteId]
// Note-Inhalt updaten.
//
// Autorprüfung via assertNoteEditableByUser (bereits in guards.ts):
//   admin    → immer erlaubt
//   manager  → immer 403 (auch eigene Notes)
//   employee → nur eigene Notes (created_by = auth.profileId), sonst 403
//
// Scoping: beide .eq()-Bedingungen verhindern Cross-Lead-Zugriff auf Notes.
// RLS (lead_notes: update) dient als Sicherheitsnetz falls Guard umgangen würde.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; noteId: string }> }
) {
  let auth: AuthContext;
  try {
    auth = await requireAuth();
  } catch (e) {
    return e as Response;
  }

  const { id, noteId } = await params;
  if (!UuidSchema.safeParse(id).success) return ApiErrors.notFound("Lead");
  if (!UuidSchema.safeParse(noteId).success) return ApiErrors.notFound("Note");

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return ApiErrors.badRequest("Ungültiger JSON-Body");
  }

  const parsed = UpdateNoteSchema.safeParse(raw);
  if (!parsed.success) {
    return ApiErrors.unprocessable("Validierungsfehler", z.flattenError(parsed.error));
  }

  const body = parsed.data;

  const supabase = await createClient();

  // Note lesen für Autorenprüfung. PGRST116 = Note nicht vorhanden oder anderem Lead zugehörig.
  const { data: noteData, error: noteError } = await supabase
    .from("lead_notes")
    .select("id, created_by")
    .eq("id", noteId)
    .eq("lead_id", id)
    .single();

  if (noteError?.code === "PGRST116") return ApiErrors.notFound("Note");
  if (noteError) return handleSupabaseError(noteError);

  try {
    assertNoteEditableByUser(auth.role, noteData.created_by, auth.profileId);
  } catch (e) {
    return e as Response;
  }

  const { data, error } = await supabase
    .from("lead_notes")
    .update({ note: body.note })
    .eq("id", noteId)
    .eq("lead_id", id)
    .select()
    .single();

  if (error?.code === "PGRST116") return ApiErrors.notFound("Note");
  if (error) return handleSupabaseError(error);
  return singleResponse(data);
}

// DELETE /api/leads/[id]/notes/[noteId]
// Note löschen. Gleiche Autorprüfung wie PATCH.
// TOCTOU nach assertNoteEditableByUser: wenn Note bereits gelöscht → DELETE gibt 0 rows,
// kein Fehler — 204 korrekt (Ziel ist erreicht).
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; noteId: string }> }
) {
  let auth: AuthContext;
  try {
    auth = await requireAuth();
  } catch (e) {
    return e as Response;
  }

  const { id, noteId } = await params;
  if (!UuidSchema.safeParse(id).success) return ApiErrors.notFound("Lead");
  if (!UuidSchema.safeParse(noteId).success) return ApiErrors.notFound("Note");

  const supabase = await createClient();

  const { data: noteData, error: noteError } = await supabase
    .from("lead_notes")
    .select("id, created_by")
    .eq("id", noteId)
    .eq("lead_id", id)
    .single();

  if (noteError?.code === "PGRST116") return ApiErrors.notFound("Note");
  if (noteError) return handleSupabaseError(noteError);

  try {
    assertNoteEditableByUser(auth.role, noteData.created_by, auth.profileId);
  } catch (e) {
    return e as Response;
  }

  const { error: deleteError } = await supabase
    .from("lead_notes")
    .delete()
    .eq("id", noteId)
    .eq("lead_id", id);

  if (deleteError) return handleSupabaseError(deleteError);
  return noContentResponse();
}
