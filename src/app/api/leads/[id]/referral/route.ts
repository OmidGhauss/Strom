import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/api/auth";
import type { AuthContext } from "@/lib/api/auth";
import { ApiErrors, handleSupabaseError } from "@/lib/api/errors";
import { UuidSchema } from "@/lib/validation/common";

// Typ für den Manager/Admin-Pfad mit eingebetteten Affiliate-Daten.
// Supabase-Typen unterstützen keine FK-Joins ohne Relationships-Definitionen,
// daher wird der Result-Typ manuell angegeben.
type ReferralWithAffiliate = {
  id: string;
  lead_id: string;
  affiliate_link_id: string;
  notes: string | null;
  created_at: string;
  affiliate_links: {
    referral_code: string;
    label: string | null;
    affiliates: {
      name: string;
      email: string;
    } | null;
  } | null;
} | null;

// GET /api/leads/[id]/referral
// Referral-Info für einen Lead.
//
// Rollenbasiertes Branching (deterministisch, nicht PostgREST-Join-abhängig):
//   Employee: minimale Info (is_referral, created_at) — kein Zugriff auf Affiliate-Stammdaten.
//   Manager/Admin: vollständige Referral-Info inkl. referral_code, Affiliate-Name und -E-Mail.
//
// RLS-Kette:
//   lead_referrals: select → can_access_lead(lead_id) → Employee mit eigenem Lead: ✓
//   affiliate_links: select → is_manager_or_above() → Employee: ✗
//   affiliates: select     → is_manager_or_above() → Employee: ✗
export async function GET(
  _req: NextRequest,
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

  const supabase = await createClient();

  if (auth.role === "employee") {
    // Employee-Pfad: nur is_referral + created_at.
    // affiliate_links/affiliates sind für Employee per RLS gesperrt.
    const { data, error } = await supabase
      .from("lead_referrals")
      .select("id, lead_id, created_at")
      .eq("lead_id", id)
      .maybeSingle();

    if (error) return handleSupabaseError(error);
    if (!data) return Response.json({ data: null });

    return Response.json({
      data: { is_referral: true, created_at: data.created_at },
    });
  }

  // Manager/Admin-Pfad: vollständige Referral-Info mit Affiliate-Daten.
  // FK-Hint-Syntax: affiliate_links!affiliate_link_id(...) und affiliates!affiliate_id(...)
  const { data, error } = await supabase
    .from("lead_referrals")
    .select(
      "*, affiliate_links!affiliate_link_id(referral_code, label, affiliates!affiliate_id(name, email))"
    )
    .eq("lead_id", id)
    .maybeSingle();

  if (error) return handleSupabaseError(error);
  if (!data) return Response.json({ data: null });

  const row = data as unknown as ReferralWithAffiliate;
  if (!row) return Response.json({ data: null });

  const link = row.affiliate_links;

  return Response.json({
    data: {
      is_referral: true,
      id: row.id,
      lead_id: row.lead_id,
      affiliate_link_id: row.affiliate_link_id,
      referral_code: link?.referral_code ?? null,
      label: link?.label ?? null,
      affiliate_name: link?.affiliates?.name ?? null,
      affiliate_email: link?.affiliates?.email ?? null,
      notes: row.notes,
      created_at: row.created_at,
    },
  });
}
