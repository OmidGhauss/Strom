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
