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
