-- Block 18: register_offer_pdf RPC
--
-- Registriert ein neu generiertes Offer-PDF atomar:
--   1. Offer via FOR UPDATE sperren (Race-Protection bei paralleler Generierung)
--   2. Altes PDF-Dokument entfernen (streng gescoped: id + lead_id + document_type)
--   3. Neues Dokument eintragen
--   4. offers.pdf_document_id aktualisieren
--
-- Storage-Operationen (Upload, altes File löschen) laufen außerhalb des RPC
-- in der Route. RPC gibt old_storage_bucket/path zurück damit die Route
-- das alte Storage-File nach erfolgreichem Commit löschen kann.
--
-- SECURITY INVOKER + service_role: service_role bypassed RLS.
-- Rolle/Ownership-Prüfung liegt in der Route (current_profile_id/current_user_role
-- sind hier nicht sinnvoll, da via service_role aufgerufen).
--
-- P0001-Codes:
--   OFFER_NOT_FOUND         → 404 via handleSupabaseError
--   OLD_PDF_DOCUMENT_MISMATCH → 409 via handleSupabaseError

CREATE OR REPLACE FUNCTION register_offer_pdf(
  p_offer_id        uuid,
  p_lead_id         uuid,
  p_new_document_id uuid,
  p_file_name       text,
  p_storage_path    text,
  p_file_size_bytes bigint
) RETURNS TABLE(
  document_id        uuid,
  old_storage_bucket text,
  old_storage_path   text
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_offer              offers%ROWTYPE;
  v_old_document_id    uuid;
  v_old_storage_path   text;
  v_old_storage_bucket text;
BEGIN
  -- Offer sperren: verhindert parallele PDF-Generierung für dasselbe Angebot.
  -- FOR UPDATE blockiert bis vorherige Transaktion committed/rolled back.
  SELECT * INTO v_offer
  FROM offers
  WHERE id = p_offer_id AND lead_id = p_lead_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'OFFER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  v_old_document_id := v_offer.pdf_document_id;

  -- Altes PDF-Dokument entfernen (streng gescoped).
  -- ON DELETE SET NULL auf offers.pdf_document_id feuert automatisch durch den FK.
  IF v_old_document_id IS NOT NULL THEN
    DELETE FROM documents
    WHERE id            = v_old_document_id
      AND lead_id       = p_lead_id
      AND document_type = 'offer_pdf'
    RETURNING storage_bucket, storage_path
      INTO v_old_storage_bucket, v_old_storage_path;

    -- 0 rows: pdf_document_id zeigt auf kein offer_pdf dieses Leads → inkonsistenter Zustand.
    IF NOT FOUND THEN
      RAISE EXCEPTION 'OLD_PDF_DOCUMENT_MISMATCH' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Neues Dokument registrieren.
  -- uploaded_by = NULL: systemgeneriertes Dokument ohne menschlichen Uploader.
  INSERT INTO documents (
    id,
    lead_id,
    uploaded_by,
    document_type,
    file_name,
    storage_path,
    storage_bucket,
    mime_type,
    file_size_bytes
  ) VALUES (
    p_new_document_id,
    p_lead_id,
    NULL,
    'offer_pdf',
    p_file_name,
    p_storage_path,
    'documents',
    'application/pdf',
    p_file_size_bytes
  );

  -- Offer verknüpfen (Row ist bereits durch FOR UPDATE gesperrt).
  -- set_offers_updated_at-Trigger setzt updated_at automatisch.
  UPDATE offers
  SET pdf_document_id = p_new_document_id
  WHERE id = p_offer_id AND lead_id = p_lead_id;

  -- Gibt altes Storage-Ziel zurück (NULL/NULL wenn kein vorheriges PDF vorhanden).
  RETURN QUERY SELECT p_new_document_id, v_old_storage_bucket, v_old_storage_path;
END;
$$;

REVOKE EXECUTE ON FUNCTION register_offer_pdf(uuid, uuid, uuid, text, text, bigint)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION register_offer_pdf(uuid, uuid, uuid, text, text, bigint)
  TO service_role;
