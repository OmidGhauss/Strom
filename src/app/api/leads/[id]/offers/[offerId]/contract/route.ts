import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuth } from "@/lib/api/auth";
import type { AuthContext } from "@/lib/api/auth";
import { ApiErrors, handleSupabaseError } from "@/lib/api/errors";
import { singleResponse } from "@/lib/api/responses";
import { assertContractGenerationAllowed } from "@/lib/api/guards";
import { UuidSchema } from "@/lib/validation/common";
import { generateContractPdf } from "@/lib/pdf/contract-pdf";

// Node.js runtime erforderlich für pdf-lib (kein Edge-Runtime-Support).
export const runtime = "nodejs";

// POST /api/leads/[id]/offers/[offerId]/contract
//
// Generiert eine Auftragsbestätigung-PDF (technisch: contract_pdf) für ein accepted Offer.
// Kein Request-Body — alle Daten kommen aus der DB.
//
// Fachlich: V1-Auftragsbestätigung, kein rechtsverbindliches Vertragsdokument.
//
// Sicherheitsinvarianten:
//   - Nur Manager/Admin (Employee → 403)
//   - Nur accepted Offers; superseded/draft/sent/rejected/expired → 409
//   - createAdminClient() nur nach positivem user-aware RLS-Gate
//
// Konsistenzstrategie (analog Block 18 / register_offer_pdf):
//   1. PDF in Memory generieren (kein Seiteneffekt)
//   2. Storage upload neues File
//   3. RPC register_contract_pdf (atomar: DELETE old doc + INSERT new doc + UPDATE offer)
//      Bei RPC-Fehler → best-effort cleanup neues Storage-File
//   4. Altes Storage-File löschen (best-effort nach RPC-Commit)
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

  // RLS-Gate: Offer lesen (user-aware) — sichert Lead-Zugriff.
  // select("*"): Supabase TypeScript-Inferenz bei langen Select-Strings nicht stabil.
  const { data: offer, error: offerError } = await supabase
    .from("offers")
    .select("*")
    .eq("id", offerId)
    .eq("lead_id", id)
    .single();

  if (offerError?.code === "PGRST116") return ApiErrors.notFound("Offer");
  if (offerError) return handleSupabaseError(offerError);

  // Rollencheck + Status-Check: Employee → 403; non-accepted → 409.
  try {
    assertContractGenerationAllowed(auth.role, offer.status);
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
  const pdfBytes = await generateContractPdf(offer, lead);

  const newDocumentId = crypto.randomUUID();
  const storagePath   = `${id}/contract_pdf/${newDocumentId}.pdf`;
  const fileName      = `Auftragsbestaetigung-${offer.offer_number}.pdf`;

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
    console.error("[storage:upload-contract]", uploadError.message);
    return Response.json(
      {
        error: "Auftragsbestätigung konnte nicht in Storage hochgeladen werden",
        code:  "STORAGE_ERROR",
      },
      { status: 500 }
    );
  }

  // RPC: atomar DELETE old contract doc + INSERT new doc + UPDATE offers.contract_document_id.
  const { data: rpcData, error: rpcError } = await adminClient.rpc(
    "register_contract_pdf",
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
    const { error: cleanupError } = await adminClient.storage
      .from("documents")
      .remove([storagePath]);
    if (cleanupError) {
      console.error("[storage:cleanup-new-contract]", cleanupError);
    }
    return handleSupabaseError(rpcError);
  }

  const result = (rpcData as Array<{
    document_id:        string;
    old_storage_bucket: string | null;
    old_storage_path:   string | null;
  }>)?.[0];

  if (!result) {
    console.error("[register_contract_pdf] RPC returned no row");
    const { error: cleanupError } = await adminClient.storage
      .from("documents")
      .remove([storagePath]);
    if (cleanupError) {
      console.error("[storage:cleanup-new-contract-no-result]", cleanupError);
    }
    return Response.json(
      { error: "Auftragsbestätigung konnte nicht registriert werden", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }

  // Best-effort: altes Storage-File löschen (nach erfolgreichem RPC-Commit).
  if (result.old_storage_path !== null && result.old_storage_bucket !== null) {
    const { error: oldCleanupError } = await adminClient.storage
      .from(result.old_storage_bucket)
      .remove([result.old_storage_path]);
    if (oldCleanupError) {
      console.error("[storage:cleanup-old-contract]", oldCleanupError);
    }
  }

  return singleResponse({ document_id: newDocumentId, offer_id: offerId }, 201);
}
