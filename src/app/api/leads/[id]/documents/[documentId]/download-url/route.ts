import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuth } from "@/lib/api/auth";
import { ApiErrors, handleSupabaseError } from "@/lib/api/errors";
import { singleResponse } from "@/lib/api/responses";
import { UuidSchema } from "@/lib/validation/common";

// GET /api/leads/[id]/documents/[documentId]/download-url
//
// Erzeugt eine Signed Download URL (3600 Sekunden Gültigkeit).
// Für alle Dokumenttypen erlaubt — auch offer_pdf/contract_pdf.
// Kein Ownership-Check: alle Nutzer mit Lead-Zugriff (via RLS) dürfen downloaden.
//
// adminClient wird AUSSCHLIESSLICH nach positivem user-aware RLS-Gate aufgerufen.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; documentId: string }> }
) {
  try {
    await requireAuth();
  } catch (e) {
    return e as Response;
  }

  const { id, documentId } = await params;
  if (!UuidSchema.safeParse(id).success) return ApiErrors.notFound("Lead");
  if (!UuidSchema.safeParse(documentId).success) return ApiErrors.notFound("Document");

  const supabase = await createClient();

  const { data: doc, error: readError } = await supabase
    .from("documents")
    .select("id, storage_path, storage_bucket")
    .eq("id", documentId)
    .eq("lead_id", id)
    .single();

  if (readError?.code === "PGRST116") return ApiErrors.notFound("Document");
  if (readError) return handleSupabaseError(readError);

  // adminClient erst nach positivem Gate.
  const adminClient = createAdminClient();
  const { data: downloadData, error: storageError } = await adminClient.storage
    .from(doc.storage_bucket)
    .createSignedUrl(doc.storage_path, 3600);

  if (storageError || !downloadData) {
    console.error("[storage:createSignedUrl]", storageError?.message);
    return Response.json(
      { error: "Signed Download URL konnte nicht erstellt werden", code: "STORAGE_ERROR" },
      { status: 500 }
    );
  }

  return singleResponse({ signedUrl: downloadData.signedUrl, expiresIn: 3600 });
}
