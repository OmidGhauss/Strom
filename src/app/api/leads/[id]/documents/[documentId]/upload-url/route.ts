import type { NextRequest } from "next/server";
import * as z from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuth } from "@/lib/api/auth";
import type { AuthContext } from "@/lib/api/auth";
import { ApiErrors, handleSupabaseError } from "@/lib/api/errors";
import { singleResponse } from "@/lib/api/responses";
import { assertDocumentEditableByUser } from "@/lib/api/guards";
import { UuidSchema } from "@/lib/validation/common";
import { UploadUrlRequestSchema, MANUAL_DOCUMENT_TYPES } from "@/lib/validation/lead";

// POST /api/leads/[id]/documents/[documentId]/upload-url
//
// Erzeugt eine Signed Upload URL für einen bestehenden Document-Metadaten-Eintrag.
// Der Client lädt die Datei anschließend direkt an Supabase Storage hoch (Option B).
//
// Einschränkungen:
//   - Nur für MANUAL_DOCUMENT_TYPES (invoice, cancellation_confirmation, power_of_attorney, other)
//   - offer_pdf/contract_pdf → 403 (reserviert für systemgenerierte Prozesse)
//   - Employee nur eigene Dokumente (uploaded_by === profileId)
//
// mime_type/file_size_bytes im Body: client-provided/unverifiziert.
//   Bucket-Limits erzwingen echte Einschränkungen beim tatsächlichen Upload.
//   Späterer OCR/Storage-Block kann diese Werte überschreiben.
//
// adminClient wird AUSSCHLIESSLICH nach positivem user-aware RLS-Gate aufgerufen.
export async function POST(
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

  // Leerer Body ist erlaubt — request.text() statt request.json() für sicheres Parsing.
  let raw: unknown = {};
  const text = await request.text();
  if (text.trim()) {
    try {
      raw = JSON.parse(text);
    } catch {
      return ApiErrors.badRequest("Ungültiger JSON-Body");
    }
  }

  const parsed = UploadUrlRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return ApiErrors.unprocessable("Validierungsfehler", z.flattenError(parsed.error));
  }

  const body = parsed.data;

  const supabase = await createClient();

  const { data: doc, error: readError } = await supabase
    .from("documents")
    .select("id, document_type, storage_path, storage_bucket, uploaded_by")
    .eq("id", documentId)
    .eq("lead_id", id)
    .single();

  if (readError?.code === "PGRST116") return ApiErrors.notFound("Document");
  if (readError) return handleSupabaseError(readError);

  // Upload-URL nur für manuelle Dokumenttypen.
  // offer_pdf/contract_pdf sind für PDF-Pipeline reserviert.
  if (!(MANUAL_DOCUMENT_TYPES as readonly string[]).includes(doc.document_type)) {
    return ApiErrors.forbidden(
      "Upload-URL kann nur für manuelle Dokumenttypen erstellt werden"
    );
  }

  try {
    assertDocumentEditableByUser(auth.role, doc.uploaded_by, auth.profileId);
  } catch (e) {
    return e as Response;
  }

  // mime_type/file_size_bytes optional in DB speichern (client-provided, unverifiziert).
  // Dieser Update-Kontext ist upload-spezifisch — assertDocumentFieldsByRole gilt hier nicht.
  if (body.mime_type !== undefined || body.file_size_bytes !== undefined) {
    const { error: metaError } = await supabase
      .from("documents")
      .update({
        ...(body.mime_type !== undefined && { mime_type: body.mime_type }),
        ...(body.file_size_bytes !== undefined && { file_size_bytes: body.file_size_bytes }),
      })
      .eq("id", documentId)
      .eq("lead_id", id);

    if (metaError) return handleSupabaseError(metaError);
  }

  // adminClient erst nach positivem Gate.
  const adminClient = createAdminClient();
  const { data: uploadData, error: storageError } = await adminClient.storage
    .from(doc.storage_bucket)
    .createSignedUploadUrl(doc.storage_path, { upsert: true });

  if (storageError || !uploadData) {
    console.error("[storage:createSignedUploadUrl]", storageError?.message);
    return Response.json(
      { error: "Signed Upload URL konnte nicht erstellt werden", code: "STORAGE_ERROR" },
      { status: 500 }
    );
  }

  return singleResponse({
    signedUrl: uploadData.signedUrl,
    token:     uploadData.token,
    path:      uploadData.path,
  });
}
