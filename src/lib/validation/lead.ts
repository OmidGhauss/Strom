import * as z from "zod";

// Alle 14 lead_status-Enum-Werte aus der DB-Migration (Block 2).
export const LEAD_STATUS_VALUES = [
  "new",
  "in_review",
  "question_open",
  "offer_created",
  "offer_sent",
  "interested",
  "contract_prepared",
  "contract_sent",
  "completed",
  "rejected",
  "unreachable",
  "follow_up",
  "disqualified",
  "lost",
] as const;

// Für PATCH /api/leads/[id].
// Nicht enthalten: product_type (nur atomar mit energy_demands änderbar),
// privacy_consent, contact_consent, source, utm_* (unveränderlich nach Lead-Erstellung).
export const UpdateLeadSchema = z.object({
  first_name: z.string().min(1).max(100).optional(),
  last_name: z.string().min(1).max(100).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(50).nullable().optional(),
  customer_type: z
    .enum(["private", "business", "property_management", "multi_location_company"])
    .optional(),
  score: z.number().int().min(0).max(100).optional(),
  assigned_to: z.string().uuid().nullable().optional(),
  data_transfer_consent: z.boolean().nullable().optional(),
});

export type UpdateLeadInput = z.infer<typeof UpdateLeadSchema>;

// Für PATCH /api/leads/[id]/status.
export const UpdateLeadStatusSchema = z.object({
  status: z.enum(LEAD_STATUS_VALUES),
  reason: z.string().max(500).optional(),
});

export type UpdateLeadStatusInput = z.infer<typeof UpdateLeadStatusSchema>;

// Für PATCH /api/leads/[id]/addresses/[addressType]
export const AddressTypeSchema = z.enum(["delivery", "billing", "contact"]);

// Alle Felder optional — echte PATCH-Semantik: omitted = unveränderlich.
// Felder ohne .nullable(): wenn angegeben, muss ein Non-Null-String kommen.
// Felder mit .nullable(): können explizit auf null gesetzt werden (Wert löschen).
export const UpdateAddressSchema = z.object({
  street:           z.string().min(1).max(500).optional(),
  house_number:     z.string().max(50).nullable().optional(),
  address_addition: z.string().max(200).nullable().optional(),
  postal_code:      z.string().min(1).max(20).optional(),
  city:             z.string().min(1).max(200).optional(),
  state:            z.string().max(200).nullable().optional(),
  country:          z.string().min(1).max(10).optional(),
});

export type UpdateAddressInput = z.infer<typeof UpdateAddressSchema>;

// Für PATCH /api/leads/[id]/energy-demands/[energyType]
export const EnergyTypeSchema = z.enum(["electricity", "gas"]);

// hot_water_with_gas: DB-CHECK (nur gas) wird inline in der Route geprüft —
// Zod kennt den energyType aus der URL nicht.
export const UpdateEnergyDemandSchema = z.object({
  annual_consumption_kwh:    z.number().min(0).nullable().optional(),
  consumption_known:         z.boolean().nullable().optional(),
  household_size:            z.number().int().min(1).nullable().optional(),
  living_area_sqm:           z.number().min(0).nullable().optional(),
  heating_type:              z.string().max(100).nullable().optional(),
  hot_water_with_gas:        z.boolean().nullable().optional(),
  current_provider:          z.string().max(200).nullable().optional(),
  current_tariff:            z.string().max(200).nullable().optional(),
  monthly_payment:           z.number().min(0).nullable().optional(),
  contract_end_date:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ungültiges Datumsformat (YYYY-MM-DD)").nullable().optional(),
  cancellation_period_known: z.boolean().nullable().optional(),
  price_guarantee:           z.boolean().nullable().optional(),
  meter_number:              z.string().max(100).nullable().optional(),
  market_location_id:        z.string().max(100).nullable().optional(),
});

export type UpdateEnergyDemandInput = z.infer<typeof UpdateEnergyDemandSchema>;

// Für PATCH /api/leads/[id]/product-type
export const UpdateProductTypeSchema = z.object({
  product_type: z.enum(["electricity", "gas", "both"]),
});

export type UpdateProductTypeInput = z.infer<typeof UpdateProductTypeSchema>;

// Für POST /api/leads/[id]/notes
// created_by ist kein Schema-Feld — immer serverseitig aus auth.profileId gesetzt.
export const CreateNoteSchema = z.object({
  note: z.string().min(1).max(10000),
});

export type CreateNoteInput = z.infer<typeof CreateNoteSchema>;

// Für PATCH /api/leads/[id]/notes/[noteId]
// note ist required — einziges patchbares Feld, leerer Body oder fehlendes note → 422.
export const UpdateNoteSchema = z.object({
  note: z.string().min(1).max(10000),
});

export type UpdateNoteInput = z.infer<typeof UpdateNoteSchema>;

// Für POST /api/leads/[id]/offers
// Serverseitig gesetzt (nie aus Body): lead_id, status, created_by, offer_number, version, parent_offer_id, pdf_document_id
export const CreateOfferSchema = z.object({
  energy_demand_id:  z.string().uuid().nullable().optional(),
  provider_name:     z.string().min(1).max(500),
  tariff_name:       z.string().min(1).max(500),
  energy_type:       z.enum(["electricity", "gas"]),
  monthly_price:     z.number().min(0).nullable().optional(),
  annual_price:      z.number().min(0).nullable().optional(),
  estimated_savings: z.number().nullable().optional(),
  valid_until:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ungültiges Datumsformat (YYYY-MM-DD)").nullable().optional(),
  notes:             z.string().max(10000).nullable().optional(),
});

export type CreateOfferInput = z.infer<typeof CreateOfferSchema>;

// Für PATCH /api/leads/[id]/offers/[offerId]
// Gesperrte Felder: lead_id, status, created_by, offer_number, version, parent_offer_id, pdf_document_id
// estimated_savings ohne min(0): negative Werte sind semantisch erlaubt (Aufpreis statt Ersparnis).
export const UpdateOfferSchema = z.object({
  energy_demand_id:  z.string().uuid().nullable().optional(),
  provider_name:     z.string().min(1).max(500).optional(),
  tariff_name:       z.string().min(1).max(500).optional(),
  energy_type:       z.enum(["electricity", "gas"]).optional(),
  monthly_price:     z.number().min(0).nullable().optional(),
  annual_price:      z.number().min(0).nullable().optional(),
  estimated_savings: z.number().nullable().optional(),
  valid_until:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ungültiges Datumsformat (YYYY-MM-DD)").nullable().optional(),
  notes:             z.string().max(10000).nullable().optional(),
});

export type UpdateOfferInput = z.infer<typeof UpdateOfferSchema>;

// Für PATCH /api/leads/[id]/offers/[offerId]/status
// draft und superseded sind nicht manuell setzbar über diesen Endpoint.
// draft: kein Rollback nach sent. superseded: nur durch Versioning (Block 14c).
export const UpdateOfferStatusSchema = z.object({
  status: z.enum(["sent", "accepted", "rejected", "expired"]),
});

export type UpdateOfferStatusInput = z.infer<typeof UpdateOfferStatusSchema>;

// Für POST /api/leads/[id]/offers/[offerId]/version
// Alle Felder optional — nicht angegebene werden von der alten Offer übernommen.
// Ausnahme: valid_until und notes werden NICHT kopiert (default null).
export const CreateOfferVersionSchema = z.object({
  energy_demand_id:  z.string().uuid().nullable().optional(),
  provider_name:     z.string().min(1).max(500).optional(),
  tariff_name:       z.string().min(1).max(500).optional(),
  energy_type:       z.enum(["electricity", "gas"]).optional(),
  monthly_price:     z.number().min(0).nullable().optional(),
  annual_price:      z.number().min(0).nullable().optional(),
  estimated_savings: z.number().nullable().optional(),
  valid_until:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ungültiges Datumsformat (YYYY-MM-DD)").nullable().optional(),
  notes:             z.string().max(10000).nullable().optional(),
});

export type CreateOfferVersionInput = z.infer<typeof CreateOfferVersionSchema>;

// Für POST /api/leads/[id]/communications
// communication_type "system" ist für automatische interne Prozesse reserviert.
// Manuelle User-Einträge dürfen system nicht imitieren → system nicht im Enum.
export const CreateCommunicationSchema = z.object({
  offer_id:           z.string().uuid().nullable().optional(),
  communication_type: z.enum(["email", "call", "sms"]),
  direction:          z.enum(["inbound", "outbound", "internal"]),
  subject:            z.string().max(500).nullable().optional(),
  content_summary:    z.string().max(5000).nullable().optional(),
  status:             z.enum(["pending", "success", "failed"]),
  external_id:        z.string().max(500).nullable().optional(),
});

export type CreateCommunicationInput = z.infer<typeof CreateCommunicationSchema>;

// Für PATCH /api/leads/[id]/communications/[communicationId]
// Gesperrte Felder: lead_id, offer_id, communication_type, direction, subject, created_by.
// Nur die DB-typisierten Update-Felder sind erlaubt.
export const UpdateCommunicationSchema = z.object({
  status:          z.enum(["pending", "success", "failed"]).optional(),
  content_summary: z.string().max(5000).nullable().optional(),
  external_id:     z.string().max(500).nullable().optional(),
});

export type UpdateCommunicationInput = z.infer<typeof UpdateCommunicationSchema>;

// Für POST /api/leads/[id]/documents
// offer_pdf + contract_pdf sind für systemgenerierte Prozesse reserviert — nicht im Enum.
// storage_path wird serverseitig generiert: {lead_id}/{document_type}/{documentId}.{ext}
// storage_bucket nicht im Schema — DB DEFAULT 'documents'.
// uploaded_by, lead_id: serverseitig aus auth.profileId / URL.
export const MANUAL_DOCUMENT_TYPES = [
  "invoice",
  "cancellation_confirmation",
  "power_of_attorney",
  "other",
] as const;

export const CreateDocumentSchema = z.object({
  document_type:   z.enum(MANUAL_DOCUMENT_TYPES),
  file_name:       z.string().min(1).max(500),
  mime_type:       z.string().max(100).nullable().optional(),
  file_size_bytes: z.number().int().min(0).nullable().optional(),
});

export type CreateDocumentInput = z.infer<typeof CreateDocumentSchema>;

// Für PATCH /api/leads/[id]/documents/[documentId]
// document_type ist immutable nach Erstellung (storage_path encodiert document_type im Pfad).
// Patchbar: file_name, ocr_status, ocr_text, ocr_processed_at.
// ocr_* nur Admin — assertDocumentFieldsByRole erzwingt das.
// Nicht im Schema: document_type, storage_path, storage_bucket, lead_id, uploaded_by, mime_type, file_size_bytes.
export const UpdateDocumentSchema = z.object({
  file_name:        z.string().min(1).max(500).optional(),
  ocr_status:       z.string().max(100).nullable().optional(),
  ocr_text:         z.string().nullable().optional(),
  ocr_processed_at: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/, "Ungültiges ISO-Datumsformat")
    .nullable()
    .optional(),
});

export type UpdateDocumentInput = z.infer<typeof UpdateDocumentSchema>;

// Für POST /api/leads/[id]/documents/[documentId]/upload-url
// mime_type/file_size_bytes sind client-provided und unverifiziert.
// Bucket-Limits erzwingen echte Einschränkungen beim tatsächlichen Upload.
export const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/tiff",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

export const UploadUrlRequestSchema = z.object({
  mime_type:       z.enum(ALLOWED_MIME_TYPES).optional(),
  file_size_bytes: z.number().int().min(0).max(10485760).optional(),
});

export type UploadUrlRequestInput = z.infer<typeof UploadUrlRequestSchema>;

// Für POST /api/leads/[id]/offers/[offerId]/send
// recipient_email: nur Manager/Admin; Employee → 403 wenn angegeben (Guard in Route).
// Alle Felder optional — leerer Body ist valide (defaults greifen in der Route).
export const SendOfferEmailSchema = z.object({
  recipient_email: z.string().email().optional(),
  subject:         z.string().min(1).max(500).optional(),
  message:         z.string().max(5000).nullable().optional(),
});

export type SendOfferEmailInput = z.infer<typeof SendOfferEmailSchema>;

// Für POST /api/leads/[id]/offers/[offerId]/contract/send
// recipient_email: nur Manager/Admin (Employee ist ohnehin 403 via assertContractSendable).
// Alle Felder optional — leerer Body ist valide (defaults greifen in der Route).
// Bewusst separate Schema-Definition für unabhängige Weiterentwicklung.
export const SendContractEmailSchema = z.object({
  recipient_email: z.string().email().optional(),
  subject:         z.string().min(1).max(500).optional(),
  message:         z.string().max(5000).nullable().optional(),
});

export type SendContractEmailInput = z.infer<typeof SendContractEmailSchema>;
