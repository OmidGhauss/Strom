-- Block 8: Row Level Security (RLS)
--
-- Drei Zugriffspfade:
--   authenticated  → RLS greift vollständig
--   service_role   → bypasses RLS (nur serverseitig in Next.js API Routes)
--   anon           → keine Policies → kein Zugriff auf CRM-Tabellen
--
-- Alle Hilfsfunktionen sind SECURITY DEFINER mit explizitem search_path,
-- damit sie profiles lesen können ohne von profiles-RLS blockiert zu werden.
-- Ohne SECURITY DEFINER würde eine zirkuläre Policy-Auswertung entstehen.

-- ---------------------------------------------------------------------------
-- Hilfsfunktionen
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION current_profile_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT id FROM profiles WHERE auth_user_id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION current_user_role()
RETURNS user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT role FROM profiles WHERE auth_user_id = auth.uid()
$$;

-- COALESCE(... , false): gibt false zurück wenn kein Profil existiert
-- oder wenn auth.uid() NULL ist (anon-Kontext).

CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT COALESCE(current_user_role() = 'admin', false)
$$;

CREATE OR REPLACE FUNCTION is_manager_or_above()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT COALESCE(current_user_role() IN ('admin', 'manager'), false)
$$;

-- Zentrale Zugriffsfunktion für alle lead_id-abhängigen Tabellen.
-- Wenn ein Lead reassigned wird, ändert sich der Zugriff auf alle
-- abhängigen Tabellen automatisch.
CREATE OR REPLACE FUNCTION can_access_lead(p_lead_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT
    is_manager_or_above()
    OR EXISTS (
      SELECT 1 FROM leads
      WHERE id = p_lead_id
        AND assigned_to = current_profile_id()
    )
$$;

GRANT EXECUTE ON FUNCTION current_profile_id()    TO authenticated;
GRANT EXECUTE ON FUNCTION current_user_role()     TO authenticated;
GRANT EXECUTE ON FUNCTION is_admin()              TO authenticated;
GRANT EXECUTE ON FUNCTION is_manager_or_above()   TO authenticated;
GRANT EXECUTE ON FUNCTION can_access_lead(uuid)   TO authenticated;

-- ---------------------------------------------------------------------------
-- RLS aktivieren
-- ---------------------------------------------------------------------------

ALTER TABLE profiles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads               ENABLE ROW LEVEL SECURITY;
ALTER TABLE addresses           ENABLE ROW LEVEL SECURITY;
ALTER TABLE energy_demands      ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_notes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents           ENABLE ROW LEVEL SECURITY;
ALTER TABLE offers              ENABLE ROW LEVEL SECURITY;
ALTER TABLE communications_log  ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- profiles
--
-- WICHTIG: profiles-Policies verwenden auth.uid() direkt, NICHT die
-- Hilfsfunktionen is_admin() / is_manager_or_above() in der ersten Policy.
-- is_manager_or_above() ist SECURITY DEFINER und damit sicher, aber
-- auth_user_id = auth.uid() ist die einfachste und klarste Variante.
--
-- UPDATE: admin-only. Employees dürfen ihr Profil nicht direkt updaten,
-- weil RLS nicht einzelne Spalten sperren kann (role, is_active).
-- Eigene Profiländerungen (full_name) kommen über PATCH /api/me
-- mit serverseitiger Spalten-Whitelist.
-- ---------------------------------------------------------------------------

CREATE POLICY "profiles: select own row"
  ON profiles FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid());

-- Zweite PERMISSIVE Policy — wird OR-verknüpft mit der ersten.
-- Manager und Admins sehen alle Zeilen.
CREATE POLICY "profiles: select all rows for manager and admin"
  ON profiles FOR SELECT TO authenticated
  USING (is_manager_or_above());

CREATE POLICY "profiles: insert admin only"
  ON profiles FOR INSERT TO authenticated
  WITH CHECK (is_admin());

CREATE POLICY "profiles: update admin only"
  ON profiles FOR UPDATE TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- Kein DELETE: RESTRICT auf auth_user_id verhindert Löschung ohnehin.

-- ---------------------------------------------------------------------------
-- leads
--
-- Employee INSERT WITH CHECK: assigned_to muss die eigene profile_id sein.
-- Verhindert dass Employees Leads anlegen und offen oder fremd zuweisen.
-- Manager/Admin: dürfen assigned_to frei setzen.
-- ---------------------------------------------------------------------------

CREATE POLICY "leads: select"
  ON leads FOR SELECT TO authenticated
  USING (
    is_manager_or_above()
    OR assigned_to = current_profile_id()
  );

CREATE POLICY "leads: insert"
  ON leads FOR INSERT TO authenticated
  WITH CHECK (
    is_manager_or_above()
    OR assigned_to = current_profile_id()
  );

CREATE POLICY "leads: update"
  ON leads FOR UPDATE TO authenticated
  USING (
    is_manager_or_above()
    OR assigned_to = current_profile_id()
  )
  WITH CHECK (
    is_manager_or_above()
    OR assigned_to = current_profile_id()
  );

CREATE POLICY "leads: delete admin only"
  ON leads FOR DELETE TO authenticated
  USING (is_admin());

-- ---------------------------------------------------------------------------
-- addresses
-- ---------------------------------------------------------------------------

CREATE POLICY "addresses: select"
  ON addresses FOR SELECT TO authenticated
  USING (can_access_lead(lead_id));

CREATE POLICY "addresses: insert"
  ON addresses FOR INSERT TO authenticated
  WITH CHECK (can_access_lead(lead_id));

CREATE POLICY "addresses: update"
  ON addresses FOR UPDATE TO authenticated
  USING (can_access_lead(lead_id))
  WITH CHECK (can_access_lead(lead_id));

CREATE POLICY "addresses: delete admin only"
  ON addresses FOR DELETE TO authenticated
  USING (is_admin());

-- ---------------------------------------------------------------------------
-- energy_demands
-- ---------------------------------------------------------------------------

CREATE POLICY "energy_demands: select"
  ON energy_demands FOR SELECT TO authenticated
  USING (can_access_lead(lead_id));

CREATE POLICY "energy_demands: insert"
  ON energy_demands FOR INSERT TO authenticated
  WITH CHECK (can_access_lead(lead_id));

CREATE POLICY "energy_demands: update"
  ON energy_demands FOR UPDATE TO authenticated
  USING (can_access_lead(lead_id))
  WITH CHECK (can_access_lead(lead_id));

CREATE POLICY "energy_demands: delete admin only"
  ON energy_demands FOR DELETE TO authenticated
  USING (is_admin());

-- ---------------------------------------------------------------------------
-- lead_status_history
--
-- Kein UPDATE — Historieneinträge sind unveränderlich.
-- Kein UPDATE-Policy bedeutet: jeder UPDATE-Versuch wird abgelehnt.
-- ---------------------------------------------------------------------------

CREATE POLICY "lead_status_history: select"
  ON lead_status_history FOR SELECT TO authenticated
  USING (can_access_lead(lead_id));

CREATE POLICY "lead_status_history: insert"
  ON lead_status_history FOR INSERT TO authenticated
  WITH CHECK (can_access_lead(lead_id));

-- Kein UPDATE.

CREATE POLICY "lead_status_history: delete admin only"
  ON lead_status_history FOR DELETE TO authenticated
  USING (is_admin());

-- ---------------------------------------------------------------------------
-- lead_notes
--
-- UPDATE und DELETE: nur Admin oder Autor.
-- Manager darf fremde Notizen nicht bearbeiten oder löschen –
-- auch nicht eigene (gemäß Policy-Matrix: manager = nein).
-- NOT is_manager_or_above() stellt sicher, dass ausschließlich Employees
-- ihre eigenen Notizen bearbeiten können.
-- ---------------------------------------------------------------------------

CREATE POLICY "lead_notes: select"
  ON lead_notes FOR SELECT TO authenticated
  USING (can_access_lead(lead_id));

CREATE POLICY "lead_notes: insert"
  ON lead_notes FOR INSERT TO authenticated
  WITH CHECK (can_access_lead(lead_id));

CREATE POLICY "lead_notes: update"
  ON lead_notes FOR UPDATE TO authenticated
  USING (
    is_admin()
    OR (NOT is_manager_or_above() AND created_by = current_profile_id())
  )
  WITH CHECK (
    is_admin()
    OR (NOT is_manager_or_above() AND created_by = current_profile_id())
  );

CREATE POLICY "lead_notes: delete"
  ON lead_notes FOR DELETE TO authenticated
  USING (
    is_admin()
    OR (NOT is_manager_or_above() AND created_by = current_profile_id())
  );

-- ---------------------------------------------------------------------------
-- documents
--
-- UPDATE: Admin darf alles; Manager darf Metadaten aller zugänglichen Leads;
-- Employee darf nur eigene Uploads.
-- Die Einschränkung welche Felder geändert werden dürfen (nicht storage_path,
-- nicht OCR-Felder für Employee) liegt in der API Route.
-- ---------------------------------------------------------------------------

CREATE POLICY "documents: select"
  ON documents FOR SELECT TO authenticated
  USING (can_access_lead(lead_id));

CREATE POLICY "documents: insert"
  ON documents FOR INSERT TO authenticated
  WITH CHECK (can_access_lead(lead_id));

CREATE POLICY "documents: update"
  ON documents FOR UPDATE TO authenticated
  USING (
    can_access_lead(lead_id)
    AND (is_manager_or_above() OR uploaded_by = current_profile_id())
  )
  WITH CHECK (
    can_access_lead(lead_id)
    AND (is_manager_or_above() OR uploaded_by = current_profile_id())
  );

CREATE POLICY "documents: delete admin only"
  ON documents FOR DELETE TO authenticated
  USING (is_admin());

-- ---------------------------------------------------------------------------
-- offers
-- ---------------------------------------------------------------------------

CREATE POLICY "offers: select"
  ON offers FOR SELECT TO authenticated
  USING (can_access_lead(lead_id));

CREATE POLICY "offers: insert"
  ON offers FOR INSERT TO authenticated
  WITH CHECK (can_access_lead(lead_id));

CREATE POLICY "offers: update"
  ON offers FOR UPDATE TO authenticated
  USING (can_access_lead(lead_id))
  WITH CHECK (can_access_lead(lead_id));

CREATE POLICY "offers: delete admin only"
  ON offers FOR DELETE TO authenticated
  USING (is_admin());

-- ---------------------------------------------------------------------------
-- communications_log
-- ---------------------------------------------------------------------------

CREATE POLICY "communications_log: select"
  ON communications_log FOR SELECT TO authenticated
  USING (can_access_lead(lead_id));

CREATE POLICY "communications_log: insert"
  ON communications_log FOR INSERT TO authenticated
  WITH CHECK (can_access_lead(lead_id));

CREATE POLICY "communications_log: update"
  ON communications_log FOR UPDATE TO authenticated
  USING (can_access_lead(lead_id))
  WITH CHECK (can_access_lead(lead_id));

CREATE POLICY "communications_log: delete admin only"
  ON communications_log FOR DELETE TO authenticated
  USING (is_admin());
