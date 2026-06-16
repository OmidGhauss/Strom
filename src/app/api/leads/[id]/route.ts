import type { NextRequest } from "next/server";
import * as z from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/api/auth";
import type { AuthContext } from "@/lib/api/auth";
import { ApiErrors, handleSupabaseError } from "@/lib/api/errors";
import { singleResponse } from "@/lib/api/responses";
import {
  assertEmployeeCannotChangeAssignedTo,
  enrichWithScoreLabel,
} from "@/lib/api/guards";
import { UuidSchema } from "@/lib/validation/common";
import { UpdateLeadSchema } from "@/lib/validation/lead";
import type { Lead } from "@/types/database";

// GET /api/leads/[id]
// Lead-Detail mit eingebetteten Adressen und Energiebedarfen.
// RLS (leads: select): Employee sieht nur eigene zugewiesene Leads.
// 0 Zeilen → PGRST116 → 404 (kein Info-Leak ob Lead existiert).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth();
  } catch (e) {
    return e as Response;
  }

  const { id } = await params;
  if (!UuidSchema.safeParse(id).success) return ApiErrors.notFound("Lead");

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("leads")
    .select("*, addresses(*), energy_demands(*)")
    .eq("id", id)
    .single();

  if (error) return handleSupabaseError(error);
  return singleResponse(data);
}

// PATCH /api/leads/[id]
// Lead-Stammdaten ändern (Whitelist).
// Nicht änderbar: product_type, privacy_consent, contact_consent, source, utm_*, status.
// assigned_to: nur Manager/Admin.
// score: setzt score_label atomar via enrichWithScoreLabel.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let auth: AuthContext;
  try {
    auth = await requireAuth();
  } catch (e) {
    return e as Response;
  }

  const { id } = await params;
  if (!UuidSchema.safeParse(id).success) return ApiErrors.notFound("Lead");

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return ApiErrors.badRequest("Ungültiger JSON-Body");
  }

  const parsed = UpdateLeadSchema.safeParse(raw);
  if (!parsed.success) {
    return ApiErrors.unprocessable("Validierungsfehler", z.flattenError(parsed.error));
  }

  const body = parsed.data;

  if (Object.keys(body).length === 0) {
    return ApiErrors.badRequest("Keine Felder zum Aktualisieren");
  }

  try {
    assertEmployeeCannotChangeAssignedTo(auth.role, body as Record<string, unknown>);
  } catch (e) {
    return e as Response;
  }

  const enriched = enrichWithScoreLabel(body);

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("leads")
    .update(enriched as Partial<Lead>)
    .eq("id", id)
    .select()
    .single();

  if (error) return handleSupabaseError(error);
  return singleResponse(data);
}
