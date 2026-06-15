-- Block 7: offers und communications_log
--
-- Reihenfolge: offers vor communications_log, weil communications_log
-- offer_id → offers(id) referenziert.
--
-- offer_status enthält kein 'created' (Duplikat von 'draft').
-- communication_type enthält kein 'note' (dafür existiert lead_notes).

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

CREATE TYPE offer_status AS ENUM (
  'draft',
  'sent',
  'accepted',
  'rejected',
  'expired',
  'superseded'
);

CREATE TYPE communication_type AS ENUM (
  'email',
  'call',
  'sms',
  'system'
);

CREATE TYPE communication_direction AS ENUM (
  'inbound',
  'outbound',
  'internal'
);

CREATE TYPE communication_status AS ENUM (
  'pending',
  'success',
  'failed'
);

-- ---------------------------------------------------------------------------
-- Sequence: offer_number
-- Format: AN-YYYY-NNNNN  (z. B. AN-2026-01001)
-- Läuft global durch, kein Reset pro Jahr.
-- ---------------------------------------------------------------------------

CREATE SEQUENCE offer_number_seq START 1000;

-- ---------------------------------------------------------------------------
-- Tabelle: offers
--
-- Mehrere Angebote pro Lead erlaubt – kein UNIQUE auf lead_id.
-- parent_offer_id ermöglicht Versionsketten (V1 → V2 → V3).
-- Zyklen in Versionsketten werden durch die API verhindert, nicht per DB.
-- Angebote mit status = 'superseded' dürfen nicht mehr akzeptiert werden.
-- ---------------------------------------------------------------------------

CREATE TABLE offers (
  id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),

  lead_id          uuid          NOT NULL,
  energy_demand_id uuid          NULL,
  created_by       uuid          NULL,

  -- Versionierung: parent_offer_id zeigt auf das Vorgängerangebot
  parent_offer_id  uuid          NULL,

  -- PDF-Dokument aus der documents-Tabelle
  pdf_document_id  uuid          NULL,

  offer_number     text          NOT NULL UNIQUE
                                 DEFAULT 'AN-' || to_char(now(), 'YYYY') || '-'
                                   || LPAD(nextval('offer_number_seq')::text, 5, '0'),

  version          integer       NOT NULL DEFAULT 1,

  -- V1: Anbieter und Tarif als Freitext (eigene Tabellen kommen später)
  provider_name    text          NOT NULL,
  tariff_name      text          NOT NULL,
  energy_type      energy_type   NOT NULL,

  monthly_price    numeric(8,2)  NULL,
  annual_price     numeric(8,2)  NULL,
  estimated_savings numeric(8,2) NULL,

  status           offer_status  NOT NULL DEFAULT 'draft',
  valid_until      date          NULL,

  -- Interne Mitarbeiternotiz zum Angebot (kein Kundendokument)
  notes            text          NULL,

  created_at       timestamptz   NOT NULL DEFAULT now(),
  updated_at       timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT fk_offers_lead
    FOREIGN KEY (lead_id)
    REFERENCES leads(id)
    ON DELETE CASCADE,

  CONSTRAINT fk_offers_energy_demand
    FOREIGN KEY (energy_demand_id)
    REFERENCES energy_demands(id)
    ON DELETE SET NULL,

  CONSTRAINT fk_offers_created_by
    FOREIGN KEY (created_by)
    REFERENCES profiles(id)
    ON DELETE SET NULL,

  CONSTRAINT fk_offers_parent
    FOREIGN KEY (parent_offer_id)
    REFERENCES offers(id)
    ON DELETE SET NULL,

  CONSTRAINT fk_offers_pdf_document
    FOREIGN KEY (pdf_document_id)
    REFERENCES documents(id)
    ON DELETE SET NULL
);

CREATE INDEX idx_offers_lead_status
  ON offers (lead_id, status);

CREATE TRIGGER set_offers_updated_at
  BEFORE UPDATE ON offers
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_updated_at();

-- ---------------------------------------------------------------------------
-- Tabelle: communications_log
--
-- Unveränderliche Kontaktpunkte – aber status kann sich via Webhook ändern
-- (z. B. E-Mail-Zustellung bestätigt). Daher updated_at mit Trigger.
--
-- 'note' fehlt in communication_type: interne Notizen gehören in lead_notes.
-- offer_id ist nullable – nicht alle Kommunikationen beziehen sich auf ein Angebot.
-- ---------------------------------------------------------------------------

CREATE TABLE communications_log (
  id                  uuid                   PRIMARY KEY DEFAULT gen_random_uuid(),

  lead_id             uuid                   NOT NULL,
  offer_id            uuid                   NULL,
  created_by          uuid                   NULL,

  communication_type  communication_type     NOT NULL,
  direction           communication_direction NOT NULL,

  subject             text                   NULL,
  content_summary     text                   NULL,
  status              communication_status   NOT NULL,

  -- Externe Nachrichten-ID (z. B. Resend Message-ID für Delivery-Tracking)
  external_id         text                   NULL,

  created_at          timestamptz            NOT NULL DEFAULT now(),
  updated_at          timestamptz            NOT NULL DEFAULT now(),

  CONSTRAINT fk_cl_lead
    FOREIGN KEY (lead_id)
    REFERENCES leads(id)
    ON DELETE CASCADE,

  CONSTRAINT fk_cl_offer
    FOREIGN KEY (offer_id)
    REFERENCES offers(id)
    ON DELETE SET NULL,

  CONSTRAINT fk_cl_created_by
    FOREIGN KEY (created_by)
    REFERENCES profiles(id)
    ON DELETE SET NULL
);

CREATE INDEX idx_cl_lead_created
  ON communications_log (lead_id, created_at DESC);

CREATE TRIGGER set_communications_log_updated_at
  BEFORE UPDATE ON communications_log
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_updated_at();
