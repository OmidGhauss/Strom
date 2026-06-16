// Business rule checks derived from docs/api-validation-rules.md.
// These run after Zod validation and before the Supabase query.
// They throw Response objects so Route Handlers can catch them uniformly.

import { ApiErrors } from "@/lib/api/errors";
import type { UserRole, LeadScoreLabel } from "@/types/database";

// Section 2: Employee darf assigned_to nicht ändern.
export function assertEmployeeCannotChangeAssignedTo(
  role: UserRole,
  body: Record<string, unknown>
): void {
  if (role === "employee" && "assigned_to" in body) {
    throw ApiErrors.forbidden("Employee darf assigned_to nicht ändern");
  }
}

// Section 2: privacy_consent und contact_consent müssen true sein.
export function assertConsentsAreTrue(body: {
  privacy_consent: unknown;
  contact_consent: unknown;
}): void {
  if (body.privacy_consent !== true || body.contact_consent !== true) {
    throw ApiErrors.unprocessable(
      "privacy_consent und contact_consent müssen true sein"
    );
  }
}

// Section 4: score_label aus score berechnen.
export function computeScoreLabel(score: number): LeadScoreLabel {
  if (score >= 80) return "hot";
  if (score >= 50) return "warm";
  return "cold";
}

// Section 4: score und score_label müssen atomar geschrieben werden.
// Gibt das um score_label angereicherte Objekt zurück.
export function enrichWithScoreLabel<T extends { score?: number }>(
  body: T
): T & { score_label?: LeadScoreLabel } {
  if (typeof body.score === "number") {
    return { ...body, score_label: computeScoreLabel(body.score) };
  }
  return body;
}

// Section 7: Unveränderliche Dokumentfelder dürfen nicht in der Payload stehen.
const DOCUMENT_IMMUTABLE_FIELDS = [
  "storage_path",
  "storage_bucket",
  "lead_id",
  "uploaded_by",
] as const;

export function assertDocumentImmutableFields(
  body: Record<string, unknown>
): void {
  for (const field of DOCUMENT_IMMUTABLE_FIELDS) {
    if (field in body) {
      throw ApiErrors.badRequest(
        `Feld '${field}' darf nach dem Upload nicht geändert werden`
      );
    }
  }
}

// Section 7: Feldberechtigungen nach Rolle für Document-UPDATE.
export function assertDocumentFieldsByRole(
  role: UserRole,
  body: Record<string, unknown>
): void {
  const OCR_FIELDS = ["ocr_status", "ocr_text", "ocr_processed_at"];
  const SYSTEM_FIELDS = ["mime_type", "file_size_bytes"];

  for (const field of SYSTEM_FIELDS) {
    if (field in body) {
      throw ApiErrors.forbidden(`Feld '${field}' darf nicht geändert werden`);
    }
  }

  if (role !== "admin") {
    for (const field of OCR_FIELDS) {
      if (field in body) {
        throw ApiErrors.forbidden(
          `Nur Admin darf OCR-Felder ändern ('${field}')`
        );
      }
    }
  }
}

// Section 8: Notiz darf nur vom Autor (Employee) oder Admin bearbeitet werden.
// Manager sind explizit ausgeschlossen, auch für eigene Notizen.
export function assertNoteEditableByUser(
  role: UserRole,
  noteCreatedBy: string,
  profileId: string
): void {
  if (role === "admin") return;
  if (role === "manager") {
    throw ApiErrors.forbidden(
      "Manager darf Notizen nicht bearbeiten oder löschen"
    );
  }
  if (noteCreatedBy !== profileId) {
    throw ApiErrors.forbidden("Nur der Autor darf diese Notiz bearbeiten");
  }
}

// Section 3: Superseded-Angebote dürfen nicht akzeptiert werden.
export function assertOfferNotSuperseded(
  currentStatus: string,
  newStatus: unknown
): void {
  if (currentStatus === "superseded" && newStatus === "accepted") {
    throw ApiErrors.conflict(
      "Überschriebene Angebote (superseded) können nicht akzeptiert werden"
    );
  }
}

// Section 9 (Block 11): Terminale Statuse dürfen nur von Manager/Admin gesetzt werden.
const MANAGER_ONLY_STATUSES = ["completed", "rejected", "disqualified", "lost"] as const;

export function assertStatusTransitionAllowedForRole(
  role: UserRole,
  newStatus: string
): void {
  if (
    role === "employee" &&
    (MANAGER_ONLY_STATUSES as readonly string[]).includes(newStatus)
  ) {
    throw ApiErrors.forbidden(`Employee darf Status '${newStatus}' nicht setzen`);
  }
}

// Section 1: Employee-eigenes Profil: nur full_name erlaubt.
const EMPLOYEE_PROFILE_WHITELIST = ["full_name"] as const;

export function assertEmployeeProfileFields(
  role: UserRole,
  body: Record<string, unknown>
): void {
  if (role !== "employee") return;
  const forbidden = Object.keys(body).filter(
    (k) => !EMPLOYEE_PROFILE_WHITELIST.includes(k as typeof EMPLOYEE_PROFILE_WHITELIST[number])
  );
  if (forbidden.length > 0) {
    throw ApiErrors.forbidden(
      `Employee darf folgende Felder nicht ändern: ${forbidden.join(", ")}`
    );
  }
}
