import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/api/auth";
import { handleSupabaseError } from "@/lib/api/errors";
import { listResponse } from "@/lib/api/responses";
import { parsePagination, paginationRange } from "@/lib/validation/common";

// GET /api/leads
// Gibt die Lead-Liste zurück, gefiltert durch RLS (Employee sieht nur eigene Leads).
// Query-Parameter: page (default 1), pageSize (default 20, max 100)
export async function GET(request: NextRequest) {
  try {
    await requireAuth();
  } catch (errorResponse) {
    return errorResponse as Response;
  }

  const { page, pageSize } = parsePagination(request.nextUrl.searchParams);
  const { from, to } = paginationRange(page, pageSize);

  // User-aware Client: sendet JWT des eingeloggten Users → RLS filtert automatisch.
  // Employee sieht nur Leads mit assigned_to = eigene profile_id (gemäß RLS-Policy).
  const supabase = await createClient();

  const { data, error, count } = await supabase
    .from("leads")
    .select(
      "id, lead_number, first_name, last_name, email, phone, status, score, score_label, product_type, customer_type, assigned_to, created_at, updated_at",
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) {
    return handleSupabaseError(error);
  }

  return listResponse(data ?? [], {
    count: count ?? 0,
    page,
    pageSize,
  });
}
