-- Block 20: Contract-/Abschluss-Pipeline (Auftragsbestätigung-PDF)
--
-- Fügt offers.contract_document_id hinzu: FK-Pointer auf das aktuelle
-- Auftragsbestätigungs-PDF (technischer document_type = 'contract_pdf').
--
-- Fachliche Klarstellung:
--   Das V1-PDF ist eine Auftragsbestätigung / Abschlussbestätigung, kein
--   rechtsverbindliches Vertragsdokument mit Rechtstext oder Signaturfluss.
--   'contract_pdf' ist der technische Enum-Wert aus Block 6.
--
-- Analogie zu offers.pdf_document_id (Block 7/18):
--   - NULL solange kein Dokument generiert wurde
--   - ON DELETE SET NULL: Dokument-Löschung (Admin) entkoppelt Offer ohne es zu löschen
--   - register_contract_pdf RPC setzt den Pointer atomar

-- ---------------------------------------------------------------------------
-- Neue Spalte
-- ---------------------------------------------------------------------------

ALTER TABLE offers
  ADD COLUMN contract_document_id uuid NULL
    REFERENCES documents(id) ON DELETE SET NULL;

-- Partial Index: nur Rows mit nicht-null Wert (Mehrheit hat NULL).
CREATE INDEX idx_offers_contract_document
  ON offers (contract_document_id)
  WHERE contract_document_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- RPC: register_contract_pdf
--
-- Registriert ein neu generiertes Auftragsbestätigungs-PDF atomar:
--   1. Parametervalidierung (file_size_bytes, storage_path-Prefix)
--   2. Offer via FOR UPDATE sperren (Race-Protection bei paralleler Generierung)
--   3. Status-Recheck (accepted) unter Lock
--   4. Altes contract_pdf-Dokument entfernen (streng gescoped)
--   5. Neues Dokument eintragen
--   6. offers.contract_document_id aktualisieren
--
-- Storage-Operationen (Upload, altes File löschen) laufen außerhalb des RPC
-- in der Route. RPC gibt old_storage_bucket/path zurück damit die Route
-- das alte Storage-File nach erfolgreichem Commit löschen kann.
--
-- SECURITY INVOKER + service_role: service_role bypassed RLS.
-- Rolle/Ownership-Prüfung liegt in der Route (assertContractGenerationAllowed).
--
-- P0001-Codes:
--   INVALID_CONTRACT_FILE_SIZE    → 422
--   INVALID_CONTRACT_STORAGE_PATH → 422
--   OFFER_NOT_FOUND               → 404
--   OFFER_NOT_ACCEPTED            → 409
--   OLD_CONTRACT_DOCUMENT_MISMATCH → 409
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION register_contract_pdf(
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
  v_expected_prefix    text;
BEGIN
  -- Serverseitige Parametervalidierung (service_role bypassed RLS,
  -- daher defensive Checks vor jeder DB-Mutation).

  IF p_file_size_bytes IS NULL OR p_file_size_bytes <= 0 THEN
    RAISE EXCEPTION 'INVALID_CONTRACT_FILE_SIZE' USING ERRCODE = 'P0001';
  END IF;

  -- p_storage_path muss exakt unter {lead_id}/contract_pdf/ liegen
  -- und auf .pdf enden. Verhindert Path-Traversal und fehlgeleitete Pfade.
  v_expected_prefix := p_lead_id::text || '/contract_pdf/';
  IF p_storage_path NOT LIKE v_expected_prefix || '%.pdf'
     OR p_storage_path LIKE '%..%'
     OR p_storage_path LIKE '%//%'
  THEN
    RAISE EXCEPTION 'INVALID_CONTRACT_STORAGE_PATH' USING ERRCODE = 'P0001';
  END IF;

  -- Offer sperren: verhindert parallele Generierungen für dasselbe Offer.
  SELECT * INTO v_offer
  FROM offers
  WHERE id = p_offer_id AND lead_id = p_lead_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'OFFER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- Race-Schutz: Status könnte sich zwischen Route-Check und RPC-Lock geändert haben.
  IF v_offer.status != 'accepted' THEN
    RAISE EXCEPTION 'OFFER_NOT_ACCEPTED' USING ERRCODE = 'P0001';
  END IF;

  v_old_document_id := v_offer.contract_document_id;

  -- Bestehendes Dokument ersetzen: altes contract_pdf entfernen (streng gescoped).
  IF v_old_document_id IS NOT NULL THEN
    DELETE FROM documents
    WHERE id            = v_old_document_id
      AND lead_id       = p_lead_id
      AND document_type = 'contract_pdf'
    RETURNING storage_bucket, storage_path
      INTO v_old_storage_bucket, v_old_storage_path;

    -- 0 rows: contract_document_id zeigt auf kein contract_pdf dieses Leads → inkonsistenter Zustand.
    IF NOT FOUND THEN
      RAISE EXCEPTION 'OLD_CONTRACT_DOCUMENT_MISMATCH' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Neues Dokument registrieren.
  -- uploaded_by = NULL: systemgeneriert ohne menschlichen Uploader (analog offer_pdf).
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
    'contract_pdf',
    p_file_name,
    p_storage_path,
    'documents',
    'application/pdf',
    p_file_size_bytes
  );

  -- Offer mit neuem Dokument verknüpfen (Row bereits durch FOR UPDATE gesperrt).
  UPDATE offers
  SET contract_document_id = p_new_document_id
  WHERE id = p_offer_id AND lead_id = p_lead_id;

  -- Gibt altes Storage-Ziel zurück (NULL/NULL wenn kein vorheriges Dokument vorhanden).
  RETURN QUERY SELECT p_new_document_id, v_old_storage_bucket, v_old_storage_path;
END;
$$;

REVOKE EXECUTE ON FUNCTION register_contract_pdf(uuid, uuid, uuid, text, text, bigint)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION register_contract_pdf(uuid, uuid, uuid, text, text, bigint)
  TO service_role;
