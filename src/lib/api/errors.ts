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
