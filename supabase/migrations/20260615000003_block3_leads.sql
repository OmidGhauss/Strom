-- Block 3: leads-Tabelle
-- Kontaktdaten (first_name, last_name, email) sind NOT NULL:
-- Ein Lead ohne diese Felder ist im CRM nicht arbeitsfähig.
-- phone ist optional – E-Mail ist der Mindest-Kontaktkanal.
--
-- Indizes für product_type, customer_type und (status, assigned_to)
-- werden erst bei nachgewiesenen Abfrageanforderungen ergänzt.

-- ---------------------------------------------------------------------------
-- Enum: lead_score_label
-- ---------------------------------------------------------------------------

CREATE TYPE lead_score_label AS ENUM (
  'cold',
  'warm',
  'hot'
);

-- ---------------------------------------------------------------------------
-- Sequence: lead_number
-- Format: LD-YYYY-NNNNN  (z. B. LD-2026-01042)
-- Global, kein Reset pro Jahr – der Jahreszahl-Präfix ist nur Lesbarkeit.
-- ---------------------------------------------------------------------------

CREATE SEQUENCE lead_number_seq START 1000;

-- ---------------------------------------------------------------------------
-- Tabelle: leads
-- ---------------------------------------------------------------------------

CREATE TABLE leads (
  id                     uuid             PRIMARY KEY DEFAULT gen_random_uuid(),

  lead_number            text             NOT NULL UNIQUE
                                          DEFAULT 'LD-' || to_char(now(), 'YYYY') || '-'
                                            || LPAD(nextval('lead_number_seq')::text, 5, '0'),

  -- Kontaktdaten des Kunden
  first_name             text             NOT NULL,
  last_name              text             NOT NULL,
  email                  text             NOT NULL,
  phone                  text             NULL,

  -- Klassifizierung
  product_type           product_type     NOT NULL,
  customer_type          customer_type    NOT NULL,
  status                 lead_status      NOT NULL DEFAULT 'new',

  -- Lead Scoring
  score                  integer          NOT NULL DEFAULT 0,
  score_label            lead_score_label NOT NULL DEFAULT 'cold',

  -- Marketing-Attribution (first touch, direkt im Lead)
  source                 text             NULL,
  utm_source             text             NULL,
  utm_medium             text             NULL,
  utm_campaign           text             NULL,
  utm_content            text             NULL,
  utm_term               text             NULL,

  -- Zuweisung
  assigned_to            uuid             NULL,

  -- Einwilligungen – kein DEFAULT, müssen explizit gesetzt werden
  privacy_consent        boolean          NOT NULL,
  contact_consent        boolean          NOT NULL,
  data_transfer_consent  boolean          NULL,

  created_at             timestamptz      NOT NULL DEFAULT now(),
  updated_at             timestamptz      NOT NULL DEFAULT now(),

  CONSTRAINT check_score_range
    CHECK (score >= 0 AND score <= 100),

  CONSTRAINT fk_leads_assigned_to
    FOREIGN KEY (assigned_to)
    REFERENCES profiles(id)
    ON DELETE SET NULL
);

-- ---------------------------------------------------------------------------
-- Indizes
-- ---------------------------------------------------------------------------

CREATE INDEX idx_leads_status        ON leads (status);
CREATE INDEX idx_leads_assigned_to   ON leads (assigned_to);
CREATE INDEX idx_leads_created_at    ON leads (created_at DESC);

-- ---------------------------------------------------------------------------
-- Trigger: updated_at
-- ---------------------------------------------------------------------------

CREATE TRIGGER set_leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_updated_at();
