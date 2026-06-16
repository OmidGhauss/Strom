# Block 10b – RPC-Migration submit_public_lead()

Version: v1 (Planung, noch nicht freigegeben)

---

## Ziel

Eine einzige PostgreSQL-Funktion, die alle 5 Schreiboperationen für einen
öffentlichen Lead-Submit atomar in einer Transaktion ausführt.

Migrationsdatei: `supabase/migrations/20260616000012_block10b_submit_public_lead_rpc.sql`

---

## 1. Funktionssignatur

```sql
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

  -- Adresse (JSONB oder NULL; NULL = keine Adresse erfasst)
  p_address                 jsonb,

  -- Energy Demands (JSONB-Array, min. 1 Element)
  p_energy_demands          jsonb,

  -- Affiliate (NULL = kein Code; Lookup und Insert innerhalb der RPC)
  p_referral_code           text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  -- Implementierung: siehe Abschnitt 5
$$;
```

### Rückgabewert (Erfolg)

```json
{ "lead_id": "550e8400-e29b-41d4-a716-446655440000", "lead_number": "LD-2026-01042" }
```

Kein Statusfeld, kein Fehlerfeld im Rückgabewert — Fehler werden
ausschließlich via `RAISE EXCEPTION` propagiert (rollt die Transaktion zurück).

---

## 2. Parameter

### Pflichtparameter — kein DEFAULT, Aufrufer muss explizit übergeben

| Parameter           | DB-Typ           | Anmerkung                                      |
|---------------------|------------------|------------------------------------------------|
| `p_first_name`      | text             | leads.first_name NOT NULL                      |
| `p_last_name`       | text             | leads.last_name NOT NULL                       |
| `p_email`           | text             | leads.email NOT NULL                           |
| `p_customer_type`   | customer_type    | Enum: private, business, property_management, multi_location_company |
| `p_product_type`    | product_type     | Enum: electricity, gas, both                   |
| `p_privacy_consent` | boolean          | Muss true sein — andernfalls RAISE EXCEPTION   |
| `p_contact_consent` | boolean          | Darf false sein                                |
| `p_energy_demands`  | jsonb            | Darf nicht NULL oder leer sein — siehe Abschnitt 3 |

### Optionale Parameter — NULL-fähig

| Parameter                 | DB-Typ  | Anmerkung                                   |
|---------------------------|---------|---------------------------------------------|
| `p_phone`                 | text    | leads.phone NULL                            |
| `p_data_transfer_consent` | boolean | leads.data_transfer_consent NULL            |
| `p_source`                | text    | leads.source NULL; API setzt 'website_form' |
| `p_utm_source`            | text    | NULL erlaubt                                |
| `p_utm_medium`            | text    | NULL erlaubt                                |
| `p_utm_campaign`          | text    | NULL erlaubt                                |
| `p_utm_term`              | text    | NULL erlaubt                                |
| `p_utm_content`           | text    | NULL erlaubt                                |
| `p_address`               | jsonb   | NULL = keine Adresse einfügen               |
| `p_referral_code`         | text    | NULL = kein Affiliate-Lookup                |

---

## 3. JSONB-Strukturen

### p_address

NULL, wenn das Formular keine Adressdaten enthält. Andernfalls:

```json
{
  "street":           "Musterstraße",
  "house_number":     "42",
  "address_addition": null,
  "postal_code":      "10115",
  "city":             "Berlin",
  "state":            null,
  "country":          "DE"
}
```

Alle Felder optional innerhalb des Objekts — fehlende Schlüssel ergeben SQL NULL.
`country` wird mit `COALESCE(p_address->>'country', 'DE')` abgesichert.
`address_type` wird in der RPC immer auf `'delivery'` gesetzt.

### p_energy_demands

JSONB-Array. Immer mindestens 1 Element.

| product_type  | Array-Inhalt                            |
|---------------|-----------------------------------------|
| `electricity` | 1 Element: `energy_type = 'electricity'` |
| `gas`         | 1 Element: `energy_type = 'gas'`         |
| `both`        | 2 Elemente: electricity + gas           |

**Einzelnes Element:**

```json
{
  "energy_type":             "electricity",
  "annual_consumption_kwh":  3500,
  "consumption_known":       true,
  "hot_water_with_gas":      null
}
```

```json
{
  "energy_type":             "gas",
  "annual_consumption_kwh":  18000,
  "consumption_known":       false,
  "hot_water_with_gas":      true
}
```

**Feldregeln innerhalb eines Elements:**

| Feld                    | Pflicht im JSON | DB-Spalte                  | Anmerkung                                       |
|-------------------------|-----------------|----------------------------|-------------------------------------------------|
| `energy_type`           | ja              | energy_type NOT NULL       | Muss 'electricity' oder 'gas' sein              |
| `annual_consumption_kwh`| nein            | numeric(10,2) NULL         | Fehlender Schlüssel → SQL NULL                  |
| `consumption_known`     | nein            | boolean NULL               | Fehlender Schlüssel → SQL NULL                  |
| `hot_water_with_gas`    | nein            | boolean NULL               | Nur für gas sinnvoll; DB CHECK verhindert Wert bei electricity |

Die RPC schreibt nur diese 4 Felder. Alle weiteren energy_demands-Spalten
(`household_size`, `living_area_sqm`, `meter_number` etc.) bleiben NULL
und werden nicht übergeben.

**Beispiel für product_type = 'both':**

```json
[
  {
    "energy_type": "electricity",
    "annual_consumption_kwh": 3500,
    "consumption_known": true,
    "hot_water_with_gas": null
  },
  {
    "energy_type": "gas",
    "annual_consumption_kwh": 18000,
    "consumption_known": false,
    "hot_water_with_gas": true
  }
]
```

---

## 4. Validierungen innerhalb der RPC

Nur Guards, die die DB nicht selbst erzwingen kann oder die einen
sprechenden Fehlercode benötigen. Alle anderen Validierungen (Format,
Enums, Pflichtfelder) liegen in der API-Schicht (Zod).

### Guard 1: privacy_consent

```sql
IF NOT p_privacy_consent THEN
  RAISE EXCEPTION 'CONSENT_REQUIRED'
    USING ERRCODE = 'P0001',
          DETAIL  = 'privacy_consent must be true';
END IF;
```

Schützt gegen direkte RPC-Aufrufe (Scripts, Tests), die die API-Schicht umgehen.
`ERRCODE = 'P0001'` ist der Standard-ERRCODE für `RAISE EXCEPTION` in PostgreSQL.
Die API mappt diesen Code auf HTTP 422.

### Guard 2: energy_demands nicht leer

```sql
IF p_energy_demands IS NULL OR jsonb_array_length(p_energy_demands) = 0 THEN
  RAISE EXCEPTION 'ENERGY_DEMANDS_REQUIRED'
    USING ERRCODE = 'P0001',
          DETAIL  = 'p_energy_demands must contain at least one element';
END IF;
```

Verhindert einen Lead ohne jede energy_demands-Zeile.

### Guard 3: product_type ↔ energy_demands Konsistenz

Zählt die energy_type-Einträge im JSONB-Array und prüft gegen product_type.

```sql
-- v_elec_count und v_gas_count müssen im DECLARE-Block deklariert sein:
--   v_elec_count integer;
--   v_gas_count  integer;

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
```

**Warum per Zählung und nicht per Array-Position:**
Zählung nach `energy_type`-Wert ist robuster. Reihenfolge der Elemente im
Array ist irrelevant — `[gas, electricity]` und `[electricity, gas]` für
`product_type = 'both'` sind beide gültig.

**Was Guard 3 abfängt:**

| Angriff / Fehler | Guard-Verhalten |
|---|---|
| electricity + gas-Demand bei `product_type = 'electricity'` | MISMATCH |
| Zwei electricity-Demands | MISMATCH (v_elec_count = 2) |
| Kein electricity-Demand bei `product_type = 'both'` | MISMATCH |
| Nur ein Demand bei `product_type = 'both'` | MISMATCH |
| Falscher energy_type-Wert | 22P02 beim späteren Cast (Guard schlägt vorher an) |

**Verhältnis zu DB-Constraints:**
`UNIQUE (lead_id, energy_type)` auf `energy_demands` fängt doppelte
energy_type-Einträge ebenfalls ab — aber erst nach dem INSERT, mit 23505.
Guard 3 schlägt früher an und liefert einen sprechenderen Fehlercode.

### Was die RPC bewusst nicht validiert

- `p_first_name IS NOT NULL` — DB-Constraint (NOT NULL) wirft eigene Exception
- Enum-Gültigkeit für energy_type — PostgreSQL-Cast wirft `22P02` bei ungültigem Wert
- `hot_water_with_gas` nur für gas — DB-CHECK `check_hot_water_gas_only`
- Doppelte `energy_type`-Einträge — DB-UNIQUE als letztes Sicherheitsnetz (Guard 3 greift vorher)
- referral_code-Format — Zod-Schicht (RPC ruft nur `upper()` auf)

---

## 5. Ablauf der Inserts (Pseudocode)

```sql
DECLARE
  v_lead_id     uuid;
  v_lead_number text;
  v_link_id     uuid;
  v_demand      jsonb;
  v_elec_count  integer;
  v_gas_count   integer;
BEGIN
  -- Guard 1: privacy_consent
  IF NOT p_privacy_consent THEN
    RAISE EXCEPTION 'CONSENT_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  -- Guard 2: energy_demands nicht leer
  IF p_energy_demands IS NULL OR jsonb_array_length(p_energy_demands) = 0 THEN
    RAISE EXCEPTION 'ENERGY_DEMANDS_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  -- Guard 3: product_type ↔ energy_demands Konsistenz
  SELECT
    COUNT(*) FILTER (WHERE value->>'energy_type' = 'electricity'),
    COUNT(*) FILTER (WHERE value->>'energy_type' = 'gas')
  INTO v_elec_count, v_gas_count
  FROM jsonb_array_elements(p_energy_demands);

  IF p_product_type = 'electricity' AND NOT (v_elec_count = 1 AND v_gas_count = 0) THEN
    RAISE EXCEPTION 'ENERGY_DEMANDS_PRODUCT_TYPE_MISMATCH' USING ERRCODE = 'P0001';
  END IF;
  IF p_product_type = 'gas' AND NOT (v_gas_count = 1 AND v_elec_count = 0) THEN
    RAISE EXCEPTION 'ENERGY_DEMANDS_PRODUCT_TYPE_MISMATCH' USING ERRCODE = 'P0001';
  END IF;
  IF p_product_type = 'both' AND NOT (v_elec_count = 1 AND v_gas_count = 1) THEN
    RAISE EXCEPTION 'ENERGY_DEMANDS_PRODUCT_TYPE_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  -- 1. leads
  INSERT INTO leads (
    first_name, last_name, email, phone,
    product_type, customer_type,
    status, score, score_label,
    source, utm_source, utm_medium, utm_campaign, utm_term, utm_content,
    assigned_to,
    privacy_consent, contact_consent, data_transfer_consent
  )
  VALUES (
    p_first_name, p_last_name, p_email, p_phone,
    p_product_type, p_customer_type,
    'new', 0, 'cold',
    p_source, p_utm_source, p_utm_medium, p_utm_campaign, p_utm_term, p_utm_content,
    NULL,                               -- assigned_to: öffentliche Leads starten unassigned
    p_privacy_consent, p_contact_consent, p_data_transfer_consent
  )
  RETURNING id, lead_number INTO v_lead_id, v_lead_number;

  -- 2. addresses (optional)
  IF p_address IS NOT NULL THEN
    INSERT INTO addresses (
      lead_id, address_type,
      street, house_number, address_addition,
      postal_code, city, state, country
    )
    VALUES (
      v_lead_id, 'delivery',
      p_address->>'street',
      p_address->>'house_number',
      p_address->>'address_addition',
      p_address->>'postal_code',
      p_address->>'city',
      p_address->>'state',
      COALESCE(p_address->>'country', 'DE')
    );
  END IF;

  -- 3. energy_demands (1 oder 2 Zeilen)
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

  -- 4. lead_referrals (optional, silent fail bei ungültigem/inaktivem Code)
  IF p_referral_code IS NOT NULL THEN
    SELECT id INTO v_link_id
    FROM affiliate_links
    WHERE referral_code = upper(p_referral_code)
      AND status = 'active';

    IF v_link_id IS NOT NULL THEN
      INSERT INTO lead_referrals (lead_id, affiliate_link_id)
      VALUES (v_lead_id, v_link_id);
    END IF;
  END IF;

  -- 5. lead_status_history (initialer Eintrag, immer)
  INSERT INTO lead_status_history (lead_id, old_status, new_status, changed_by, reason)
  VALUES (v_lead_id, NULL, 'new', NULL, 'public_lead_submit');

  RETURN jsonb_build_object(
    'lead_id',     v_lead_id,
    'lead_number', v_lead_number
  );
END;
```

### Transaktions-Garantie

Jede RAISE EXCEPTION (Guards, DB-Constraints, Cast-Fehler) bricht die
Funktion ab und rollt alle bisherigen Writes der Transaktion zurück.
Es gibt keinen Partial-State.

---

## 6. Fehlerstrategie

### RPC-eigene Fehler (RAISE EXCEPTION)

| Exception-Message                    | Auslöser                                            | API mappt zu |
|--------------------------------------|-----------------------------------------------------|--------------|
| `CONSENT_REQUIRED`                   | `p_privacy_consent != true`                         | HTTP 422     |
| `ENERGY_DEMANDS_REQUIRED`            | `p_energy_demands` NULL oder leer                   | HTTP 422     |
| `ENERGY_DEMANDS_PRODUCT_TYPE_MISMATCH` | energy_type-Einträge passen nicht zu product_type | HTTP 422     |

### Standard-PostgreSQL-Fehler (handleSupabaseError() + neue Mappings)

| PG-ERRCODE | Bedeutung                                    | API mappt zu |
|------------|----------------------------------------------|--------------|
| `23502`    | NOT NULL-Verletzung (z. B. leerer first_name) | HTTP 422    |
| `23505`    | UNIQUE-Verletzung (uq_energy_demands_lead_type) | HTTP 409  |
| `23514`    | CHECK-Verletzung (hot_water_with_gas)         | HTTP 422     |
| `22P02`    | Ungültiger Enum-Cast (energy_type, customer_type) | HTTP 422 |
| `P0001`    | Generische RAISE EXCEPTION (Guards)           | HTTP 422     |

`handleSupabaseError()` in `src/lib/api/errors.ts` braucht Erweiterung für:
- `P0001` mit message `CONSENT_REQUIRED` → HTTP 422
- `P0001` mit message `ENERGY_DEMANDS_REQUIRED` → HTTP 422
- `P0001` mit message `ENERGY_DEMANDS_PRODUCT_TYPE_MISMATCH` → HTTP 422
- `23502` → HTTP 422 (noch nicht gemappt)

### Logging

Alle Fehler werden serverseitig in `errors.ts` mit
`console.error("[rpc:submit_public_lead]", { code, message, detail })` geloggt.
Kein Fehlerdetail wird an den Client weitergegeben.

---

## 7. GRANT / REVOKE

```sql
-- Standard-Recht PUBLIC entfernen (PostgreSQL-Default ist EXECUTE für PUBLIC)
REVOKE EXECUTE ON FUNCTION submit_public_lead(
  text, text, text, customer_type, product_type, boolean, boolean,
  text, boolean, text, text, text, text, text, text,
  jsonb, jsonb, text
) FROM PUBLIC;

-- anon und authenticated explizit ausschließen (Verteidigung in der Tiefe)
REVOKE EXECUTE ON FUNCTION submit_public_lead(
  text, text, text, customer_type, product_type, boolean, boolean,
  text, boolean, text, text, text, text, text, text,
  jsonb, jsonb, text
) FROM anon;

REVOKE EXECUTE ON FUNCTION submit_public_lead(
  text, text, text, customer_type, product_type, boolean, boolean,
  text, boolean, text, text, text, text, text, text,
  jsonb, jsonb, text
) FROM authenticated;

-- Nur service_role darf die Funktion aufrufen
GRANT EXECUTE ON FUNCTION submit_public_lead(
  text, text, text, customer_type, product_type, boolean, boolean,
  text, boolean, text, text, text, text, text, text,
  jsonb, jsonb, text
) TO service_role;
```

**Warum die vollständige Parameterliste beim GRANT/REVOKE:**
PostgreSQL identifiziert Funktionen beim Berechtigungs-Management über
Name + Parametertypen. Bei `REVOKE ... FROM PUBLIC` ohne Typen würde
PostgreSQL alle gleichnamigen Funktionen treffen. Mit Typen ist es eindeutig.

---

## 8. Sicherheitsrisiken

| Risiko | Bewertung | Mitigation |
|--------|-----------|------------|
| **Search-Path-Injection** | Hoch | `SET search_path = pg_catalog, public, pg_temp` — verhindert Umlenkung auf eigene Schemas |
| **SECURITY DEFINER ohne search_path** | Kritisch | Bereits durch SET abgedeckt — muss in jeder Revision geprüft werden |
| **anon ruft RPC direkt auf** | Hoch | REVOKE FROM PUBLIC + anon + authenticated; anon kann Funktion nicht erreichen |
| **energy_type Cast-Injection** | Niedrig | PostgreSQL-Cast `::energy_type` ist keine SQL-Injection; ungültige Werte werfen 22P02 |
| **JSONB als Code ausgeführt** | Nicht möglich | JSONB-Werte werden nur als Daten gelesen, nie als SQL interpretiert |
| **referral_code Enumeration** | Mittel | Silent fail — Client erfährt nicht ob Code existiert |
| **Partial-Write bei Serverabsturz** | Keins | Atomare Transaktion — entweder alles oder nichts |
| **Service Role Key Leak** | Kritisch | Außerhalb RPC-Scope; gesichert durch `import "server-only"` in admin.ts |

---

## 9. Tests und Prüfabfragen nach Migration

Diese Abfragen werden direkt nach Migration im Supabase SQL-Editor oder
per `psql` ausgeführt, um die korrekte Installation zu verifizieren.

### 9.1 Funktion existiert und ist SECURITY DEFINER

```sql
SELECT proname, prosecdef, proconfig
FROM pg_proc
WHERE proname = 'submit_public_lead';
-- Erwartung: prosecdef = true, proconfig enthält 'search_path=pg_catalog,public,pg_temp'
```

### 9.2 Berechtigungen korrekt gesetzt

```sql
SELECT grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_name = 'submit_public_lead'
  AND routine_schema = 'public';
-- Erwartung: nur service_role mit EXECUTE; PUBLIC, anon, authenticated nicht vorhanden
```

### 9.3 Happy Path — electricity, keine Adresse, kein Referral

```sql
SELECT submit_public_lead(
  'Max', 'Mustermann', 'max@example.de',
  'private', 'electricity', true, true,
  NULL, NULL, 'website_form', NULL, NULL, NULL, NULL, NULL,
  NULL,
  '[{"energy_type":"electricity","annual_consumption_kwh":3500,"consumption_known":true,"hot_water_with_gas":null}]'::jsonb,
  NULL
);
-- Erwartung: { "lead_id": "...", "lead_number": "LD-2026-..." }
```

### 9.4 Prüfung aller 5 Writes

```sql
-- Nach dem Happy Path aus 9.3: lead_id aus dem Rückgabewert eintragen
DO $$
DECLARE v_id uuid := '<lead_id aus 9.3>';
BEGIN
  ASSERT (SELECT COUNT(*) FROM leads WHERE id = v_id) = 1,              'leads fehlt';
  ASSERT (SELECT COUNT(*) FROM energy_demands WHERE lead_id = v_id) = 1, 'energy_demand fehlt';
  ASSERT (SELECT COUNT(*) FROM lead_status_history WHERE lead_id = v_id
            AND old_status IS NULL AND new_status = 'new'
            AND reason = 'public_lead_submit') = 1,                      'status_history fehlt';
  RAISE NOTICE 'Alle Prüfungen bestanden';
END $$;
```

### 9.5 Happy Path — both, mit Adresse

```sql
SELECT submit_public_lead(
  'Anna', 'Muster', 'anna@example.de',
  'private', 'both', true, false,
  '+49123456789', NULL, NULL, NULL, NULL, NULL, NULL, NULL,
  '{"street":"Hauptstr.","house_number":"1","postal_code":"80331","city":"München","country":"DE"}'::jsonb,
  '[
    {"energy_type":"electricity","annual_consumption_kwh":4000,"consumption_known":true,"hot_water_with_gas":null},
    {"energy_type":"gas","annual_consumption_kwh":20000,"consumption_known":false,"hot_water_with_gas":true}
  ]'::jsonb,
  NULL
);
-- Erwartung: 2 energy_demands-Zeilen, 1 addresses-Zeile
```

### 9.6 Guard: privacy_consent = false

```sql
SELECT submit_public_lead(
  'Bad', 'Actor', 'bad@example.de',
  'private', 'electricity', false, true,
  NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
  NULL,
  '[{"energy_type":"electricity"}]'::jsonb,
  NULL
);
-- Erwartung: ERROR: CONSENT_REQUIRED
```

### 9.7 Ungültiger referral_code — Lead trotzdem erstellt

```sql
SELECT submit_public_lead(
  'Test', 'Referral', 'ref@example.de',
  'private', 'gas', true, true,
  NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
  NULL,
  '[{"energy_type":"gas","hot_water_with_gas":false}]'::jsonb,
  'EXISTIERT-NICHT'
);
-- Erwartung: Lead wird erstellt, keine lead_referrals-Zeile
```

### 9.8 Gültiger referral_code — lead_referrals erstellt

```sql
-- Voraussetzung: aktive affiliate_link mit referral_code 'TESTCODE' vorhanden
SELECT submit_public_lead(
  'Ref', 'User', 'refuser@example.de',
  'private', 'electricity', true, true,
  NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
  NULL,
  '[{"energy_type":"electricity","annual_consumption_kwh":3000}]'::jsonb,
  'TESTCODE'
);
-- Erwartung: 1 lead_referrals-Zeile vorhanden
```

### 9.9 Guard 3: electricity-Demand bei product_type = 'gas'

```sql
SELECT submit_public_lead(
  'Wrong', 'Type', 'wrongtype@example.de',
  'private', 'gas', true, true,
  NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
  NULL,
  '[{"energy_type":"electricity","annual_consumption_kwh":3000}]'::jsonb,
  NULL
);
-- Erwartung: ERROR: ENERGY_DEMANDS_PRODUCT_TYPE_MISMATCH
```

### 9.10 Guard 3: fehlender gas-Demand bei product_type = 'both'

```sql
SELECT submit_public_lead(
  'Missing', 'Gas', 'missinggas@example.de',
  'private', 'both', true, true,
  NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
  NULL,
  '[{"energy_type":"electricity","annual_consumption_kwh":3000}]'::jsonb,
  NULL
);
-- Erwartung: ERROR: ENERGY_DEMANDS_PRODUCT_TYPE_MISMATCH
```

### 9.11 Guard 3: zwei electricity-Demands bei product_type = 'electricity'

```sql
SELECT submit_public_lead(
  'Double', 'Elec', 'doubleelec@example.de',
  'private', 'electricity', true, true,
  NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
  NULL,
  '[{"energy_type":"electricity"},{"energy_type":"electricity"}]'::jsonb,
  NULL
);
-- Erwartung: ERROR: ENERGY_DEMANDS_PRODUCT_TYPE_MISMATCH (v_elec_count = 2)
```

### 9.12 Guard 3: korrekter 'both'-Submit (Reihenfolge umgekehrt)

```sql
SELECT submit_public_lead(
  'Both', 'Reversed', 'bothrev@example.de',
  'private', 'both', true, true,
  NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
  NULL,
  '[{"energy_type":"gas","hot_water_with_gas":false},{"energy_type":"electricity","annual_consumption_kwh":3000}]'::jsonb,
  NULL
);
-- Erwartung: Erfolg — Reihenfolge gas/electricity ist irrelevant für Guard 3
```

### 9.14 DB-Constraint: hot_water_with_gas bei electricity

```sql
SELECT submit_public_lead(
  'Con', 'Straint', 'constraint@example.de',
  'private', 'electricity', true, true,
  NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
  NULL,
  '[{"energy_type":"electricity","hot_water_with_gas":true}]'::jsonb,
  NULL
);
-- Erwartung: ERROR 23514 (check_hot_water_gas_only)
```

### 9.15 Cleanup nach Tests

```sql
DELETE FROM leads WHERE email LIKE '%@example.de';
-- Cascaded: energy_demands, addresses, lead_referrals, lead_status_history werden
-- automatisch mitgelöscht (ON DELETE CASCADE).
```

---

## 10. Was bewusst nicht in Block 10b gehört

| Thema | Block |
|-------|-------|
| API Route (`POST /api/public/leads`) | Block 10c |
| Zod-Schema (`PublicLeadSchema`) | Block 10c |
| Turnstile Captcha | Block 10c |
| Rate Limiting (Upstash Redis) | Block 10c |
| `handleSupabaseError()` Erweiterung | Block 10c |
| Weitere energy_demands-Felder (household_size, meter_number etc.) | Späterer Block |
| Lead-Deduplication | Bewusst nicht in V1 |
| E-Mail-Bestätigung | Bewusst nicht in V1 |
| Lead-Zuweisung (assigned_to) | Manuelle CRM-Operation |
| Frontend-Formular | Eigener Block |
| Full Test Suite | Block 10T (nach 10c) |
| Trigger für lead_status_history bei internen Statuswechseln | Eigener Block |

---

## Zusammenfassung

| Punkt | Entscheidung |
|-------|--------------|
| Migrationsdatei | `20260616000012_block10b_submit_public_lead_rpc.sql` |
| Sprache | `LANGUAGE plpgsql` |
| Sicherheitskontext | `SECURITY DEFINER` + `SET search_path = pg_catalog, public, pg_temp` |
| Berechtigungen | REVOKE PUBLIC/anon/authenticated, GRANT service_role |
| p_address | JSONB oder NULL; address_type = 'delivery' hardcoded |
| p_energy_demands | JSONB-Array, min. 1 Element, Guard 2 + Guard 3 in der Funktion |
| referral_code Lookup | innerhalb der RPC, silent fail bei ungültig/inaktiv |
| Guards in der RPC | 3: CONSENT_REQUIRED, ENERGY_DEMANDS_REQUIRED, ENERGY_DEMANDS_PRODUCT_TYPE_MISMATCH |
| lead_status_history | immer, reason = 'public_lead_submit', old_status NULL |
| Rückgabe | `{ lead_id, lead_number }` als JSONB |
| Atomarität | vollständig — RAISE EXCEPTION rollt alle Writes zurück |
