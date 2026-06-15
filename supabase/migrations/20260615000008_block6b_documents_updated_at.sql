-- Block 6b: documents updated_at Korrektur
--
-- Die Datei in Supabase Storage ist unveränderlich.
-- Die Datenbankmetadaten sind es nicht: OCR-Felder werden asynchron
-- durch einen OCR-Worker aktualisiert; document_type kann manuell
-- korrigiert werden. updated_at verfolgt diese Metadaten-Änderungen.

ALTER TABLE documents
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

CREATE TRIGGER set_documents_updated_at
  BEFORE UPDATE ON documents
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_updated_at();
