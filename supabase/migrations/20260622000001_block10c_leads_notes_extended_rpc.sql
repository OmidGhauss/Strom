-- Block 10c: leads.notes Spalte + erweiterter submit_public_lead RPC (v2)
--
-- Hintergrund:
--   Das öffentliche Formular erfasst Felder ohne dedizierte DB-Spalte:
--     ziele, erreichbarkeit, rechnung_dateiname/rechnung_groesse_kb.
--   lead_notes.created_by ist NOT NULL mit FK auf profiles →
--   keine anonymen Notizen möglich. Kleinster sicherer Fix: leads.notes text NULL.
--
-- Außerdem werden die energy_demands-Fachdaten (current_provider, monthly_payment,
-- contract_end_date, price_guarantee, heating_type, household_size) jetzt auch
-- beim initialen Submit persistiert.
--
-- Abwärtskompatibilität:
--   Alle neuen Parameter haben DEFAULT NULL. Bestehende Aufrufe ohne diese
--   Parameter funktionieren unverändert (Null-Semantik bleibt gleich).
--
-- Deployment-Reihenfolge:
--   Diese Migration VOR dem Route-Deployment anwenden.

-- ---------------------------------------------------------------------------
-- 1. Neue Spalte: leads.notes
-- ---------------------------------------------------------------------------
ALTER TABLE leads ADD COLUMN IF NOT EXISTS notes text NULL;

-- ---------------------------------------------------------------------------
-- 2. Alten RPC droppen (andere Parameterliste → CREATE OR REPLACE genügt nicht)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS submit_public_lead(
  text, text, text,
  customer_type, product_type,
  boolean, boolean,
  text, boolean,
  text, text, text, text, text, text,
  jsonb, jsonb,
  text
);

-- ---------------------------------------------------------------------------
-- 3. Erweiterter RPC submit_public_lead (v2)
-- ---------------------------------------------------------------------------
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
  p_phone                   text    DEFAULT NULL,
  p_data_transfer_consent   boolean DEFAULT NULL,
  p_source                  text    DEFAULT NULL,
  p_utm_source              text    DEFAULT NULL,
  p_utm_medium              text    DEFAULT NULL,
  p_utm_campaign            text    DEFAULT NULL,
  p_utm_term                text    DEFAULT NULL,
  p_utm_content             text    DEFAULT NULL,

  -- Adresse (JSONB-Objekt oder NULL; NULL = keine Adresse einfügen)
  -- Erwartete Schlüssel: street, house_number, address_addition,
  --                      postal_code, city, state, country
  p_address                 jsonb   DEFAULT NULL,

  -- Energy Demands (JSONB-Array, min. 1 Element)
  -- Jedes Element: {
  --   energy_type, annual_consumption_kwh, consumption_known,
  --   household_size, heating_type, hot_water_with_gas,
  --   current_provider, monthly_payment, contract_end_date, price_guarantee
  -- }
  p_energy_demands          jsonb   DEFAULT NULL,

  -- Affiliate (NULL = kein Lookup; ungültige/inaktive Codes werden still ignoriert)
  p_referral_code           text    DEFAULT NULL,

  -- Freitext für Formularfelder ohne DB-Spalte (ziele, erreichbarkeit, rechnung_*)
  -- Wird in leads.notes gespeichert; NULL = kein Eintrag
  p_initial_note            text    DEFAULT NULL
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
  -- notes wird aus p_initial_note gefüllt (NULL wenn keine Zusatzinfos).
  -- ---------------------------------------------------------------------------
  INSERT INTO leads (
    first_name, last_name, email, phone,
    product_type, customer_type,
    status, score, score_label,
    source,
    utm_source, utm_medium, utm_campaign, utm_term, utm_content,
    assigned_to,
    privacy_consent, contact_consent, data_transfer_consent,
    notes
  )
  VALUES (
    p_first_name, p_last_name, p_email, p_phone,
    p_product_type, p_customer_type,
    'new', 0, 'cold',
    p_source,
    p_utm_source, p_utm_medium, p_utm_campaign, p_utm_term, p_utm_content,
    NULL,
    p_privacy_consent, p_contact_consent, p_data_transfer_consent,
    p_initial_note
  )
  RETURNING id, lead_number INTO v_lead_id, v_lead_number;

  -- ---------------------------------------------------------------------------
  -- Write 2: addresses (optional)
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
  -- Alle energy_demands-Spalten werden jetzt befüllt, sofern im JSONB vorhanden.
  -- Fehlende Schlüssel im JSONB → NULL (PostgreSQL-JSONB-Semantik).
  -- DB-CHECK check_hot_water_gas_only: hot_water_with_gas nur bei gas erlaubt.
  -- ---------------------------------------------------------------------------
  FOR v_demand IN SELECT value FROM jsonb_array_elements(p_energy_demands)
  LOOP
    INSERT INTO energy_demands (
      lead_id,
      energy_type,
      annual_consumption_kwh,
      consumption_known,
      household_size,
      heating_type,
      hot_water_with_gas,
      current_provider,
      monthly_payment,
      contract_end_date,
      price_guarantee
    )
    VALUES (
      v_lead_id,
      (v_demand->>'energy_type')::energy_type,
      (v_demand->>'annual_consumption_kwh')::numeric,
      (v_demand->>'consumption_known')::boolean,
      (v_demand->>'household_size')::integer,
      v_demand->>'heating_type',
      (v_demand->>'hot_water_with_gas')::boolean,
      v_demand->>'current_provider',
      (v_demand->>'monthly_payment')::numeric,
      (v_demand->>'contract_end_date')::date,
      (v_demand->>'price_guarantee')::boolean
    );
  END LOOP;

  -- ---------------------------------------------------------------------------
  -- Write 4: lead_referrals (optional, silent fail)
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
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION submit_public_lead(
  text, text, text,
  customer_type, product_type,
  boolean, boolean,
  text, boolean,
  text, text, text, text, text, text,
  jsonb, jsonb,
  text,
  text
) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION submit_public_lead(
  text, text, text,
  customer_type, product_type,
  boolean, boolean,
  text, boolean,
  text, text, text, text, text, text,
  jsonb, jsonb,
  text,
  text
) FROM anon;

REVOKE EXECUTE ON FUNCTION submit_public_lead(
  text, text, text,
  customer_type, product_type,
  boolean, boolean,
  text, boolean,
  text, text, text, text, text, text,
  jsonb, jsonb,
  text,
  text
) FROM authenticated;

GRANT EXECUTE ON FUNCTION submit_public_lead(
  text, text, text,
  customer_type, product_type,
  boolean, boolean,
  text, boolean,
  text, text, text, text, text, text,
  jsonb, jsonb,
  text,
  text
) TO service_role;
