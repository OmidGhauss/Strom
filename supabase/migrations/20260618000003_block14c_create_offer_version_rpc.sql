-- Block 14c: Offer Versioning RPC
--
-- Atomarer Statuswechsel:
--   1. Alte Offer → status = 'superseded'
--   2. Neue Offer → status = 'draft', parent_offer_id = alte Offer, version + 1
--
-- SECURITY INVOKER: RLS (offers: update, insert) greift innerhalb der Funktion.
-- RPC prüft Rollen-/Ownership authoritative (kein Verlass auf Route-Guards).
--
-- GRANT TO authenticated — kein service_role (user-aware createClient ruft RPC).
-- REVOKE FROM PUBLIC, anon.
--
-- FOR UPDATE Lock auf alte Offer verhindert parallele Doppel-Versionierungen.

CREATE OR REPLACE FUNCTION create_offer_version(
  p_lead_id           uuid,
  p_offer_id          uuid,
  p_energy_demand_id  uuid,
  p_provider_name     text,
  p_tariff_name       text,
  p_energy_type       energy_type,
  p_monthly_price     numeric,
  p_annual_price      numeric,
  p_estimated_savings numeric,
  p_valid_until       date,
  p_notes             text
)
RETURNS TABLE(new_offer_id uuid, new_version integer)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_old_offer   offers%ROWTYPE;
  v_caller_role user_role;
  v_caller_id   uuid;
  v_versionable offer_status[] := ARRAY['sent','rejected','expired']::offer_status[];
  v_new_id      uuid;
  v_new_version integer;
BEGIN
  -- Caller-Kontext einmal lesen.
  -- current_user_role() und current_profile_id() sind SECURITY DEFINER — lesen
  -- immer das aufrufende auth.uid(), auch innerhalb dieser SECURITY INVOKER Funktion.
  v_caller_role := current_user_role();
  v_caller_id   := current_profile_id();

  -- Alte Offer laden + locken.
  -- RLS offers:select greift (can_access_lead). FOR UPDATE verhindert parallele
  -- Versionierungen derselben Offer.
  SELECT * INTO v_old_offer
  FROM offers
  WHERE id = p_offer_id
    AND lead_id = p_lead_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'OFFER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- Authoritative Status-Check.
  -- Nur sent/rejected/expired sind versionierbar.
  -- draft → PATCH verwenden; accepted/superseded → terminal.
  IF NOT (v_old_offer.status = ANY(v_versionable)) THEN
    RAISE EXCEPTION 'OFFER_NOT_VERSIONABLE' USING ERRCODE = 'P0001';
  END IF;

  -- Authoritative Rollen-/Ownership-Check.
  -- Employee darf nur eigene Offers versionieren.
  -- IS DISTINCT FROM behandelt NULL created_by korrekt (NULL ≠ jede UUID → employee blockiert).
  IF v_caller_role = 'employee'
     AND v_old_offer.created_by IS DISTINCT FROM v_caller_id
  THEN
    RAISE EXCEPTION 'OFFER_FORBIDDEN' USING ERRCODE = 'P0001';
  END IF;

  v_new_version := v_old_offer.version + 1;

  -- Atomar: Alte Offer superseden.
  -- RLS offers:update greift (can_access_lead).
  UPDATE offers
  SET status = 'superseded'
  WHERE id = p_offer_id
    AND lead_id = p_lead_id;

  -- Neue Offer als draft anlegen.
  -- RLS offers:insert greift (can_access_lead).
  -- created_by = v_caller_id (aus auth-Kontext, nicht aus Parameter).
  -- offer_number, id: DB-Defaults (Sequence / gen_random_uuid()).
  INSERT INTO offers (
    lead_id,
    energy_demand_id,
    created_by,
    parent_offer_id,
    version,
    provider_name,
    tariff_name,
    energy_type,
    monthly_price,
    annual_price,
    estimated_savings,
    status,
    valid_until,
    notes
  ) VALUES (
    p_lead_id,
    p_energy_demand_id,
    v_caller_id,
    p_offer_id,
    v_new_version,
    p_provider_name,
    p_tariff_name,
    p_energy_type,
    p_monthly_price,
    p_annual_price,
    p_estimated_savings,
    'draft',
    p_valid_until,
    p_notes
  )
  RETURNING id INTO v_new_id;

  RETURN QUERY SELECT v_new_id, v_new_version;
END;
$$;

REVOKE EXECUTE
  ON FUNCTION create_offer_version(uuid, uuid, uuid, text, text, energy_type, numeric, numeric, numeric, date, text)
  FROM PUBLIC, anon;

GRANT EXECUTE
  ON FUNCTION create_offer_version(uuid, uuid, uuid, text, text, energy_type, numeric, numeric, numeric, date, text)
  TO authenticated;
