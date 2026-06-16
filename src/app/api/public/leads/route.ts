import type { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ApiErrors, handleSupabaseError } from "@/lib/api/errors";
import * as z from "zod";
import { PublicLeadSchema } from "@/lib/validation/public-lead";
import type { PublicLeadInput } from "@/lib/validation/public-lead";
import { verifyTurnstile } from "@/lib/captcha/turnstile";
import { checkRateLimit } from "@/lib/rate-limit";

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "anonymous"
  );
}

function buildEnergyDemands(
  productType: "electricity" | "gas" | "both",
  electricity?: PublicLeadInput["electricity"],
  gas?: PublicLeadInput["gas"],
): Array<{
  energy_type: "electricity" | "gas";
  annual_consumption_kwh: number | null;
  consumption_known: boolean | null;
  hot_water_with_gas: boolean | null;
}> {
  const demands: Array<{
    energy_type: "electricity" | "gas";
    annual_consumption_kwh: number | null;
    consumption_known: boolean | null;
    hot_water_with_gas: boolean | null;
  }> = [];

  if (productType === "electricity" || productType === "both") {
    demands.push({
      energy_type: "electricity",
      annual_consumption_kwh: electricity?.annual_consumption_kwh ?? null,
      consumption_known: electricity?.consumption_known ?? null,
      hot_water_with_gas: null,
    });
  }

  if (productType === "gas" || productType === "both") {
    demands.push({
      energy_type: "gas",
      annual_consumption_kwh: gas?.annual_consumption_kwh ?? null,
      consumption_known: gas?.consumption_known ?? null,
      hot_water_with_gas: gas?.hot_water_with_gas ?? null,
    });
  }

  return demands;
}

function buildAddress(address?: PublicLeadInput["address"]): Record<string, unknown> | null {
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

export async function POST(request: NextRequest) {
  // 1. Rate Limit
  const ip = getClientIp(request);
  const rateLimit = await checkRateLimit(ip);
  if (!rateLimit.success) {
    return new Response(
      JSON.stringify({ error: "Zu viele Anfragen", code: "RATE_LIMIT_EXCEEDED" }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(rateLimit.retryAfter),
        },
      },
    );
  }

  // 2. JSON Parse
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return ApiErrors.badRequest("Ungültiger JSON-Body");
  }

  // 3. Zod Validation
  const parsed = PublicLeadSchema.safeParse(raw);
  if (!parsed.success) {
    return ApiErrors.unprocessable("Validierungsfehler", z.flattenError(parsed.error));
  }
  const body = parsed.data;

  // 4. Turnstile
  const captchaOk = await verifyTurnstile(body.turnstile_token, ip);
  if (!captchaOk) {
    return ApiErrors.unprocessable("Captcha-Verifikation fehlgeschlagen");
  }

  // 5. RPC (einzige DB-Operation — kein direkter Tabellen-Write)
  const adminClient = createAdminClient();
  const { data, error } = await adminClient.rpc("submit_public_lead", {
    p_first_name: body.first_name,
    p_last_name: body.last_name,
    p_email: body.email,
    p_customer_type: body.customer_type,
    p_product_type: body.product_type,
    p_privacy_consent: body.privacy_consent,
    p_contact_consent: body.contact_consent,
    p_phone: body.phone ?? null,
    p_data_transfer_consent: body.data_transfer_consent ?? null,
    p_source: "website_form",
    p_utm_source: body.utm_source ?? null,
    p_utm_medium: body.utm_medium ?? null,
    p_utm_campaign: body.utm_campaign ?? null,
    p_utm_term: body.utm_term ?? null,
    p_utm_content: body.utm_content ?? null,
    p_address: buildAddress(body.address),
    p_energy_demands: buildEnergyDemands(body.product_type, body.electricity, body.gas),
    p_referral_code: body.referral_code ?? null,
  });

  if (error) return handleSupabaseError(error);

  return Response.json({ data }, { status: 201 });
}
