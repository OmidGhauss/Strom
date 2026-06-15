-- Block 2: Enums und Basistabellen
-- profiles.auth_user_id verwendet ON DELETE RESTRICT (nicht CASCADE):
-- Ein Auth-Account darf nicht gelöscht werden, solange ein Profil existiert.
-- Mitarbeiter werden stattdessen per is_active = false deaktiviert.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

CREATE TYPE user_role AS ENUM (
  'admin',
  'manager',
  'employee'
);

CREATE TYPE lead_status AS ENUM (
  'new',
  'in_review',
  'question_open',
  'offer_created',
  'offer_sent',
  'interested',
  'contract_prepared',
  'contract_sent',
  'completed',
  'rejected',
  'unreachable',
  'follow_up',
  'disqualified',
  'lost'
);

CREATE TYPE product_type AS ENUM (
  'electricity',
  'gas',
  'both',
  'business'
);

CREATE TYPE customer_type AS ENUM (
  'private',
  'business',
  'property_management',
  'multi_location_company'
);

-- ---------------------------------------------------------------------------
-- updated_at Trigger-Funktion (wiederverwendbar für alle Tabellen)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

CREATE TABLE profiles (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id  uuid        NOT NULL UNIQUE,

  full_name     text        NOT NULL,

  -- Denormalisiert aus auth.users.email.
  -- Quelle der Wahrheit ist auth.users.email, nicht dieses Feld.
  -- Bei manuellen Auth-Änderungen kann dieses Feld veralten.
  email         text        NOT NULL,

  role          user_role   NOT NULL DEFAULT 'employee',
  is_active     boolean     NOT NULL DEFAULT true,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fk_profiles_auth_user
    FOREIGN KEY (auth_user_id)
    REFERENCES auth.users(id)
    ON DELETE RESTRICT
);

CREATE TRIGGER set_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_updated_at();
