-- Block 12b: Atomarer product_type-Wechsel mit energy_demands-Verwaltung
--
-- Locking-Kette (verhindert Race Conditions):
--   1. SELECT leads FOR UPDATE → keine parallelen product_type-Wechsel für denselben Lead
--   2. SELECT energy_demands FOR UPDATE → parallele Offer-Inserts auf zu löschende Demands
--      treffen auf diesen Row-Lock: FK-Prüfung des Offer-Inserts wartet bis COMMIT/ROLLBACK.
--      Nach COMMIT: energy_demand gelöscht → Offer-FK-Prüfung schlägt fehl (23503).
--      Nach ROLLBACK: Lock freigegeben → Offer-Insert kann normal fortfahren.
--   3. Offers-Conflict-Check nach Locking → stabil, kein TOCTOU mehr.
--
-- ARRAY[]::energy_type[] beim Ziel 'both': = ANY([]) ist immer false →
--   kein Lock, kein DELETE, kein Conflict. Explizit so gewollt.

CREATE OR REPLACE FUNCTION change_lead_product_type(
  p_lead_id      uuid,
  p_product_type product_type
)
RETURNS TABLE(
  lead_id          uuid,
  old_product_type product_type,
  new_product_type product_type,
  energy_types     energy_type[]   -- resultierende energy_types, immer electricity vor gas
)
LANGUAGE plpgsql
-- SECURITY INVOKER (PostgreSQL default) — explizit dokumentiert.
-- SECURITY DEFINER bewusst nicht: adminClient (service_role) ruft diese Funktion auf
-- und bypassed RLS ohnehin. auth.uid() wird nicht benötigt.
-- Authorization liegt vollständig im API-Layer (assertManagerOrAbove + RLS-Gate).
SECURITY INVOKER
AS $$
DECLARE
  v_old_product_type        product_type;
  v_energy_types_to_delete  energy_type[];
  v_result_energy_types     energy_type[];
BEGIN
  -- Schritt 1: Lead-Zeile locken.
  -- FOR UPDATE blockiert parallele Transaktionen, die denselben Lead ändern wollen.
  SELECT product_type
  INTO v_old_product_type
  FROM leads
  WHERE id = p_lead_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'LEAD_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- Schritt 2: Zu löschende energy_types berechnen.
  -- 'both' → leeres Array → alle folgenden ANY-Checks sind false.
  v_energy_types_to_delete := CASE p_product_type
    WHEN 'electricity' THEN ARRAY['gas']::energy_type[]
    WHEN 'gas'         THEN ARRAY['electricity']::energy_type[]
    WHEN 'both'        THEN ARRAY[]::energy_type[]
  END;

  -- Schritt 3: Zu löschende energy_demands locken (FOR UPDATE).
  -- Verhindert Offer-Insert-Race: FK-Prüfung des Offer-Inserts auf diese Zeile
  -- wartet bis COMMIT (→ FK-Fehler weil Zeile gelöscht) oder ROLLBACK (→ ok).
  -- Bei leerem Array liefert die Query 0 Zeilen → kein Lock, kein Problem.
  PERFORM id
  FROM energy_demands
  WHERE lead_id = p_lead_id
    AND energy_type = ANY(v_energy_types_to_delete)
  FOR UPDATE;

  -- Schritt 4: Offers-Conflict-Check (nach Locking → stabil, kein TOCTOU).
  IF EXISTS (
    SELECT 1
    FROM energy_demands ed
    JOIN offers o ON o.energy_demand_id = ed.id
    WHERE ed.lead_id = p_lead_id
      AND ed.energy_type = ANY(v_energy_types_to_delete)
  ) THEN
    RAISE EXCEPTION 'OFFERS_REFERENCE_ENERGY_DEMAND' USING ERRCODE = 'P0001';
  END IF;

  -- Schritt 5: leads.product_type atomar aktualisieren.
  UPDATE leads
  SET product_type = p_product_type
  WHERE id = p_lead_id;

  -- Schritt 6: Nicht mehr passende energy_demands löschen.
  DELETE FROM energy_demands
  WHERE lead_id = p_lead_id
    AND energy_type = ANY(v_energy_types_to_delete);

  -- Schritt 7: Fehlende Ziel-energy_demands anlegen.
  -- ON CONFLICT DO NOTHING: bestehende Zeilen (electricity bei Wechsel nach 'both') bleiben erhalten.
  CASE p_product_type
    WHEN 'electricity' THEN
      INSERT INTO energy_demands (lead_id, energy_type)
        VALUES (p_lead_id, 'electricity')
        ON CONFLICT (lead_id, energy_type) DO NOTHING;

    WHEN 'gas' THEN
      INSERT INTO energy_demands (lead_id, energy_type)
        VALUES (p_lead_id, 'gas')
        ON CONFLICT (lead_id, energy_type) DO NOTHING;

    WHEN 'both' THEN
      INSERT INTO energy_demands (lead_id, energy_type)
        VALUES (p_lead_id, 'electricity'), (p_lead_id, 'gas')
        ON CONFLICT (lead_id, energy_type) DO NOTHING;
  END CASE;

  -- Schritt 8: Resultierende energy_types deterministisch aus p_product_type.
  -- Reihenfolge immer: electricity vor gas.
  v_result_energy_types := CASE p_product_type
    WHEN 'electricity' THEN ARRAY['electricity']::energy_type[]
    WHEN 'gas'         THEN ARRAY['gas']::energy_type[]
    WHEN 'both'        THEN ARRAY['electricity', 'gas']::energy_type[]
  END;

  RETURN QUERY SELECT p_lead_id, v_old_product_type, p_product_type, v_result_energy_types;
END;
$$;

REVOKE EXECUTE ON FUNCTION change_lead_product_type(uuid, product_type)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION change_lead_product_type(uuid, product_type)
  TO service_role;
