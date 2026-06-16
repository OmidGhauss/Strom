-- Block 9a: Affiliate V1 – Einfaches Empfehlungslink-System
--
-- Ziel: Affiliate-Link → Lead-Zuordnung → Abschluss später auswertbar.
-- V1 ist reine Attribution. Keine Provisionen, kein Pyramidensystem.
--
-- Reihenfolge wegen FK-Abhängigkeiten:
--   affiliates → affiliate_links → lead_referrals

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

CREATE TYPE affiliate_status AS ENUM (
  'active',
  'inactive',
  'suspended'
);

-- Affiliates werden nie gelöscht, nur deaktiviert (ON DELETE RESTRICT auf affiliate_links).
-- 'suspended' = Admin-seitige Sperre (z. B. bei Verstößen).

CREATE TYPE affiliate_link_status AS ENUM (
  'active',
  'inactive'
);

-- Links werden nie gelöscht, nur deaktiviert (ON DELETE RESTRICT auf lead_referrals).
-- Inaktive Links erzeugen keine neuen Referrals, bleiben aber für historische Queries erhalten.

-- ---------------------------------------------------------------------------
-- Tabelle: affiliates
-- ---------------------------------------------------------------------------

CREATE TABLE affiliates (
  id          uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text              NOT NULL,
  email       text              NOT NULL,
  status      affiliate_status  NOT NULL DEFAULT 'active',
  notes       text              NULL,
  created_at  timestamptz       NOT NULL DEFAULT now(),
  updated_at  timestamptz       NOT NULL DEFAULT now(),

  CONSTRAINT uq_affiliates_email UNIQUE (email)
);

CREATE INDEX idx_affiliates_status ON affiliates (status);

CREATE TRIGGER set_affiliates_updated_at
  BEFORE UPDATE ON affiliates
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_updated_at();

-- ---------------------------------------------------------------------------
-- Tabelle: affiliate_links
--
-- referral_code: immer UPPERCASE, Format ^[A-Z0-9-]{3,32}$.
-- Zwei DB-CHECKs als letztes Sicherheitsnetz — die API normalisiert bereits.
-- Admin vergibt den Code manuell (NOT NULL, kein DEFAULT).
-- ---------------------------------------------------------------------------

CREATE TABLE affiliate_links (
  id             uuid                   PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id   uuid                   NOT NULL,
  referral_code  text                   NOT NULL,
  label          text                   NULL,
  status         affiliate_link_status  NOT NULL DEFAULT 'active',
  created_at     timestamptz            NOT NULL DEFAULT now(),
  updated_at     timestamptz            NOT NULL DEFAULT now(),

  CONSTRAINT uq_affiliate_links_referral_code UNIQUE (referral_code),

  -- Beide CHECKs gemeinsam: UPPERCASE-Erzwingung + Format-Validierung
  CONSTRAINT chk_referral_code_uppercase
    CHECK (referral_code = upper(referral_code)),
  CONSTRAINT chk_referral_code_format
    CHECK (referral_code ~ '^[A-Z0-9-]{3,32}$'),

  CONSTRAINT fk_affiliate_links_affiliate
    FOREIGN KEY (affiliate_id)
    REFERENCES affiliates(id)
    ON DELETE RESTRICT
);

CREATE INDEX idx_affiliate_links_affiliate_id ON affiliate_links (affiliate_id);
CREATE INDEX idx_affiliate_links_status       ON affiliate_links (status);

CREATE TRIGGER set_affiliate_links_updated_at
  BEFORE UPDATE ON affiliate_links
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_updated_at();

-- ---------------------------------------------------------------------------
-- Tabelle: lead_referrals
--
-- Unveränderliche Zuordnung: ein Lead hat maximal eine Referral-Quelle.
-- Kein updated_at — Historieneinträge werden nie verändert.
-- DSGVO: ON DELETE CASCADE auf lead_id (Referral weg wenn Lead weg).
-- ON DELETE RESTRICT auf affiliate_link_id (Link mit Referrals nicht löschbar).
-- ---------------------------------------------------------------------------

CREATE TABLE lead_referrals (
  id                 uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id            uuid         NOT NULL,
  affiliate_link_id  uuid         NOT NULL,
  notes              text         NULL,
  created_at         timestamptz  NOT NULL DEFAULT now(),

  CONSTRAINT uq_lead_referrals_lead_id UNIQUE (lead_id),

  CONSTRAINT fk_lead_referrals_lead
    FOREIGN KEY (lead_id)
    REFERENCES leads(id)
    ON DELETE CASCADE,

  CONSTRAINT fk_lead_referrals_affiliate_link
    FOREIGN KEY (affiliate_link_id)
    REFERENCES affiliate_links(id)
    ON DELETE RESTRICT
);

CREATE INDEX idx_lead_referrals_affiliate_link_id ON lead_referrals (affiliate_link_id);

-- ---------------------------------------------------------------------------
-- RLS aktivieren
-- ---------------------------------------------------------------------------

ALTER TABLE affiliates      ENABLE ROW LEVEL SECURITY;
ALTER TABLE affiliate_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_referrals  ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- affiliates – Policies
--
-- SELECT: Manager und Admin (Employee sieht keine Affiliate-Stammdaten).
-- INSERT/UPDATE: Admin only.
-- DELETE: keine Policy → kein DELETE möglich (RESTRICT verhindert es ohnehin).
-- ---------------------------------------------------------------------------

CREATE POLICY "affiliates: select manager and admin"
  ON affiliates FOR SELECT TO authenticated
  USING (is_manager_or_above());

CREATE POLICY "affiliates: insert admin only"
  ON affiliates FOR INSERT TO authenticated
  WITH CHECK (is_admin());

CREATE POLICY "affiliates: update admin only"
  ON affiliates FOR UPDATE TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- ---------------------------------------------------------------------------
-- affiliate_links – Policies
--
-- Identisch zu affiliates: Manager/Admin SELECT, Admin INSERT/UPDATE, kein DELETE.
-- ---------------------------------------------------------------------------

CREATE POLICY "affiliate_links: select manager and admin"
  ON affiliate_links FOR SELECT TO authenticated
  USING (is_manager_or_above());

CREATE POLICY "affiliate_links: insert admin only"
  ON affiliate_links FOR INSERT TO authenticated
  WITH CHECK (is_admin());

CREATE POLICY "affiliate_links: update admin only"
  ON affiliate_links FOR UPDATE TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- ---------------------------------------------------------------------------
-- lead_referrals – Policies
--
-- SELECT: can_access_lead(lead_id) — wer den Lead sieht, sieht auch dessen Referral-Quelle.
--   Employee sieht affiliate_link_id (UUID), aber keine Affiliate-Stammdaten
--   (affiliates/affiliate_links sind für Employee nicht zugänglich).
--   Dashboard-UI zeigt Employees nur "Referral-Lead: ja/nein".
--
-- INSERT: Admin only (normaler Pfad: Service Role im Public Lead Submit via RPC).
-- UPDATE: keine Policy → kein UPDATE möglich (Zuordnung ist unveränderlich).
-- DELETE: Admin only (DSGVO; CASCADE von leads deckt den Standardfall ab).
-- ---------------------------------------------------------------------------

CREATE POLICY "lead_referrals: select"
  ON lead_referrals FOR SELECT TO authenticated
  USING (can_access_lead(lead_id));

CREATE POLICY "lead_referrals: insert admin only"
  ON lead_referrals FOR INSERT TO authenticated
  WITH CHECK (is_admin());

CREATE POLICY "lead_referrals: delete admin only"
  ON lead_referrals FOR DELETE TO authenticated
  USING (is_admin());
