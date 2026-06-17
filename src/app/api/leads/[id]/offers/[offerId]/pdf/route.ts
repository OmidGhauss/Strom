import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuth } from "@/lib/api/auth";
import type { AuthContext } from "@/lib/api/auth";
import { ApiErrors, handleSupabaseError } from "@/lib/api/errors";
import { singleResponse } from "@/lib/api/responses";
import { assertOfferPdfGenerationAllowed } from "@/lib/api/guards";
import { UuidSchema } from "@/lib/validation/common";
import { generateOfferPdf } from "@/lib/pdf/offer-pdf";

// Node.js runtime erforderlich für pdf-lib (kein Edge-Runtime-Support).
export const runtime = "nodejs";

// POST /api/leads/[id]/offers/[offerId]/pdf
//
// Generiert ein Offer-PDF synchron (pdf-lib), lädt es in Supabase Storage hoch
// und registriert es atomar über register_offer_pdf RPC.
//
// Kein Request-Body — alle Daten kommen aus der DB.
// Kein E-Mail-Versand, kein Statuswechsel, kein communications_log in diesem Block.
//
// Konsistenzstrategie:
//   1. Storage upload neu (Block bei Fehler → kein DB-Side-Effect)
//   2. RPC atomar: DELETE old doc + INSERT new doc + UPDATE offer.pdf_document_id
//      Bei RPC-Fehler → best-effort cleanup neues Storage-File → handleSupabaseError
//   3. Storage delete altes File (best-effort nach RPC-Erfolg, Fehler nur loggen)
//
// adminClient wird AUSSCHLIESSLICH nach positivem user-aware RLS-Gate aufgerufen.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; offerId: string }> }
) {
  let auth: AuthContext;
  try {
    auth = await requireAuth();
  } catch (e) {
    return e as Response;
  }

  const { id, offerId } = await params;
  if (!UuidSchema.safeParse(id).success)      return ApiErrors.notFound("Lead");
  if (!UuidSchema.safeParse(offerId).success) return ApiErrors.notFound("Offer");

  const supabase = await createClient();

  // RLS-Gate: Offer lesen (user-aware) — sichert Lead-Zugriff und liefert PDF-Daten.
  // select("*") statt Spaltenliste: Supabase TypeScript-Inferenz ist bei langen
  // Select-Strings mit manuell gepflegten Database-Typen nicht stabil.
  const { data: offer, error: offerError } = await supabase
    .from("offers")
    .select("*")
    .eq("id", offerId)
    .eq("lead_id", id)
    .single();

  if (offerError?.code === "PGRST116") return ApiErrors.notFound("Offer");
  if (offerError) return handleSupabaseError(offerError);

  // Rollencheck: superseded → 409, employee + fremde Offer → 403.
  try {
    assertOfferPdfGenerationAllowed(auth.role, offer.created_by, auth.profileId, offer.status);
  } catch (e) {
    return e as Response;
  }

  // Lead-Daten für PDF-Inhalt.
  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("first_name, last_name")
    .eq("id", id)
    .single();

  if (leadError?.code === "PGRST116") return ApiErrors.notFound("Lead");
  if (leadError) return handleSupabaseError(leadError);

  // PDF in Memory generieren.
  const pdfBytes = await generateOfferPdf(offer, lead);

  const newDocumentId = crypto.randomUUID();
  const storagePath   = `${id}/offer_pdf/${newDocumentId}.pdf`;
  const fileName      = `Angebot-${offer.offer_number}.pdf`;

  // adminClient erst nach positivem Gate.
  const adminClient = createAdminClient();

  // Storage upload (neues PDF).
  const { error: uploadError } = await adminClient.storage
    .from("documents")
    .upload(storagePath, Buffer.from(pdfBytes), {
      contentType: "application/pdf",
      upsert: false,
    });

  if (uploadError) {
    console.error("[storage:upload]", uploadError.message);
    return Response.json(
      { error: "PDF konnte nicht in Storage hochgeladen werden", code: "STORAGE_ERROR" },
      { status: 500 }
    );
  }

  // RPC: atomic DELETE old doc + INSERT new doc + UPDATE offer.pdf_document_id.
  const { data: rpcData, error: rpcError } = await adminClient.rpc(
    "register_offer_pdf",
    {
      p_offer_id:        offerId,
      p_lead_id:         id,
      p_new_document_id: newDocumentId,
      p_file_name:       fileName,
      p_storage_path:    storagePath,
      p_file_size_bytes: pdfBytes.byteLength,
    }
  );

  if (rpcError) {
    // Best-effort cleanup des soeben hochgeladenen Storage-Files.
    // Supabase Storage gibt Fehler als { error } zurück, kein Promise-Reject.
    const { error: cleanupError } = await adminClient.storage
      .from("documents")
      .remove([storagePath]);
    if (cleanupError) {
      console.error("[storage:cleanup-new-pdf]", cleanupError);
    }
    return handleSupabaseError(rpcError);
  }

  const result = (rpcData as Array<{
    document_id: string;
    old_storage_bucket: string | null;
    old_storage_path: string | null;
  }>)?.[0];

  if (!result) {
    console.error("[register_offer_pdf] RPC returned no row");
    return Response.json(
      { error: "PDF konnte nicht registriert werden", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }

  // Best-effort: altes Storage-File löschen (nach erfolgreichem RPC-Commit).
  // Storage-Ziel kommt aus dem RPC-Return (nicht aus Route-Parameter).
  // Supabase Storage gibt Fehler als { error } zurück, kein Promise-Reject.
  if (result.old_storage_path !== null && result.old_storage_bucket !== null) {
    const { error: oldCleanupError } = await adminClient.storage
      .from(result.old_storage_bucket)
      .remove([result.old_storage_path]);
    if (oldCleanupError) {
      console.error("[storage:cleanup-old-pdf]", oldCleanupError);
    }
  }

  return singleResponse({ document_id: newDocumentId, offer_id: offerId }, 201);
}
