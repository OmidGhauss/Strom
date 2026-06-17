import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuth } from "@/lib/api/auth";
import type { AuthContext } from "@/lib/api/auth";
import { ApiErrors, handleSupabaseError } from "@/lib/api/errors";
import { singleResponse } from "@/lib/api/responses";
import { assertOfferSendable } from "@/lib/api/guards";
import { UuidSchema } from "@/lib/validation/common";
import { SendOfferEmailSchema } from "@/lib/validation/lead";
import { createResendClient, getFromEmail, getCompanyName } from "@/lib/email/resend";
import { buildOfferEmailHtml } from "@/lib/email/offer-email";

// Node.js runtime erforderlich für Buffer-Ops und Resend SDK.
export const runtime = "nodejs";

// POST /api/leads/[id]/offers/[offerId]/send
//
// Versendet das Angebot per E-Mail (PDF im Anhang).
// PDF muss vor diesem Aufruf über /pdf generiert worden sein (offer.pdf_document_id != null).
//
// Sicherheitsinvarianten:
//   - Employee darf recipient_email nicht überschreiben → leads.email
//   - Superseded-Angebote werden nie versendet
//   - Terminal-Statuse (accepted/rejected/expired) → 409
//   - createAdminClient() nur nach positivem user-aware RLS-Gate
//   - RESEND_* niemals NEXT_PUBLIC_
//
// Konsistenzstrategie (kein RPC — Provider-Call ist nicht transaktional):
//   1. INSERT comm_log (pending) vor Provider-Call
//   2. Provider-Fehler → UPDATE comm_log (failed) → 502
//   3. Provider-Erfolg → UPDATE comm_log (success) + CAS offer draft→sent
//   4. CAS nur wenn offer.status === "draft" (Re-Send bei sent: kein Update, kein Warning)
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

  // RLS-Gate: Offer lesen — sichert Lead-Zugriff, liefert PDF-Document-ID und Status.
  const { data: offer, error: offerError } = await supabase
    .from("offers")
    .select("*")
    .eq("id", offerId)
    .eq("lead_id", id)
    .single();

  if (offerError?.code === "PGRST116") return ApiErrors.notFound("Offer");
  if (offerError) return handleSupabaseError(offerError);

  try {
    assertOfferSendable(auth.role, offer.created_by, auth.profileId, offer.status);
  } catch (e) {
    return e as Response;
  }

  if (!offer.pdf_document_id) {
    return ApiErrors.unprocessable("PDF muss zuerst generiert werden");
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
  const parseResult = SendOfferEmailSchema.safeParse(raw);
  if (!parseResult.success) {
    return ApiErrors.unprocessable("Ungültige Eingabedaten", parseResult.error.flatten());
  }
  const body = parseResult.data;

  // Employee darf recipient_email nicht überschreiben — Privacy-Schutz.
  if (auth.role === "employee" && body.recipient_email) {
    return ApiErrors.forbidden("Employees dürfen die Empfänger-E-Mail nicht überschreiben");
  }

  // Lead-Daten für E-Mail-Anrede und Fallback-Empfänger.
  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("first_name, last_name, email")
    .eq("id", id)
    .single();

  if (leadError?.code === "PGRST116") return ApiErrors.notFound("Lead");
  if (leadError) return handleSupabaseError(leadError);

  // Manager/Admin dürfen recipient_email überschreiben; Employee → leads.email.
  const recipientEmail =
    (auth.role === "manager" || auth.role === "admin") && body.recipient_email
      ? body.recipient_email
      : lead.email;

  // PDF-Dokument-Metadaten (storage_path, storage_bucket, file_name).
  const { data: doc, error: docError } = await supabase
    .from("documents")
    .select("storage_path, storage_bucket, file_name")
    .eq("id", offer.pdf_document_id)
    .eq("lead_id", id)
    .single();

  if (docError?.code === "PGRST116") return ApiErrors.notFound("Document");
  if (docError) return handleSupabaseError(docError);

  // ENV-Check vor adminClient — sofortiger 500 wenn nicht konfiguriert.
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) {
    console.error("[send-offer] RESEND env vars nicht konfiguriert");
    return Response.json(
      { error: "E-Mail-Versand nicht konfiguriert", code: "CONFIG_ERROR" },
      { status: 500 }
    );
  }
  const companyName = getCompanyName();

  // adminClient erst nach positivem user-aware RLS-Gate.
  const adminClient = createAdminClient();

  // PDF aus Storage laden.
  const { data: blobData, error: downloadError } = await adminClient.storage
    .from(doc.storage_bucket)
    .download(doc.storage_path);

  if (downloadError || !blobData) {
    console.error("[storage:download-pdf]", downloadError);
    return Response.json(
      { error: "PDF konnte nicht heruntergeladen werden", code: "STORAGE_ERROR" },
      { status: 500 }
    );
  }

  const pdfBuffer = Buffer.from(await blobData.arrayBuffer());

  const subject = body.subject ?? `Ihr Angebot ${offer.offer_number} – ${companyName}`;
  const html    = buildOfferEmailHtml(offer, lead, body.message ?? null, companyName);

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
      content_summary:    `Angebot ${offer.offer_number} per E-Mail versendet an ${recipientEmail}`,
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
    console.error("[resend:send]", sendError);
    const { error: failUpdateError } = await supabase
      .from("communications_log")
      .update({ status: "failed" })
      .eq("id", commId);
    if (failUpdateError) {
      console.error("[send:comm-log-failed-update]", failUpdateError);
    }
    return Response.json(
      { error: "E-Mail-Versand fehlgeschlagen", code: "PROVIDER_ERROR" },
      { status: 502 }
    );
  }

  // comm_log auf success setzen.
  const { error: successUpdateError } = await supabase
    .from("communications_log")
    .update({ status: "success", external_id: emailData.id })
    .eq("id", commId);
  if (successUpdateError) {
    console.error("[send:comm-log-success-update]", successUpdateError);
  }

  // CAS: draft → sent — nur wenn Offer noch im draft-Status war.
  // Re-Send bei status="sent": kein Update, kein Warning.
  let statusUpdated = false;
  let warning: string | undefined;

  if (offer.status === "draft") {
    const { data: updatedOffer, error: casError } = await supabase
      .from("offers")
      .update({ status: "sent" })
      .eq("id", offerId)
      .eq("lead_id", id)
      .eq("status", "draft")
      .select("status")
      .single();

    if (!casError && updatedOffer !== null) {
      statusUpdated = true;
    } else if (casError) {
      if (casError.code === "PGRST116") {
        warning = "Angebot war bereits gesendet (kein Statuswechsel)";
      } else {
        console.error("[offers:cas-sent]", casError);
      }
    }
  }

  return singleResponse(
    {
      communication_id: commId,
      offer_id:         offerId,
      recipient_email:  recipientEmail,
      status_updated:   statusUpdated,
      ...(warning ? { warning } : {}),
    },
    201
  );
}
