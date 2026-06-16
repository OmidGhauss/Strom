-- Block 11: change_lead_status RPC
-- Atomare Statusänderung: UPDATE leads.status + INSERT lead_status_history
-- in einer impliziten PostgreSQL-Transaktion.
--
-- Sicherheitsmodell:
--   SECURITY INVOKER: explizit gesetzt (PostgreSQL-Default, aber zur Klarheit angegeben).
--   SECURITY DEFINER wird bewusst NICHT verwendet:
--     - Aufrufer ist adminClient (service_role) → RLS ohnehin bypassed.
--     - auth.uid() wird innerhalb der Funktion nicht benötigt:
--       changed_by wird als p_changed_by (profileId aus requireAuth()) übergeben.
--     - SECURITY DEFINER würde Rechte des Funktions-Owners annehmen — unnötig.
--
--   Zugriffsschutz liegt vollständig VOR dem RPC-Aufruf in der Route:
--     1. requireAuth()                        → gültiger authentifizierter User
--     2. assertStatusTransitionAllowedForRole → rollenbasierte Statusbeschränkung
--     3. user-aware RLS-Gate                  → kann dieser User diesen Lead sehen?
--     4. No-op Guard                          → kein Aufruf bei unverändertem Status
--
--   LEAD_NOT_FOUND: Sicherheitsnetz falls der Lead zwischen RLS-Gate und RPC
--   gelöscht wurde. Normalerweise fängt der RLS-Gate diesen Fall als
--   PGRST116 (0 Zeilen) → 404 ab.

CREATE OR REPLACE FUNCTION change_lead_status(
  p_lead_id    uuid,
  p_new_status lead_status,
  p_changed_by uuid,
  p_reason     text DEFAULT NULL
)
RETURNS TABLE(lead_id uuid, old_status lead_status, new_status lead_status)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_old_status lead_status;
BEGIN
  SELECT status INTO v_old_status
  FROM leads
  WHERE id = p_lead_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'LEAD_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  UPDATE leads
    SET status = p_new_status
  WHERE id = p_lead_id;

  INSERT INTO lead_status_history (lead_id, old_status, new_status, changed_by, reason)
  VALUES (p_lead_id, v_old_status, p_new_status, p_changed_by, p_reason);

  RETURN QUERY SELECT p_lead_id, v_old_status, p_new_status;
END;
$$;

REVOKE EXECUTE ON FUNCTION change_lead_status(uuid, lead_status, uuid, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION change_lead_status(uuid, lead_status, uuid, text)
  TO service_role;
