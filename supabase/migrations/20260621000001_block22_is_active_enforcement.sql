-- Block 22: is_active Enforcement
--
-- Drei Schichten gegen deaktivierte Nutzer:
--
--   Schicht 1 (App)  — requireAuth() prüft is_active explizit → 401
--                      (Codeänderung in src/lib/api/auth.ts, kein SQL)
--
--   Schicht 2 (DB)   — current_profile_id() + current_user_role() filtern
--                      inaktive Profile heraus.
--                      Kaskadenwirkung: is_admin(), is_manager_or_above(),
--                      can_access_lead() erben automatisch ohne eigene Änderung.
--
--   Schicht 3 (DB)   — "profiles: select own row" Policy enthält is_active = true.
--                      Inaktiver User → 0 Zeilen bei profiles-SELECT → requireAuth()
--                      scheitert bereits durch profileError/!profile-Check.
--                      Der explizite !profile.is_active-Check in der App bietet
--                      darüber hinaus klare Semantik, konsistentes 401-Verhalten
--                      und Server-Logging (Defense-in-depth).
--
-- NICHT geändert (bewusst):
--   is_admin(), is_manager_or_above(), can_access_lead()  — Kaskade reicht
--   "profiles: select all rows for manager and admin"     — aktive Admins müssen
--                                                           inaktive Profile sehen
--                                                           können (User-Management)
--   Alle anderen Policies (leads, offers, etc.)           — Kaskade via can_access_lead
--
-- Fehlersemantik:
--   API-Layer (via requireAuth()):       HTTP 401 garantiert
--   Direkte PostgREST/RPC-Aufrufe:      kein HTTP-Status garantiert —
--                                        RLS liefert 0 Zeilen, leere Resultsets,
--                                        PGRST116, oder DB-/Business-Fehler
--                                        (z.B. OFFER_NOT_FOUND bei create_offer_version)
--
-- Deployment:
--   Migration und App-Deploy können in beliebiger Reihenfolge erfolgen.
--   current_profile_id() / current_user_role() ändern nur den Funktionskörper,
--   nicht die Signatur → kein PostgREST Schema-Cache-Reload nötig.
--   "profiles: select own row" DROP+CREATE ist atomar innerhalb dieser Migration.
--
-- Betriebsregel Admin Self-Deaktivierung:
--   Es muss jederzeit mindestens ein weiterer aktiver Admin-Account existieren,
--   bevor ein Admin-Account deaktiviert wird. Reaktivierung ist ausschließlich
--   über das Supabase Dashboard (direkte DB-Verbindung) möglich.

-- ---------------------------------------------------------------------------
-- Schicht 2: RLS-Hilfsfunktionen — is_active = true Filter
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION current_profile_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT id FROM profiles
  WHERE  auth_user_id = auth.uid()
    AND  is_active    = true
$$;

CREATE OR REPLACE FUNCTION current_user_role()
RETURNS user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT role FROM profiles
  WHERE  auth_user_id = auth.uid()
    AND  is_active    = true
$$;

-- ---------------------------------------------------------------------------
-- Schicht 3: profiles SELECT-Policy — is_active = true
-- ---------------------------------------------------------------------------

DROP POLICY "profiles: select own row" ON profiles;

CREATE POLICY "profiles: select own row"
  ON profiles FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid() AND is_active = true);
