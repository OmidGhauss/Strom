-- Block 10b: RPC submit_public_lead()
--
-- Atomare PostgreSQL-Funktion für den öffentlichen Lead-Submit.
-- Schreibt in einer einzigen Transaktion:
--   1. leads
--   2. addresses        (optional – nur wenn p_address NOT NULL und mind. 1 Adressfeld ausgefüllt)
--   3. energy_demands   (1 oder 2 Zeilen je nach product_type)
--   4. lead_referrals   (optional – nur wenn p_referral_code auf aktiven Link auflöst)
--   5. lead_status_history (initial, old_status = NULL)
--
-- SECURITY DEFINER: läuft als Funktionsowner (postgres), bypasses RLS.
-- Aufrufer: ausschließlich service_role via Next.js API Route.
-- Kein direkter Aufruf durch anon oder authenticated möglich (REVOKE am Ende).

CREATE OR REPLACE FUNCTION submit_public_lead(
  -- Lead — Pflichtfelder (NOT NULL in DB)
  p_first_name              text,
  p_last_name               text,
  p_email                   text,
  p_customer_type           customer_type,
  p_product_type            product_type,
  p_privacy_consent         boolean,
  p_contact_consent         boolean,

  -- Lead — optionale Felder (NULL erlaubt)
  p_phone                   text,
  p_data_transfer_consent   boolean,
  p_source                  text,
  p_utm_source              text,
  p_utm_medium              text,
  p_utm_campaign            text,
  p_utm_term                text,
  p_utm_content             text,

  -- Adresse (JSONB-Objekt oder NULL; NULL = keine Adresse einfügen)
  -- Erwartete Schlüssel: street, house_number, address_addition,
  --                      postal_code, city, state, country
  p_address                 jsonb,

  -- Energy Demands (JSONB-Array, min. 1 Element)
  -- Jedes Element: { energy_type, annual_consumption_kwh, consumption_known, hot_water_with_gas }
  p_energy_demands          jsonb,

  -- Affiliate (NULL = kein Lookup; ungültige/inaktive Codes werden still ignoriert)
  p_referral_code           text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_lead_id       uuid;
  v_lead_number   text;
  v_link_id       uuid;
  v_demand        jsonb;
  v_elec_count    integer;
  v_gas_count     integer;
  v_referral_code text;
BEGIN

  -- ---------------------------------------------------------------------------
  -- Guard 1: privacy_consent und contact_consent müssen true sein
  -- IS NOT TRUE fängt sowohl false als auch NULL ab (NULL-sicher).
  -- Schützt gegen direkte RPC-Aufrufe, die die API-Schicht umgehen.
  -- ---------------------------------------------------------------------------
  IF p_privacy_consent IS NOT TRUE OR p_contact_consent IS NOT TRUE THEN
    RAISE EXCEPTION 'CONSENT_REQUIRED'
      USING ERRCODE = 'P0001',
            DETAIL  = 'privacy_consent and contact_consent must be true';
  END IF;

  -- ---------------------------------------------------------------------------
  -- Guard 2: energy_demands darf nicht NULL oder leer sein
  -- ---------------------------------------------------------------------------
  IF p_energy_demands IS NULL OR jsonb_array_length(p_energy_demands) = 0 THEN
    RAISE EXCEPTION 'ENERGY_DEMANDS_REQUIRED'
      USING ERRCODE = 'P0001',
            DETAIL  = 'p_energy_demands must contain at least one element';
  END IF;

  -- ---------------------------------------------------------------------------
  -- Guard 3: product_type ↔ energy_demands Konsistenz
  -- Zählung nach energy_type-Wert (reihenfolgeunabhängig).
  -- ---------------------------------------------------------------------------
  SELECT
    COUNT(*) FILTER (WHERE value->>'energy_type' = 'electricity'),
    COUNT(*) FILTER (WHERE value->>'energy_type' = 'gas')
  INTO v_elec_count, v_gas_count
  FROM jsonb_array_elements(p_energy_demands);

  IF p_product_type = 'electricity' AND NOT (v_elec_count = 1 AND v_gas_count = 0) THEN
    RAISE EXCEPTION 'ENERGY_DEMANDS_PRODUCT_TYPE_MISMATCH'
      USING ERRCODE = 'P0001',
            DETAIL  = 'product_type electricity requires exactly 1 electricity demand';
  END IF;

  IF p_product_type = 'gas' AND NOT (v_gas_count = 1 AND v_elec_count = 0) THEN
    RAISE EXCEPTION 'ENERGY_DEMANDS_PRODUCT_TYPE_MISMATCH'
      USING ERRCODE = 'P0001',
            DETAIL  = 'product_type gas requires exactly 1 gas demand';
  END IF;

  IF p_product_type = 'both' AND NOT (v_elec_count = 1 AND v_gas_count = 1) THEN
    RAISE EXCEPTION 'ENERGY_DEMANDS_PRODUCT_TYPE_MISMATCH'
      USING ERRCODE = 'P0001',
            DETAIL  = 'product_type both requires exactly 1 electricity and 1 gas demand';
  END IF;

  -- ---------------------------------------------------------------------------
  -- Write 1: leads
  -- lead_number, score, score_label, status haben DB-DEFAULTs —
  -- werden hier explizit gesetzt für Klarheit und Test-Nachvollziehbarkeit.
  -- assigned_to = NULL: öffentliche Leads starten immer unassigned.
  -- ---------------------------------------------------------------------------
  INSERT INTO leads (
    first_name, last_name, email, phone,
    product_type, customer_type,
    status, score, score_label,
    source,
    utm_source, utm_medium, utm_campaign, utm_term, utm_content,
    assigned_to,
    privacy_consent, contact_consent, data_transfer_consent
  )
  VALUES (
    p_first_name, p_last_name, p_email, p_phone,
    p_product_type, p_customer_type,
    'new', 0, 'cold',
    p_source,
    p_utm_source, p_utm_medium, p_utm_campaign, p_utm_term, p_utm_content,
    NULL,
    p_privacy_consent, p_contact_consent, p_data_transfer_consent
  )
  RETURNING id, lead_number INTO v_lead_id, v_lead_number;

  -- ---------------------------------------------------------------------------
  -- Write 2: addresses (optional)
  -- address_type = 'delivery' ist für öffentliche Formular-Submits fest.
  -- Nur einfügen wenn mindestens eines der Adressfelder ausgefüllt ist.
  -- Leere Strings werden wie NULL behandelt (NULLIF).
  -- Ein leeres JSONB-Objekt {} oder eines ohne relevante Felder wird übersprungen.
  -- ---------------------------------------------------------------------------
  IF p_address IS NOT NULL AND (
    NULLIF(p_address->>'street',       '') IS NOT NULL OR
    NULLIF(p_address->>'house_number', '') IS NOT NULL OR
    NULLIF(p_address->>'postal_code',  '') IS NOT NULL OR
    NULLIF(p_address->>'city',         '') IS NOT NULL OR
    NULLIF(p_address->>'state',        '') IS NOT NULL
  ) THEN
    INSERT INTO addresses (
      lead_id, address_type,
      street, house_number, address_addition,
      postal_code, city, state, country
    )
    VALUES (
      v_lead_id, 'delivery',
      NULLIF(p_address->>'street',           ''),
      NULLIF(p_address->>'house_number',     ''),
      NULLIF(p_address->>'address_addition', ''),
      NULLIF(p_address->>'postal_code',      ''),
      NULLIF(p_address->>'city',             ''),
      NULLIF(p_address->>'state',            ''),
      COALESCE(NULLIF(p_address->>'country', ''), 'DE')
    );
  END IF;

  -- ---------------------------------------------------------------------------
  -- Write 3: energy_demands (1 oder 2 Zeilen)
  -- Guard 3 hat bereits sichergestellt, dass die Anzahl zur product_type passt.
  -- DB-CHECK check_hot_water_gas_only fängt hot_water_with_gas bei electricity ab.
  -- DB-UNIQUE uq_energy_demands_lead_type verhindert doppelte energy_type-Einträge.
  -- ---------------------------------------------------------------------------
  FOR v_demand IN SELECT value FROM jsonb_array_elements(p_energy_demands)
  LOOP
    INSERT INTO energy_demands (
      lead_id,
      energy_type,
      annual_consumption_kwh,
      consumption_known,
      hot_water_with_gas
    )
    VALUES (
      v_lead_id,
      (v_demand->>'energy_type')::energy_type,
      (v_demand->>'annual_consumption_kwh')::numeric,
      (v_demand->>'consumption_known')::boolean,
      (v_demand->>'hot_water_with_gas')::boolean
    );
  END LOOP;

  -- ---------------------------------------------------------------------------
  -- Write 4: lead_referrals (optional, silent fail)
  -- Ungültige oder inaktive Codes werden ignoriert — kein Fehler, kein Hinweis.
  -- Verhindert Code-Enumeration durch Angreifer.
  -- trim() entfernt führende/nachfolgende Whitespace vor dem Lookup.
  -- upper() normalisiert zu Großbuchstaben (DB-CHECK erwartet UPPERCASE).
  -- NULL und Leerstring nach trim() werden übersprungen.
  -- ---------------------------------------------------------------------------
  v_referral_code := upper(trim(p_referral_code));

  IF v_referral_code IS NOT NULL AND v_referral_code <> '' THEN
    SELECT id INTO v_link_id
    FROM affiliate_links
    WHERE referral_code = v_referral_code
      AND status = 'active';

    IF v_link_id IS NOT NULL THEN
      INSERT INTO lead_referrals (lead_id, affiliate_link_id)
      VALUES (v_lead_id, v_link_id);
    END IF;
  END IF;

  -- ---------------------------------------------------------------------------
  -- Write 5: lead_status_history (initialer Eintrag, immer)
  -- old_status = NULL: kein Vorgängerstatus bei Ersterstellung.
  -- changed_by = NULL: kein authentifizierter User — öffentliches Formular.
  -- reason = 'public_lead_submit': maschinenlesbarer Auslöser.
  -- ---------------------------------------------------------------------------
  INSERT INTO lead_status_history (lead_id, old_status, new_status, changed_by, reason)
  VALUES (v_lead_id, NULL, 'new', NULL, 'public_lead_submit');

  -- ---------------------------------------------------------------------------
  -- Rückgabe
  -- ---------------------------------------------------------------------------
  RETURN jsonb_build_object(
    'lead_id',     v_lead_id,
    'lead_number', v_lead_number
  );

END;
$$;

-- ---------------------------------------------------------------------------
-- Berechtigungen
--
-- PostgreSQL erteilt EXECUTE standardmäßig an PUBLIC.
-- Explizites REVOKE für PUBLIC, anon und authenticated — nur service_role
-- darf diese Funktion aufrufen.
-- Parameterliste muss exakt der Funktionssignatur entsprechen.
-- ---------------------------------------------------------------------------

REVOKE EXECUTE ON FUNCTION submit_public_lead(
  text, text, text,
  customer_type, product_type,
  boolean, boolean,
  text, boolean,
  text, text, text, text, text, text,
  jsonb, jsonb,
  text
) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION submit_public_lead(
  text, text, text,
  customer_type, product_type,
  boolean, boolean,
  text, boolean,
  text, text, text, text, text, text,
  jsonb, jsonb,
  text
) FROM anon;

REVOKE EXECUTE ON FUNCTION submit_public_lead(
  text, text, text,
  customer_type, product_type,
  boolean, boolean,
  text, boolean,
  text, text, text, text, text, text,
  jsonb, jsonb,
  text
) FROM authenticated;

GRANT EXECUTE ON FUNCTION submit_public_lead(
  text, text, text,
  customer_type, product_type,
  boolean, boolean,
  text, boolean,
  text, text, text, text, text, text,
  jsonb, jsonb,
  text
) TO service_role;
