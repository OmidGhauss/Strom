-- Block 6: Dokumentenmanagement
--
-- Die Tabelle speichert ausschließlich Metadaten.
-- Die Datei selbst liegt in Supabase Storage (Bucket: 'documents').
-- Pfadschema: {lead_id}/{document_type}/{id}.{ext}
--
-- WICHTIG: Supabase Storage löscht Dateien NICHT automatisch, wenn ein
-- DB-Eintrag via CASCADE entfernt wird. Anwendungscode muss die Storage-Datei
-- zuerst explizit löschen, bevor der Lead (und damit dieser Eintrag) entfernt wird.
--
-- Kein updated_at – Dokumente sind unveränderliche Einträge.
-- Korrekturen erfolgen durch Löschen und Neu-Hochladen.

-- ---------------------------------------------------------------------------
-- Enum: document_type
-- ---------------------------------------------------------------------------

CREATE TYPE document_type AS ENUM (
  'invoice',
  'offer_pdf',
  'contract_pdf',
  'cancellation_confirmation',
  'power_of_attorney',
  'other'
);

-- ---------------------------------------------------------------------------
-- Tabelle: documents
-- ---------------------------------------------------------------------------

CREATE TABLE documents (
  id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id          uuid          NOT NULL,

  -- NULL für systemgenerierte Dokumente ohne menschlichen Uploader
  uploaded_by      uuid          NULL,

  document_type    document_type NOT NULL,
  file_name        text          NOT NULL,

  -- Eindeutiger Pfad im Storage-Bucket
  storage_path     text          NOT NULL,
  storage_bucket   text          NOT NULL DEFAULT 'documents',

  mime_type        text          NULL,
  file_size_bytes  bigint        NULL,

  -- OCR-Vorbereitung – in V1 immer NULL
  ocr_status       text          NULL,
  ocr_text         text          NULL,
  ocr_processed_at timestamptz   NULL,

  created_at       timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT fk_documents_lead
    FOREIGN KEY (lead_id)
    REFERENCES leads(id)
    ON DELETE CASCADE,

  CONSTRAINT fk_documents_uploaded_by
    FOREIGN KEY (uploaded_by)
    REFERENCES profiles(id)
    ON DELETE SET NULL,

  CONSTRAINT uq_documents_storage_path
    UNIQUE (storage_path)
);

CREATE INDEX idx_documents_lead_type
  ON documents (lead_id, document_type);
