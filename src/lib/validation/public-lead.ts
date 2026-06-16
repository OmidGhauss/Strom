import * as z from "zod";

const ElectricityInput = z.object({
  annual_consumption_kwh: z.number().positive().max(9_999_999.99).nullable().optional(),
  consumption_known: z.boolean().nullable().optional(),
});

const GasInput = z.object({
  annual_consumption_kwh: z.number().positive().max(9_999_999.99).nullable().optional(),
  consumption_known: z.boolean().nullable().optional(),
  hot_water_with_gas: z.boolean().nullable().optional(),
});

const AddressInput = z.object({
  street: z.string().trim().max(255).optional(),
  house_number: z.string().trim().max(20).optional(),
  address_addition: z.string().trim().max(100).optional(),
  postal_code: z.string().trim().max(10).optional(),
  city: z.string().trim().max(100).optional(),
  state: z.string().trim().max(100).optional(),
  country: z.string().trim().length(2).optional(),
});

export const PublicLeadSchema = z
  .object({
    first_name: z.string().trim().min(1).max(100),
    last_name: z.string().trim().min(1).max(100),
    email: z.string().trim().toLowerCase().email().max(255),
    phone: z.string().trim().max(50).optional(),

    customer_type: z.enum([
      "private",
      "business",
      "property_management",
      "multi_location_company",
    ]),
    product_type: z.enum(["electricity", "gas", "both"]),

    address: AddressInput.optional(),

    electricity: ElectricityInput.optional(),
    gas: GasInput.optional(),

    // z.literal(true): lehnt false, null, undefined ab — Pflicht-Consent vor RPC
    privacy_consent: z.literal(true),
    contact_consent: z.literal(true),
    data_transfer_consent: z.boolean().optional(),

    utm_source: z.string().trim().max(255).optional(),
    utm_medium: z.string().trim().max(255).optional(),
    utm_campaign: z.string().trim().max(255).optional(),
    utm_term: z.string().trim().max(255).optional(),
    utm_content: z.string().trim().max(255).optional(),

    turnstile_token: z.string().min(1),

    // Leere Strings und Whitespace → undefined (kein 422 für leere Felder)
    // Nur echte Werte werden gegen den Regex geprüft
    referral_code: z.preprocess(
      (v) => {
        if (typeof v !== "string") return undefined;
        const trimmed = v.trim().toUpperCase();
        return trimmed === "" ? undefined : trimmed;
      },
      z.string().regex(/^[A-Z0-9-]{3,32}$/).optional(),
    ),
  })
  .superRefine((data, ctx) => {
    if (data.product_type === "electricity" || data.product_type === "both") {
      if (!data.electricity) {
        ctx.addIssue({
          code: "custom",
          path: ["electricity"],
          message: "Stromverbrauchsdaten für gewählten Produkttyp erforderlich",
        });
      }
    }
    if (data.product_type === "gas" || data.product_type === "both") {
      if (!data.gas) {
        ctx.addIssue({
          code: "custom",
          path: ["gas"],
          message: "Gasverbrauchsdaten für gewählten Produkttyp erforderlich",
        });
      }
    }
  });

export type PublicLeadInput = z.infer<typeof PublicLeadSchema>;
