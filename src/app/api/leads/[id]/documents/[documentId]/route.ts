import type { NextRequest } from "next/server";
import * as z from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/api/auth";
import type { AuthContext } from "@/lib/api/auth";
import { ApiErrors, handleSupabaseError } from "@/lib/api/errors";
import { singleResponse, noContentResponse } from "@/lib/api/responses";
import {
  assertDocumentImmutableFields,
  assertDocumentFieldsByRole,
  assertDocumentEditableByUser,
} from "@/lib/api/guards";
import { UuidSchema } from "@/lib/validation/common";
import { UpdateDocumentSchema } from "@/lib/validation/lead";

// PATCH /api/leads/[id]/documents/[documentId]
//
// Patchbare Felder: file_name, ocr_status, ocr_text, ocr_processed_at.
// Immutable (400): document_type, storage_path, storage_bucket, lead_id, uploaded_by.
// Systemfelder (403, alle Rollen): mime_type, file_size_bytes.
// OCR-Felder (403, non-admin): ocr_status, ocr_text, ocr_processed_at.
//
// assertDocumentImmutableFields läuft auf raw JSON VOR Zod — verhindert stilles Stripping.
// assertDocumentFieldsByRole läuft ebenfalls auf raw (nach Ownership-Check) —
// fängt mime_type/file_size_bytes auch dann, wenn sie im Schema fehlen.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; documentId: string }> }
) {
  let auth: AuthContext;
  try {
    auth = await requireAuth();
  } catch (e) {
    return e as Response;
  }

  const { id, documentId } = await params;
  if (!UuidSchema.safeParse(id).success) return ApiErrors.notFound("Lead");
  if (!UuidSchema.safeParse(documentId).success) return ApiErrors.notFound("Document");

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return ApiErrors.badRequest("Ungültiger JSON-Body");
  }

  // Immutable-Guard auf raw VOR Zod: document_type, storage_path etc. → 400.
  try {
    assertDocumentImmutableFields(raw as Record<string, unknown>);
  } catch (e) {
    return e as Response;
  }

  const parsed = UpdateDocumentSchema.safeParse(raw);
  if (!parsed.success) {
    return ApiErrors.unprocessable("Validierungsfehler", z.flattenError(parsed.error));
  }

  const body = parsed.data;

  if (Object.keys(body).length === 0) {
    return ApiErrors.badRequest("Mindestens ein Feld erforderlich");
  }

  const supabase = await createClient();

  // Dokument lesen: uploaded_by für Ownership-Guard.
  const { data: doc, error: readError } = await supabase
    .from("documents")
    .select("id, uploaded_by")
    .eq("id", documentId)
    .eq("lead_id", id)
    .single();

  if (readError?.code === "PGRST116") return ApiErrors.notFound("Document");
  if (readError) return handleSupabaseError(readError);

  // Ownership-Check: Employee nur eigene Dokumente.
  try {
    assertDocumentEditableByUser(auth.role, doc.uploaded_by, auth.profileId);
  } catch (e) {
    return e as Response;
  }

  // Feldrestriktionen auf raw: mime_type/file_size_bytes (alle Rollen), OCR (non-admin).
  try {
    assertDocumentFieldsByRole(auth.role, raw as Record<string, unknown>);
  } catch (e) {
    return e as Response;
  }

  const { data, error } = await supabase
    .from("documents")
    .update(body)
    .eq("id", documentId)
    .eq("lead_id", id)
    .select()
    .single();

  if (error?.code === "PGRST116") return ApiErrors.notFound("Document");
  if (error) return handleSupabaseError(error);
  return singleResponse(data);
}

// DELETE /api/leads/[id]/documents/[documentId]
// Admin-only. RLS (is_admin()) als Sicherheitsnetz.
// Idempotent: 204 auch wenn 0 Rows.
// Technische Schuld: Storage-Datei wird NICHT gelöscht — nur DB-Metadaten.
// Storage-Cleanup folgt im späteren Upload/Storage-Block.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; documentId: string }> }
) {
  let auth: AuthContext;
  try {
    auth = await requireAuth();
  } catch (e) {
    return e as Response;
  }

  const { id, documentId } = await params;
  if (!UuidSchema.safeParse(id).success) return ApiErrors.notFound("Lead");
  if (!UuidSchema.safeParse(documentId).success) return ApiErrors.notFound("Document");

  if (auth.role !== "admin") {
    return ApiErrors.forbidden("Nur Admin darf Dokumente löschen");
  }

  const supabase = await createClient();

  const { error } = await supabase
    .from("documents")
    .delete()
    .eq("id", documentId)
    .eq("lead_id", id);

  if (error) return handleSupabaseError(error);
  return noContentResponse();
}
