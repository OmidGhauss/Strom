import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuth } from "@/lib/api/auth";
import type { AuthContext } from "@/lib/api/auth";
import { ApiErrors, handleSupabaseError } from "@/lib/api/errors";
import { singleResponse } from "@/lib/api/responses";
import { assertContractSendable } from "@/lib/api/guards";
import { UuidSchema } from "@/lib/validation/common";
import { SendContractEmailSchema } from "@/lib/validation/lead";
import { createResendClient, getFromEmail, getCompanyName } from "@/lib/email/resend";
import { buildContractEmailHtml } from "@/lib/email/contract-email";

// Node.js runtime erforderlich für Buffer-Ops und Resend SDK.
export const runtime = "nodejs";

// POST /api/leads/[id]/offers/[offerId]/contract/send
//
// Versendet die Auftragsbestätigung per E-Mail (PDF im Anhang).
// PDF muss vor diesem Aufruf über /contract generiert worden sein (offer.contract_document_id != null).
//
// Sicherheitsinvarianten:
//   - Nur Manager/Admin (Employee → 403)
//   - Nur accepted Offers; superseded/draft/sent/rejected/expired → 409
//   - Lead-Status-Gate: nur contract_prepared / contract_sent erlaubt
//   - createAdminClient() nur nach positivem user-aware RLS-Gate
//   - RESEND_* niemals NEXT_PUBLIC_
//
// Konsistenzstrategie (kein RPC — Provider-Call ist nicht transaktional):
//   1. INSERT comm_log (pending) vor Provider-Call
//   2. Provider-Fehler → UPDATE comm_log (failed) → 502; kein Lead-Status-Update
//   3. Provider-Erfolg → UPDATE comm_log (success)
//   4. CAS Lead-Status contract_prepared → contract_sent via change_lead_status RPC
//      mit p_expected_status="contract_prepared" (echter CAS via FOR UPDATE)
//      Fehler blockiert nicht die 201-Antwort; warning.reason im Response
//
// LEAD_STATUS_MISMATCH-Semantik:
//   errors.ts mappt LEAD_STATUS_MISMATCH global auf 409 (handleSupabaseError).
//   Hier wird es lokal abgefangen und als 201 + warning: { reason: "cas_mismatch" }
//   zurückgegeben, weil die E-Mail bereits erfolgreich gesendet wurde.
//   Ein 409 wäre irreführend und könnte Client-Retries auslösen (→ Duplikat-E-Mail).
export async function POST(
  req: NextRequest,
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
  const { data: offer, error: offerError } = await supabase
    .from("offers")
    .select("*")
    .eq("id", offerId)
    .eq("lead_id", id)
    .single();

  if (offerError?.code === "PGRST116") return ApiErrors.notFound("Offer");
  if (offerError) return handleSupabaseError(offerError);

  // Guard-Reihenfolge: superseded → status ≠ accepted → employee → 403.
  try {
    assertContractSendable(auth.role, offer.status);
  } catch (e) {
    return e as Response;
  }

  if (!offer.contract_document_id) {
    return ApiErrors.unprocessable("Auftragsbestätigung muss zuerst generiert werden");
  }

  // Body parsen: leerer/fehlender Body → {}; ungültiges JSON → 400.
  const bodyText = await req.text();
  let raw: unknown;
  if (bodyText.trim() === "") {
    raw = {};
  } else {
    try {
      raw = JSON.parse(bodyText);
    } catch {
      return ApiErrors.badRequest("Ungültiger JSON-Body");
    }
  }
  const parseResult = SendContractEmailSchema.safeParse(raw);
  if (!parseResult.success) {
    return ApiErrors.unprocessable("Ungültige Eingabedaten", parseResult.error.flatten());
  }
  const body = parseResult.data;

  // Lead-Daten inkl. Status für Gate und E-Mail-Anrede.
  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("first_name, last_name, email, status")
    .eq("id", id)
    .single();

  if (leadError?.code === "PGRST116") return ApiErrors.notFound("Lead");
  if (leadError) return handleSupabaseError(leadError);

  // Lead-Status-Gate: nur contract_prepared / contract_sent erlaubt.
  let permitLeadStatusUpdate: boolean;
  if (lead.status === "contract_prepared") {
    permitLeadStatusUpdate = true;
  } else if (lead.status === "contract_sent") {
    permitLeadStatusUpdate = false;
  } else {
    return ApiErrors.conflict(
      "Auftragsbestätigung kann nur versendet werden wenn Lead-Status 'contract_prepared' oder 'contract_sent' ist"
    );
  }

  // Manager/Admin dürfen recipient_email überschreiben; Employee ist bereits 403.
  const recipientEmail =
    (auth.role === "manager" || auth.role === "admin") && body.recipient_email
      ? body.recipient_email
      : lead.email;

  // Contract-Dokument-Metadaten (storage_path, storage_bucket, file_name).
  const { data: doc, error: docError } = await supabase
    .from("documents")
    .select("storage_path, storage_bucket, file_name")
    .eq("id", offer.contract_document_id)
    .eq("lead_id", id)
    .single();

  if (docError?.code === "PGRST116") return ApiErrors.notFound("Document");
  if (docError) return handleSupabaseError(docError);

  // ENV-Check vor adminClient — sofortiger 500 wenn nicht konfiguriert.
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) {
    console.error("[contract-send] RESEND env vars nicht konfiguriert");
    return Response.json(
      { error: "E-Mail-Versand nicht konfiguriert", code: "CONFIG_ERROR" },
      { status: 500 }
    );
  }
  const companyName = getCompanyName();

  // adminClient erst nach positivem user-aware RLS-Gate.
  const adminClient = createAdminClient();

  // PDF aus Storage laden (vor comm_log INSERT — kein halbfertiger Eintrag bei Download-Fehler).
  const { data: blobData, error: downloadError } = await adminClient.storage
    .from(doc.storage_bucket)
    .download(doc.storage_path);

  if (downloadError || !blobData) {
    console.error("[storage:download-contract-pdf]", downloadError);
    return Response.json(
      { error: "PDF konnte nicht heruntergeladen werden", code: "STORAGE_ERROR" },
      { status: 500 }
    );
  }

  const pdfBuffer = Buffer.from(await blobData.arrayBuffer());

  const subject = body.subject ?? `Ihre Auftragsbestätigung ${offer.offer_number} – ${companyName}`;
  const html    = buildContractEmailHtml(offer, lead, body.message ?? null, companyName);

  // comm_log (pending) VOR Provider-Call eintragen.
  const { data: commLog, error: commLogError } = await supabase
    .from("communications_log")
    .insert({
      lead_id:            id,
      offer_id:           offerId,
      created_by:         auth.profileId,
      communication_type: "email",
      direction:          "outbound",
      subject,
      status:             "pending",
      content_summary:    `Auftragsbestätigung ${offer.offer_number} per E-Mail versendet an ${recipientEmail}`,
    })
    .select("id")
    .single();

  if (commLogError) return handleSupabaseError(commLogError);

  const commId = commLog.id;

  // E-Mail versenden.
  const resend = createResendClient();
  const { data: emailData, error: sendError } = await resend.emails.send({
    from:        getFromEmail(),
    to:          recipientEmail,
    subject,
    html,
    attachments: [{ filename: doc.file_name, content: pdfBuffer }],
  });

  if (sendError) {
    console.error("[resend:contract-send]", sendError);
    const { error: failUpdateError } = await supabase
      .from("communications_log")
      .update({ status: "failed" })
      .eq("id", commId);
    if (failUpdateError) {
      console.error("[contract-send:comm-log-failed-update]", failUpdateError);
    }
    return Response.json(
      { error: "E-Mail konnte nicht gesendet werden", code: "PROVIDER_ERROR" },
      { status: 502 }
    );
  }

  // comm_log auf success setzen.
  const { error: successUpdateError } = await supabase
    .from("communications_log")
    .update({ status: "success", external_id: emailData?.id ?? null })
    .eq("id", commId);
  if (successUpdateError) {
    console.error("[contract-send:comm-log-success-update]", successUpdateError);
  }

  // Lead-Status-CAS: contract_prepared → contract_sent.
  // Echter CAS via p_expected_status + FOR UPDATE im RPC.
  // Fehler blockiert nicht die 201-Antwort (E-Mail bereits gesendet).
  let leadStatusUpdated = false;
  let warning:
    | { reason: "already_contract_sent" | "cas_mismatch" | "lead_status_update_failed" }
    | undefined;

  if (permitLeadStatusUpdate) {
    const { error: casError } = await adminClient.rpc("change_lead_status", {
      p_lead_id:         id,
      p_new_status:      "contract_sent",
      p_changed_by:      auth.profileId,
      p_reason:          null,
      p_expected_status: "contract_prepared",
    });

    if (!casError) {
      leadStatusUpdated = true;
    } else if (casError.code === "P0001" && casError.message === "LEAD_STATUS_MISMATCH") {
      // Lead-Status wurde zwischen Gate-Check und CAS geändert.
      // E-Mail ist bereits gesendet → 201 + warning statt 409 (kein irreführender Fehler).
      leadStatusUpdated = false;
      warning = { reason: "cas_mismatch" };
      console.error("[contract-send:cas-mismatch]", casError.message);
    } else {
      leadStatusUpdated = false;
      warning = { reason: "lead_status_update_failed" };
      console.error("[contract-send:lead-status-update]", casError);
    }
  } else {
    // Lead war bereits contract_sent — Re-Send erlaubt, kein weiterer Statuswechsel.
    leadStatusUpdated = false;
    warning = { reason: "already_contract_sent" };
  }

  return singleResponse(
    {
      communication_id:    commId,
      offer_id:            offerId,
      recipient_email:     recipientEmail,
      lead_status_updated: leadStatusUpdated,
      ...(warning ? { warning } : {}),
    },
    201
  );
}
