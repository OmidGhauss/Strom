export type ApiErrorBody = {
  error: string;
  code?: string;
  details?: unknown;
};

function errorResponse(status: number, message: string, code?: string, details?: unknown): Response {
  const body: ApiErrorBody = { error: message };
  if (code) body.code = code;
  if (details !== undefined) body.details = details;
  return Response.json(body, { status });
}

export const ApiErrors = {
  badRequest: (message: string, details?: unknown) =>
    errorResponse(400, message, "BAD_REQUEST", details),

  unauthorized: () =>
    errorResponse(401, "Nicht authentifiziert", "UNAUTHORIZED"),

  forbidden: (message = "Zugriff verweigert") =>
    errorResponse(403, message, "FORBIDDEN"),

  notFound: (resource = "Ressource") =>
    errorResponse(404, `${resource} nicht gefunden`, "NOT_FOUND"),

  conflict: (message: string) =>
    errorResponse(409, message, "CONFLICT"),

  unprocessable: (message: string, details?: unknown) =>
    errorResponse(422, message, "UNPROCESSABLE", details),

  internal: () =>
    errorResponse(500, "Interner Serverfehler", "INTERNAL_ERROR"),
};

// Maps known Supabase/PostgreSQL error codes to API responses.
// Never forwards raw Supabase errors to the client — they can expose schema info.
export function handleSupabaseError(error: { code?: string; message?: string }): Response {
  // Log server-side with context, never send raw DB errors to client.
  console.error("[supabase]", { code: error.code, message: error.message });

  switch (error.code) {
    case "P0001": // RAISE EXCEPTION mit custom ERRCODE
      if (error.message === "LEAD_NOT_FOUND") return ApiErrors.notFound("Lead");
      if (error.message === "OFFERS_REFERENCE_ENERGY_DEMAND")
        return ApiErrors.conflict(
          "Produkttyp nicht änderbar: Bestehende Angebote referenzieren den betroffenen Energiebedarf"
        );
      if (error.message === "CONSENT_REQUIRED") {
        return ApiErrors.unprocessable("Einwilligung erforderlich");
      }
      if (error.message === "ENERGY_DEMANDS_REQUIRED") {
        return ApiErrors.unprocessable("Energieverbrauch erforderlich");
      }
      if (error.message === "ENERGY_DEMANDS_PRODUCT_TYPE_MISMATCH") {
        return ApiErrors.unprocessable("Energiedaten passen nicht zum gewählten Produkttyp");
      }
      if (error.message === "OFFER_NOT_FOUND")
        return ApiErrors.notFound("Offer");
      if (error.message === "OFFER_NOT_VERSIONABLE")
        return ApiErrors.conflict(
          "Offer kann nicht versioniert werden (Status nicht versionierbar)"
        );
      if (error.message === "OFFER_FORBIDDEN")
        return ApiErrors.forbidden("Employees dürfen nur eigene Angebote versionieren");
      if (error.message === "OLD_PDF_DOCUMENT_MISMATCH")
        return ApiErrors.conflict(
          "Bestehendes PDF-Dokument passt nicht zum Angebot"
        );
      if (error.message === "OFFER_NOT_ACCEPTED")
        return ApiErrors.conflict(
          "Auftragsbestätigung erfordert accepted Angebot"
        );
      if (error.message === "OLD_CONTRACT_DOCUMENT_MISMATCH")
        return ApiErrors.conflict(
          "Bestehendes Auftragsbestätigungs-Dokument passt nicht zum Angebot"
        );
      if (error.message === "INVALID_CONTRACT_STORAGE_PATH")
        return ApiErrors.unprocessable("Ungültiger Contract-Storage-Pfad");
      if (error.message === "INVALID_CONTRACT_FILE_SIZE")
        return ApiErrors.unprocessable("Ungültige Contract-Dateigröße");
      // LEAD_STATUS_MISMATCH: globales Mapping → 409.
      // AUSNAHME: /contract/send fängt diesen Fehler lokal ab und gibt 201 + warning zurück,
      // weil die E-Mail bereits zugestellt wurde. handleSupabaseError wird dort nicht aufgerufen.
      if (error.message === "LEAD_STATUS_MISMATCH")
        return ApiErrors.conflict("Lead-Status wurde zwischenzeitlich geändert");
      return ApiErrors.unprocessable("Anfrage konnte nicht verarbeitet werden");
    case "23502": // not_null_violation
      return ApiErrors.unprocessable("Pflichtfeld fehlt");
    case "23514": // check_violation
      return ApiErrors.unprocessable("Ungültige Feldkombination");
    case "22P02": // invalid_text_representation (ungültiger Enum-Cast)
      return ApiErrors.unprocessable("Ungültiger Wert");
    case "23505": // unique_violation
      return ApiErrors.conflict("Datensatz existiert bereits");
    case "23503": // foreign_key_violation
      return ApiErrors.unprocessable("Referenz existiert nicht");
    case "42501": // insufficient_privilege (RLS)
      return ApiErrors.forbidden();
    case "PGRST116": // Supabase: no rows found
      return ApiErrors.notFound();
    default:
      return ApiErrors.internal();
  }
}
