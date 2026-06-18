import type { PublicLeadInput } from "@/lib/validation/public-lead";

// ---------------------------------------------------------------------------
// Typed shape for each element in the p_energy_demands JSONB array.
// Mirrors all energy_demands columns accepted by submit_public_lead v2.
// ---------------------------------------------------------------------------
export type PublicLeadEnergyDemand = {
  energy_type: "electricity" | "gas";
  annual_consumption_kwh: number | null;
  consumption_known: boolean | null;
  household_size: number | null;
  heating_type: string | null;
  hot_water_with_gas: boolean | null;
  current_provider: string | null;
  monthly_payment: number | null;
  contract_end_date: string | null;
  price_guarantee: boolean | null;
};

export function buildEnergyDemands(
  productType: "electricity" | "gas" | "both",
  electricity?: PublicLeadInput["electricity"],
  gas?: PublicLeadInput["gas"],
): PublicLeadEnergyDemand[] {
  const demands: PublicLeadEnergyDemand[] = [];

  if (productType === "electricity" || productType === "both") {
    demands.push({
      energy_type: "electricity",
      annual_consumption_kwh: electricity?.annual_consumption_kwh ?? null,
      consumption_known: electricity?.consumption_known ?? null,
      household_size: null,
      heating_type: null,
      hot_water_with_gas: null,
      current_provider: electricity?.current_provider ?? null,
      monthly_payment: electricity?.monthly_payment ?? null,
      contract_end_date: electricity?.contract_end_date ?? null,
      price_guarantee: electricity?.price_guarantee ?? null,
    });
  }

  if (productType === "gas" || productType === "both") {
    demands.push({
      energy_type: "gas",
      annual_consumption_kwh: gas?.annual_consumption_kwh ?? null,
      consumption_known: gas?.consumption_known ?? null,
      household_size: gas?.household_size ?? null,
      heating_type: gas?.heating_type ?? null,
      hot_water_with_gas: gas?.hot_water_with_gas ?? null,
      current_provider: gas?.current_provider ?? null,
      monthly_payment: gas?.monthly_payment ?? null,
      contract_end_date: gas?.contract_end_date ?? null,
      price_guarantee: gas?.price_guarantee ?? null,
    });
  }

  return demands;
}

export function buildAddress(
  address?: PublicLeadInput["address"],
): Record<string, unknown> | null {
  if (!address) return null;
  return {
    street: address.street ?? null,
    house_number: address.house_number ?? null,
    address_addition: address.address_addition ?? null,
    postal_code: address.postal_code ?? null,
    city: address.city ?? null,
    state: address.state ?? null,
    country: address.country ?? "DE",
  };
}

// ---------------------------------------------------------------------------
// Maps form fields that have no dedicated DB column to a structured note
// stored in leads.notes via p_initial_note in the RPC.
// Returns null when all inputs are absent (no note row created).
// ---------------------------------------------------------------------------
export function buildInitialNote(
  body: Pick<
    PublicLeadInput,
    "ziele" | "erreichbarkeit" | "rechnung_dateiname" | "rechnung_groesse_kb"
  >,
): string | null {
  const parts: string[] = [];

  if (body.ziele && body.ziele.length > 0) {
    parts.push(`Ziele: ${body.ziele.join(", ")}`);
  }
  if (body.erreichbarkeit) {
    parts.push(`Erreichbarkeit: ${body.erreichbarkeit}`);
  }
  if (body.rechnung_dateiname) {
    const size =
      body.rechnung_groesse_kb != null
        ? ` (${body.rechnung_groesse_kb} KB)`
        : "";
    parts.push(`Rechnung: ${body.rechnung_dateiname}${size}`);
  }

  if (parts.length === 0) return null;
  return `[Öffentliches Formular]\n${parts.join("\n")}`;
}

// ---------------------------------------------------------------------------
// Client-side Turnstile token resolution.
//
// Priority:
//   1. widgetToken  — token from the Cloudflare Turnstile widget callback
//   2. NEXT_PUBLIC_TURNSTILE_DEMO_TOKEN — Cloudflare test key for demo/dev
//      Use Cloudflare's always-pass test site-key pair in .env.local:
//        NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA
//        NEXT_PUBLIC_TURNSTILE_DEMO_TOKEN=XXXX.DUMMY.TOKEN.XXXX
//   3. Throws — never silently submits a request without a verifiable token
// ---------------------------------------------------------------------------
export function resolveTurnstileToken(widgetToken?: string): string {
  if (widgetToken) return widgetToken;

  const demoToken = process.env.NEXT_PUBLIC_TURNSTILE_DEMO_TOKEN;
  if (demoToken) return demoToken;

  throw new Error(
    "Kein Turnstile-Token verfügbar. " +
      "Widget initialisieren oder NEXT_PUBLIC_TURNSTILE_DEMO_TOKEN setzen.",
  );
}
