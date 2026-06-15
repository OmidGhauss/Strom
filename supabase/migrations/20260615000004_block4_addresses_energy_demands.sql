-- Block 4: addresses und energy_demands
--
-- Beide Tabellen sind existenziell vom Lead abhängig und verwenden
-- ON DELETE CASCADE (nicht RESTRICT wie profiles).
--
-- energy_type ist ein eigener Enum (electricity, gas) – kein Wiederverwerden von
-- product_type, weil jede energy_demands-Zeile exakt eine Energieart beschreibt.
-- 'both' wäre in energy_demands fachlich falsch; das wird durch den Enum verhindert.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

CREATE TYPE address_type AS ENUM (
  'delivery',
  'billing',
  'contact'
);

CREATE TYPE energy_type AS ENUM (
  'electricity',
  'gas'
);

-- ---------------------------------------------------------------------------
-- Tabelle: addresses
--
-- Mehrere Adressen pro Lead möglich (Lieferadresse, Rechnungsadresse,
-- Kontaktadresse). UNIQUE (lead_id, address_type) verhindert Duplikate
-- desselben Typs pro Lead.
--
-- Für V1 liefert das Formular genau eine Adresse (address_type = 'delivery').
-- Billing und Contact werden ggf. manuell durch Mitarbeiter ergänzt.
--
-- country hat DEFAULT 'DE' – dieses Portal ist ausschließlich für den
-- deutschen Energiemarkt.
-- ---------------------------------------------------------------------------

CREATE TABLE addresses (
  id                uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id           uuid         NOT NULL,
  address_type      address_type NOT NULL,

  street            text         NULL,
  house_number      text         NULL,
  address_addition  text         NULL,
  postal_code       text         NULL,
  city              text         NULL,
  state             text         NULL,
  country           text         NULL DEFAULT 'DE',

  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now(),

  CONSTRAINT fk_addresses_lead
    FOREIGN KEY (lead_id)
    REFERENCES leads(id)
    ON DELETE CASCADE,

  CONSTRAINT uq_addresses_lead_type
    UNIQUE (lead_id, address_type)
);

CREATE TRIGGER set_addresses_updated_at
  BEFORE UPDATE ON addresses
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_updated_at();

-- ---------------------------------------------------------------------------
-- Tabelle: energy_demands
--
-- Ein Lead kann maximal einen Strom- und einen Gas-Bedarf haben.
-- UNIQUE (lead_id, energy_type) erzwingt das auf Datenbankebene.
--
-- Für product_type = 'both' legt die Anwendung zwei Zeilen an:
--   (lead_id, 'electricity', ...)
--   (lead_id, 'gas', ...)
--
-- hot_water_with_gas ist Gas-spezifisch und darf nur für Gas-Zeilen gesetzt
-- sein. Der CHECK-Constraint verhindert fachlich falsche Daten.
--
-- meter_number und market_location_id sind optional – sie kommen nicht aus
-- dem Formular, sondern werden später aus hochgeladenen Rechnungen extrahiert.
-- ---------------------------------------------------------------------------

CREATE TABLE energy_demands (
  id                         uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id                    uuid         NOT NULL,
  energy_type                energy_type  NOT NULL,

  annual_consumption_kwh     numeric(10,2) NULL,
  consumption_known          boolean       NULL,
  household_size             integer       NULL,
  living_area_sqm            numeric(8,2)  NULL,
  heating_type               text          NULL,
  hot_water_with_gas         boolean       NULL,
  current_provider           text          NULL,
  current_tariff             text          NULL,
  monthly_payment            numeric(8,2)  NULL,
  contract_end_date          date          NULL,
  cancellation_period_known  boolean       NULL,
  price_guarantee            boolean       NULL,
  meter_number               text          NULL,
  market_location_id         text          NULL,

  created_at                 timestamptz   NOT NULL DEFAULT now(),
  updated_at                 timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT fk_energy_demands_lead
    FOREIGN KEY (lead_id)
    REFERENCES leads(id)
    ON DELETE CASCADE,

  CONSTRAINT uq_energy_demands_lead_type
    UNIQUE (lead_id, energy_type),

  CONSTRAINT check_hot_water_gas_only
    CHECK (hot_water_with_gas IS NULL OR energy_type = 'gas')
);

CREATE TRIGGER set_energy_demands_updated_at
  BEFORE UPDATE ON energy_demands
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_updated_at();
