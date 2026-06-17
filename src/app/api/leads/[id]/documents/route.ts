import type { NextRequest } from "next/server";
import * as z from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/api/auth";
import type { AuthContext } from "@/lib/api/auth";
import { ApiErrors, handleSupabaseError } from "@/lib/api/errors";
import { singleResponse, listResponse } from "@/lib/api/responses";
import { UuidSchema, parsePagination, paginationRange } from "@/lib/validation/common";
import { CreateDocumentSchema } from "@/lib/validation/lead";

// GET /api/leads/[id]/documents
// Dokument-Metadaten eines Leads paginiert auflisten, absteigend nach created_at.
// RLS (documents: select): can_access_lead(lead_id).
// Unzugänglicher Lead → leere Liste (kein Info-Leak).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth();
  } catch (e) {
    return e as Response;
  }

  const { id } = await params;
  if (!UuidSchema.safeParse(id).success) return ApiErrors.notFound("Lead");

  const { page, pageSize } = parsePagination(request.nextUrl.searchParams);
  const { from, to } = paginationRange(page, pageSize);

  const supabase = await createClient();

  const { data, error, count } = await supabase
    .from("documents")
    .select(
      "id, lead_id, uploaded_by, document_type, file_name, storage_path, storage_bucket, mime_type, file_size_bytes, ocr_status, ocr_text, ocr_processed_at, created_at, updated_at",
      { count: "exact" }
    )
    .eq("lead_id", id)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) return handleSupabaseError(error);
  return listResponse(data ?? [], { count: count ?? 0, page, pageSize });
}

// POST /api/leads/[id]/documents
// Dokument-Metadaten registrieren. uploaded_by aus auth.profileId.
// offer_pdf + contract_pdf sind für systemgenerierte Prozesse reserviert — Zod-Enum 422.
// storage_path wird serverseitig aus lead_id + document_type + documentId + ext generiert.
// Keine Datei wird hochgeladen (kein Supabase Storage in Block 16).
//
// Lead-Gate vor Extension-Check und INSERT: saubere Fehlersemantik.
export async function POST(
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

  const parsed = CreateDocumentSchema.safeParse(raw);
  if (!parsed.success) {
    return ApiErrors.unprocessable("Validierungsfehler", z.flattenError(parsed.error));
  }

  const body = parsed.data;

  const supabase = await createClient();

  // Lead-Gate: PGRST116 → 404 (kein falsches 422 bei fehlendem Lead-Zugriff).
  const { error: leadError } = await supabase
    .from("leads")
    .select("id")
    .eq("id", id)
    .single();

  if (leadError?.code === "PGRST116") return ApiErrors.notFound("Lead");
  if (leadError) return handleSupabaseError(leadError);

  // Extension aus file_name extrahieren.
  // Letzter Punkt muss existieren und eine nicht-leere Extension ergeben.
  const lastDot = body.file_name.lastIndexOf(".");
  const ext =
    lastDot !== -1 && lastDot < body.file_name.length - 1
      ? body.file_name.slice(lastDot + 1).toLowerCase()
      : "";
  if (!ext) {
    return ApiErrors.unprocessable(
      "file_name muss eine Dateiendung enthalten (z. B. 'vertrag.pdf')"
    );
  }

  const documentId = crypto.randomUUID();
  const storagePath = `${id}/${body.document_type}/${documentId}.${ext}`;

  const { data, error } = await supabase
    .from("documents")
    .insert({
      id:              documentId,
      lead_id:         id,
      uploaded_by:     auth.profileId,
      document_type:   body.document_type,
      file_name:       body.file_name,
      storage_path:    storagePath,
      mime_type:       body.mime_type ?? null,
      file_size_bytes: body.file_size_bytes ?? null,
    })
    .select()
    .single();

  if (error) return handleSupabaseError(error);
  return singleResponse(data, 201);
}
