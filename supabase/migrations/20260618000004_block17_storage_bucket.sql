-- Block 17: Supabase Storage Bucket für Dokumente
--
-- Bucket "documents" wird als privater Bucket angelegt.
-- Kein öffentlicher Zugriff — ausschließlich über Signed URLs.
-- Signed URLs werden serverseitig erzeugt, immer nach user-aware RLS-Gate.
--
-- file_size_limit = 10485760 (10 MB) — Supabase Storage erzwingt serverseitig.
-- allowed_mime_types: zweite Verteidigungsschicht nach Zod-Allowlist in der API.
--
-- ON CONFLICT DO NOTHING: idempotent, falls Bucket bereits existiert.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'documents',
  'documents',
  false,
  10485760,
  ARRAY[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/tiff',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]::text[]
)
ON CONFLICT (id) DO NOTHING;
