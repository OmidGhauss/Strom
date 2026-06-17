-- Block 21: change_lead_status CAS-Erweiterung
--
-- Ergänzt optionalen p_expected_status-Parameter für echten Compare-and-Set.
-- Fügt FOR UPDATE hinzu um Race Condition zwischen SELECT und UPDATE zu verhindern.
--
-- Backward-Kompatibilität:
--   Bestehende Aufrufer (z.B. PATCH /api/leads/[id]/status) übergeben p_expected_status nicht.
--   PostgreSQL nutzt den DEFAULT NULL → CAS-Check wird übersprungen → identisches Verhalten.
--   Named-parameter Aufrufe via Supabase SDK lösen korrekt auf: fehlende Parameter
--   erhalten DEFAULT-Werte, kein Funktions-Overloading nötig.
--
-- Deployment-Hinweis:
--   Diese Migration dropt die alte 4-Parameter-Signatur und erstellt eine neue
--   5-Parameter-Signatur. PostgreSQL behandelt beide als unterschiedliche Functions.
--   Nach dem Migration-Run ggf. Supabase/PostgREST Schema-Cache reloaden
--   (Dashboard → Settings → API → Reload Schema) damit PostgREST die neue Signatur
--   erkennt. App-Deploy mit aktualisiertem database.ts danach.
--   Smoke-Test: PATCH /api/leads/[id]/status (bestehend) + POST /contract/send (neu).
--
-- CAS-Verhalten:
--   p_expected_status IS NULL     → kein Check, Update erfolgt unabhängig vom alten Status
--   p_expected_status IS NOT NULL → Check: v_old_status muss gleich p_expected_status sein
--                                    sonst RAISE EXCEPTION 'LEAD_STATUS_MISMATCH'

DROP FUNCTION IF EXISTS change_lead_status(uuid, lead_status, uuid, text);

CREATE OR REPLACE FUNCTION change_lead_status(
  p_lead_id         uuid,
  p_new_status      lead_status,
  p_changed_by      uuid,
  p_reason          text        DEFAULT NULL,
  p_expected_status lead_status DEFAULT NULL
)
RETURNS TABLE(lead_id uuid, old_status lead_status, new_status lead_status)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_old_status lead_status;
BEGIN
  -- FOR UPDATE verhindert Race Condition zwischen Lesen und Schreiben des Status.
  SELECT status INTO v_old_status
  FROM   leads
  WHERE  id = p_lead_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'LEAD_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- CAS-Check: nur wenn Aufrufer einen erwarteten alten Status vorgibt.
  IF p_expected_status IS NOT NULL AND v_old_status != p_expected_status THEN
    RAISE EXCEPTION 'LEAD_STATUS_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  UPDATE leads
    SET status = p_new_status
  WHERE id = p_lead_id;

  INSERT INTO lead_status_history (lead_id, old_status, new_status, changed_by, reason)
  VALUES (p_lead_id, v_old_status, p_new_status, p_changed_by, p_reason);

  RETURN QUERY SELECT p_lead_id, v_old_status, p_new_status;
END;
$$;

REVOKE EXECUTE ON FUNCTION change_lead_status(uuid, lead_status, uuid, text, lead_status)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION change_lead_status(uuid, lead_status, uuid, text, lead_status)
  TO service_role;
