# Block 10 – Public Lead Submit via RPC

Version: v1 (Architekturplanung, noch nicht freigegeben)

---

## Ziel

`POST /api/public/leads` — ein einziger öffentlicher Endpoint, der ohne
Authentifizierung erreichbar ist und einen vollständigen Lead atomar in
der Datenbank anlegt.

Atomar bedeutet: alle Schreiboperationen erfolgen in einer einzigen
PostgreSQL-Transaktion. Bei Fehler wird alles zurückgerollt.

Die RPC-Funktion schreibt genau diese 5 Operationen in einer Transaktion:

1. `leads` — Hauptdatensatz
2. `addresses` — Lieferadresse (nur wenn Adressdaten vorhanden)
3. `energy_demands` — 1 oder 2 Zeilen je nach product_type
4. `lead_referrals` — nur wenn referral_code auf aktiven Link auflöst
5. `lead_status_history` — initialer Eintrag (old_status = NULL, new_status = 'new')

---

## Vorbedingungen — Korrekturen in `src/types/database.ts`

Beim Abgleich der Supabase-Migrationen mit `database.ts` wurden drei Abweichungen
entdeckt. Diese müssen vor der Block-10-Implementierung korrigiert werden (als
erster Schritt innerhalb von Block 10, kein separater Block).

### addresses — falsche / fehlende Felder

| database.ts (aktuell, falsch) | Migration (korrekt)     |
|-------------------------------|-------------------------|
| `zip_code`                    | `postal_code`           |
| — (fehlt)                     | `address_addition`      |
| — (fehlt)                     | `state`                 |

### leads — fehlende Felder

| Feld                  | Typ              | Anmerkung                       |
|-----------------------|------------------|---------------------------------|
| `source`              | `string \| null` | Marketing-Quelle, z. B. 'website_form' |
| `data_transfer_consent` | `boolean \| null` | Dritter Zustimmungstyp         |

### energy_demands — stark unvollständig

Aktuell hat `database.ts` nur: `annual_consumption_kwh`, `meter_number`, `hot_water_with_gas`.

Tatsächliche DB-Felder (alle nullable):
`consumption_known`, `household_size`, `living_area_sqm`, `heating_type`,
`current_provider`, `current_tariff`, `monthly_payment`, `contract_end_date`,
`cancellation_period_known`, `price_guarantee`, `market_location_id`

→ Alle drei Typen müssen vor der RPC-Implementierung in `database.ts` angepasst werden.

---

## 1. RPC-Funktion

### Name

```sql
submit_public_lead(...)
```

### Begründung RPC statt sequentieller JS-Calls

Sequentielle Supabase-JS-Calls bieten keine Transaktionsgarantie.
Ein Netzwerkfehler nach `leads`-INSERT aber vor `energy_demands`-INSERT
hinterlässt einen inkonsistenten Lead im CRM.

Die RPC-Funktion läuft als eine einzige PostgreSQL-Transaktion —
entweder alles oder nichts.

### Sicherheitskontext

```sql
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
```

SECURITY DEFINER: Funktion läuft als Funktionsowner (postgres), bypassed RLS.
`SET search_path`: verhindert Search-Path-Injection-Angriffe.

Berechtigungen:

```sql
REVOKE EXECUTE ON FUNCTION submit_public_lead FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION submit_public_lead FROM anon;
REVOKE EXECUTE ON FUNCTION submit_public_lead FROM authenticated;
GRANT  EXECUTE ON FUNCTION submit_public_lead TO service_role;
```

Nur Service Role (API-Schicht) kann die Funktion aufrufen.
Direkter Aufruf vom Browser (anon/authenticated) ist nicht möglich.

---

## 2. RPC-Parameter (vollständige Signatur)

```sql
CREATE OR REPLACE FUNCTION submit_public_lead(
  -- Lead — Pflichtfelder
  p_first_name              text,
  p_last_name               text,
  p_email                   text,
  p_phone                   text,            -- NULL erlaubt
  p_customer_type           customer_type,
  p_product_type            product_type,
  p_privacy_consent         boolean,         -- muss true sein
  p_contact_consent         boolean,
  p_data_transfer_consent   boolean,         -- NULL erlaubt

  -- Marketing
  p_source                  text,            -- z. B. 'website_form'
  p_utm_source              text,
  p_utm_medium              text,
  p_utm_campaign            text,
  p_utm_term                text,
  p_utm_content             text,

  -- Lieferadresse (alle Felder NULL-fähig; Adresse wird nur eingefügt wenn
  -- mindestens postal_code oder city vorhanden)
  p_street                  text,
  p_house_number            text,
  p_address_addition        text,
  p_postal_code             text,
  p_city                    text,

  -- Energy demands als JSONB-Array (Struktur: siehe Abschnitt 3)
  p_energy_demands          jsonb,

  -- Affiliate (optional; Lookup und Insert erfolgen innerhalb der RPC)
  p_referral_code           text             -- NULL wenn kein Code
)
RETURNS jsonb
```

### Rückgabewert (Erfolg)

```json
{ "lead_id": "uuid", "lead_number": "LD-2026-01042" }
```

### Rückgabewert (Fehler)

PostgreSQL RAISE EXCEPTION — der aufrufende Code (API Route) fängt dies ab.
Keine Error-Payload im RETURNS-Wert — Fehler werden als Exceptions propagiert.

---

## 3. product_type → energy_demands

### Datenstruktur im JSONB-Array

Jedes Element repräsentiert genau eine Energieart:

```json
[
  {
    "energy_type": "electricity",
    "annual_consumption_kwh": 3500,
    "consumption_known": true,
    "hot_water_with_gas": null
  }
]
```

Für `product_type = 'both'` sendet die API zwei Elemente:

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

### Mapping product_type → erwartete Array-Elemente

| product_type  | Elemente im Array                       |
|---------------|-----------------------------------------|
| electricity   | genau 1 × `energy_type = 'electricity'` |
| gas           | genau 1 × `energy_type = 'gas'`         |
| both          | 1 × electricity + 1 × gas              |

Dieses Mapping wird **auf API-Schicht (Zod superRefine)** geprüft.
Die RPC-Funktion iteriert einfach über alle Elemente und insertet sie.

### DB-Constraint als letztes Sicherheitsnetz

`UNIQUE (lead_id, energy_type)` auf `energy_demands` verhindert doppelte
Einträge desselben Typs auch wenn die API-Validierung umgangen wird.

`CHECK (hot_water_with_gas IS NULL OR energy_type = 'gas')` stellt sicher,
dass hot_water_with_gas nur für Gas-Zeilen gesetzt ist.

### Felder V1 — was das Formular sendet

V1 des öffentlichen Formulars erfasst:

- `annual_consumption_kwh` (optional, Zahl)
- `consumption_known` (optional, boolean)
- `hot_water_with_gas` (optional, boolean — nur für Gas sinnvoll)

Alle weiteren energy_demands-Felder (`meter_number`, `current_provider`,
`market_location_id` etc.) werden später manuell oder per OCR ergänzt.
Die RPC insertet diese Felder nicht — sie bleiben NULL.

### Transformation im API-Layer

Das öffentliche Formular sendet keine flache Array-Struktur, sondern
strukturierte Objekte nach Energieart. Die API-Route transformiert
vor dem RPC-Aufruf:

```typescript
// Formular-Input (nach Zod-Validierung):
// { electricity: { annual_consumption_kwh: 3500, ... } }
// { gas: { hot_water_with_gas: true, ... } }

// Transformation → JSONB-Array für RPC:
const energyDemands = buildEnergyDemands(body.product_type, body.electricity, body.gas);
```

---

## 4. Referral Code — Verarbeitung innerhalb der RPC

Der Lookup findet **innerhalb der RPC-Funktion** statt (nicht in der API Route).

### Begründung

- Atomarität: Lookup und Insert laufen in derselben Transaktion
- Kein extra Roundtrip zur Datenbank von der API aus
- Race condition ausgeschlossen: zwischen Lookup und Insert kann der Link
  nicht deaktiviert werden (gleiche Transaktion)

### Verhalten

```
p_referral_code = NULL        → kein Referral, lead_referrals wird nicht eingefügt
p_referral_code = 'INVALID'   → Lookup liefert keine Zeile → kein Referral, KEIN Fehler
p_referral_code = 'INACTIVE'  → status = 'inactive' → kein Referral, KEIN Fehler
p_referral_code = 'SOLAR2026' → aktiver Link gefunden → lead_referrals wird eingefügt
```

Silentes Ignorieren ungültiger/inaktiver Codes verhindert Code-Enumeration:
Der Client erfährt nicht, ob ein Code existiert.

### Lookup-Logik im RPC (Pseudocode)

```sql
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
```

Die API normalisiert den Code bereits mit `.toUpperCase()` (Zod-Transform).
Das `upper()` im SQL ist ein zusätzliches Sicherheitsnetz.

---

## 5. lead_status_history in der RPC

### Hintergrund

Es existiert kein DB-Trigger, der beim INSERT in `leads` automatisch einen
`lead_status_history`-Eintrag anlegt. Damit das CRM eine vollständige
Statushistorie hat, muss die RPC-Funktion diesen initialen Eintrag
selbst in derselben Transaktion erzeugen.

### Wert des Eintrags

| Feld         | Wert                  | Begründung                                     |
|--------------|-----------------------|------------------------------------------------|
| `lead_id`    | neu erstellter Lead   | FK zu leads                                    |
| `old_status` | NULL                  | kein Vorgängerstatus bei Ersterstellung        |
| `new_status` | `'new'`               | Initial-Status für alle öffentlichen Leads     |
| `changed_by` | NULL                  | kein authentifizierter User — öffentliches Formular |
| `reason`     | `'public_lead_submit'` | maschinenlesbarer Auslöser für Reports        |

### SQL im RPC (Pseudocode)

```sql
INSERT INTO lead_status_history (lead_id, old_status, new_status, changed_by, reason)
VALUES (v_lead_id, NULL, 'new', NULL, 'public_lead_submit');
```

### Warum nicht als Trigger

- Trigger würde jeden `leads`-INSERT betreffen, auch interne Admin-Operationen
- Jeder Schreibpfad hat eigene Statuslogik und reason-Werte
- Expliziter Insert in der RPC ist transparenter und leichter zu testen
- Keine Trigger-Lösung in Block 10 — bewusste Entscheidung

---

## 6. Consent-Validierung

Zweistufig: API-Schicht + RPC-Guard.

### Stufe 1: Zod-Schicht (API)

```typescript
privacy_consent: z.literal(true)
// z.literal(true) lehnt false, null, undefined ab
// HTTP 422 mit message "Datenschutzzustimmung erforderlich"
```

### Stufe 2: RPC-Guard (DB)

```sql
IF NOT p_privacy_consent THEN
  RAISE EXCEPTION 'CONSENT_REQUIRED'
    USING ERRCODE = 'P0001', DETAIL = 'privacy_consent must be true';
END IF;
```

Schützt gegen direkte RPC-Aufrufe (z. B. interne Scripts oder Tests),
die die API-Schicht umgehen.

### contact_consent und data_transfer_consent

- `contact_consent`: boolean, Pflichtfeld, darf false sein
- `data_transfer_consent`: boolean, optional (NULL erlaubt), kein Zustimmungszwang

---

## 7. lead_number Erzeugung

Vollständig durch die Datenbank — kein Application-Code nötig.

```sql
-- Aus der leads-Migration (Block 3):
lead_number text NOT NULL UNIQUE
  DEFAULT 'LD-' || to_char(now(), 'YYYY') || '-'
             || LPAD(nextval('lead_number_seq')::text, 5, '0')
```

Beispiel: `LD-2026-01042`

Die RPC-Funktion liest den erzeugten Wert via `RETURNING`:

```sql
INSERT INTO leads (...) VALUES (...)
RETURNING id, lead_number INTO v_lead_id, v_lead_number;
```

---

## 8. Fehlerbehandlung

### RPC-eigene Fehler (RAISE EXCEPTION)

| Fehlercode      | Auslöser                              | HTTP-Status   |
|-----------------|---------------------------------------|---------------|
| `CONSENT_REQUIRED` | privacy_consent = false            | 422           |

### Standard-PostgreSQL-Fehler (werden von handleSupabaseError() gemappt)

| PG-Code | Bedeutung                        | HTTP-Status |
|---------|----------------------------------|-------------|
| `23505` | UNIQUE-Verletzung (Duplikat)     | 409         |
| `23503` | FK-Verletzung                    | 409         |
| `23514` | CHECK-Verletzung                 | 422         |
| `42501` | Berechtigungsfehler              | 403         |

### `handleSupabaseError()` Erweiterung (Block 10)

Bestehende Funktion in `src/lib/api/errors.ts` muss um RPC-Exception-Codes
erweitert werden:

```typescript
if (error.message === 'CONSENT_REQUIRED') {
  return ApiErrors.unprocessable("Datenschutzzustimmung erforderlich");
}
```

### Fehler-Logging

`console.error("[rpc:submit_public_lead]", { code, message, hint })`
Wie bestehende `console.error("[supabase]", ...)` in errors.ts — serverseitig,
nie an Client weitergegeben.

---

## 9. API Route

### Endpunkt

```
POST /api/public/leads
```

### Authentifizierung

Keine. `/api/public/*` ist in `proxy.ts` explizit ausgenommen.
Die Route verwendet den Admin-Client (`src/lib/supabase/admin.ts`).

### Ablauf

```
1. Rate Limit prüfen (Upstash Redis, nach IP)
     → bei Überschreitung: 429 Too Many Requests
2. Request Body parsen (JSON)
     → bei Parsefehler: 400 Bad Request
3. Zod-Validierung (PublicLeadSchema)
     → bei Fehler: 422 Unprocessable Entity + Fehlerdetails
4. Turnstile-Captcha verifizieren
     → bei Fehler: 422 Unprocessable Entity
5. energy_demands-Array aus body.electricity / body.gas aufbauen
6. adminClient.rpc('submit_public_lead', params) aufrufen
     → bei DB-Fehler: handleSupabaseError() → passender HTTP-Status
7. 201 Created + { data: { lead_id, lead_number } }
```

### Response

```json
HTTP 201 Created
{
  "data": {
    "lead_id": "550e8400-e29b-41d4-a716-446655440000",
    "lead_number": "LD-2026-01042"
  }
}
```

Kein Lead-Detail im Response — minimale Angriffsfläche für öffentlichen Endpoint.

### Migrationsdatei

```
supabase/migrations/20260616000012_block10_submit_public_lead_rpc.sql
```

---

## 10. Zod-Validierungsschema

### Struktur

```typescript
// src/lib/validation/public-lead.ts

const ElectricityInput = z.object({
  annual_consumption_kwh: z.number().positive().max(999_999_99).nullable().optional(),
  consumption_known: z.boolean().nullable().optional(),
}).optional();

const GasInput = z.object({
  annual_consumption_kwh: z.number().positive().max(999_999_99).nullable().optional(),
  consumption_known: z.boolean().nullable().optional(),
  hot_water_with_gas: z.boolean().nullable().optional(),
}).optional();

export const PublicLeadSchema = z.object({
  // Kontakt
  first_name:   z.string().trim().min(1).max(100),
  last_name:    z.string().trim().min(1).max(100),
  email:        z.string().trim().toLowerCase().email().max(255),
  phone:        z.string().trim().max(50).optional(),

  // Klassifizierung
  customer_type: z.enum(["private", "business", "property_management", "multi_location_company"]),
  product_type:  z.enum(["electricity", "gas", "both"]),

  // Adresse (komplett optional — kein Pflichtfeld auf Formularebene)
  address: z.object({
    street:           z.string().trim().max(255).optional(),
    house_number:     z.string().trim().max(20).optional(),
    address_addition: z.string().trim().max(100).optional(),
    postal_code:      z.string().trim().max(10).optional(),
    city:             z.string().trim().max(100).optional(),
  }).optional(),

  // Energy demands — getrennte Objekte, API baut Array daraus
  electricity: ElectricityInput,
  gas: GasInput,

  // Einwilligungen
  privacy_consent:       z.literal(true),
  contact_consent:       z.boolean(),
  data_transfer_consent: z.boolean().optional(),

  // Marketing
  source:       z.string().trim().max(100).optional(),
  utm_source:   z.string().trim().max(255).optional(),
  utm_medium:   z.string().trim().max(255).optional(),
  utm_campaign: z.string().trim().max(255).optional(),
  utm_term:     z.string().trim().max(255).optional(),
  utm_content:  z.string().trim().max(255).optional(),

  // Captcha
  turnstile_token: z.string().min(1),

  // Affiliate
  referral_code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{3,32}$/).optional(),

}).superRefine((data, ctx) => {
  // product_type ↔ energy inputs Konsistenz
  if ((data.product_type === 'electricity' || data.product_type === 'both') && !data.electricity) {
    ctx.addIssue({ code: 'custom', path: ['electricity'],
      message: 'Stromverbrauch erforderlich für gewählten Produkttyp' });
  }
  if ((data.product_type === 'gas' || data.product_type === 'both') && !data.gas) {
    ctx.addIssue({ code: 'custom', path: ['gas'],
      message: 'Gasverbrauch erforderlich für gewählten Produkttyp' });
  }
});
```

### Validierungsregeln (Zusammenfassung)

| Feld                  | Regel                                          |
|-----------------------|------------------------------------------------|
| `first_name`          | min 1, max 100, trim                           |
| `last_name`           | min 1, max 100, trim                           |
| `email`               | gültige E-Mail, max 255, toLowerCase           |
| `phone`               | max 50, optional                               |
| `customer_type`       | enum-Wert                                      |
| `product_type`        | enum-Wert                                      |
| `privacy_consent`     | `z.literal(true)` — false/null wird abgelehnt  |
| `contact_consent`     | boolean, Pflicht                               |
| `data_transfer_consent` | boolean, optional                            |
| `referral_code`       | trim + toUpperCase + Regex `^[A-Z0-9-]{3,32}$` |
| `turnstile_token`     | string min 1 (Captcha-Token)                   |
| energy/product match  | superRefine: electricity/gas-Objekte zu product_type passend |

---

## 11. Rate Limiting und Captcha

### Warum beide nötig

Rate Limiting schützt vor wiederholten Submits (Bots, Scraper).
Captcha schützt vor automatisierten Formulareinsendungen.
Beide Schichten sind unabhängig und komplementär.

### Rate Limiting: Upstash Redis + @upstash/ratelimit

```
Paket:       @upstash/ratelimit + @upstash/redis
Algorithmus: Fixed Window
Limit:       5 Requests pro 10 Minuten pro IP-Adresse
Identifier:  X-Forwarded-For Header (Vercel-Standard)
Response:    429 Too Many Requests + Retry-After Header
```

Upstash Redis läuft serverless (kein persistenter Connection-Pool nötig),
kompatibel mit Next.js Edge und Node.js Runtime.

Neue Umgebungsvariablen (`.env.local.example`):

```
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

### Captcha: Cloudflare Turnstile

```
Anbieter:  Cloudflare Turnstile
Stufe:     Kostenlos (Free Tier), DSGVO-konform
Token:     turnstile_token im Request Body
Verify:    API Route → POST https://challenges.cloudflare.com/turnstile/v0/siteverify
```

Die API Route verifiziert den Token gegen die Cloudflare-API bevor
irgendeine DB-Operation ausgeführt wird:

```typescript
async function verifyTurnstile(token: string, ip: string): Promise<boolean> {
  if (!process.env.TURNSTILE_SECRET_KEY) return true; // Dev-Modus
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: new URLSearchParams({
      secret: process.env.TURNSTILE_SECRET_KEY,
      response: token,
      remoteip: ip,
    }),
  });
  const data = await res.json();
  return data.success === true;
}
```

`TURNSTILE_SECRET_KEY` nicht gesetzt → Captcha wird in Dev/Test übersprungen.

Neue Umgebungsvariablen:

```
TURNSTILE_SECRET_KEY=
NEXT_PUBLIC_TURNSTILE_SITE_KEY=   # für Frontend (kein Geheimnis)
```

### Reihenfolge in der Route

Rate Limit → Zod → Captcha → DB (RPC)

Captcha nach Zod, weil Zod billiger ist als ein externer API-Call.

---

## 12. RLS und Service Role

### Warum kein User-aware Client

`/api/public/leads` erfordert keine Authentifizierung.
Der User-aware Client (`server.ts`) kann keine Session ohne eingeloggten
User aufbauen — RLS würde alle Writes blockieren.

→ Ausschließlich Admin-Client (`admin.ts`, Service Role Key) verwenden.

### Service Role Key Garantien

- Bypasses alle RLS-Policies vollständig
- Nur in API Routes, nie im Browser
- Bereits in `src/lib/supabase/admin.ts` mit `import "server-only"` gesichert
- Service Role hat EXECUTE auf `submit_public_lead` (via GRANT)

### RLS-Policies für lead_referrals INSERT

Die RLS-Policy `lead_referrals: insert admin only` prüft `is_admin()`.
Da Service Role RLS bypassed, greift diese Policy nicht.
Die RPC-Funktion (SECURITY DEFINER) kann ohne Policy-Check inserieren.

→ Kein Policy-Problem. Keine Änderung an bestehenden Policies nötig.

---

## 13. Offene Fragen

**F1: lead_status_history bei Lead-Erstellung**

Legt ein DB-Trigger automatisch den ersten `lead_status_history`-Eintrag
an wenn `status = 'new'` beim INSERT gesetzt wird?

Wenn nein: Die RPC-Funktion muss diesen Eintrag explizit anlegen:
```sql
INSERT INTO lead_status_history (lead_id, old_status, new_status, changed_by)
VALUES (v_lead_id, NULL, 'new', NULL);
```

→ **Geklärt:** Kein Trigger vorhanden. Die RPC-Funktion legt den Eintrag
    explizit an (siehe Abschnitt "lead_status_history in der RPC").

**F2: Duplikat-E-Mails**

`leads.email` hat kein UNIQUE-Constraint — dasselbe Person kann mehrfach
submittieren. Für V1 ist das akzeptabel (CRM-Mitarbeiter erkennt Duplikate
manuell). Deduplication-Logik ist bewusst nicht in Block 10.

Folgeentscheidung: Soll die RPC eine Warnung zurückgeben wenn die E-Mail
bereits in `leads` existiert, ohne die Submission zu blockieren?

→ Empfehlung: Nein. Stilles Insert ohne Warnung. CRM-Mitarbeiter entscheidet.

**F3: Mindestadresse**

Muss `postal_code` ein Pflichtfeld sein?
Für den deutschen Energiemarkt ist die PLZ für den Provider-Lookup wichtig.

→ Empfehlung: PLZ im V1-Formular als Pflichtfeld (Frontend-Validierung),
    aber die API macht sie nicht zu einem Pflichtfeld (`optional()` in Zod).
    Begründung: API und Formular haben getrennte Validierungsschichten.

**F4: `source` Standardwert**

Soll die API Route automatisch `source = 'website_form'` setzen,
oder sendet das Frontend diesen Wert?

→ Empfehlung: API Route setzt `source = 'website_form'` als Hardcoded-Default
    wenn kein source-Wert im Body enthalten ist.

---

## 14. Tests (dokumentiert als TODO)

Noch nicht implementiert. Werden nach Block 10 als eigener Test-Block
(Block 10T) umgesetzt.

### Zod-Schema Unit Tests (kein DB nötig)

- Gültige Submission (electricity)
- Gültige Submission (gas, hot_water_with_gas = true)
- Gültige Submission (both)
- `privacy_consent = false` → Validierungsfehler
- `product_type = 'electricity'` ohne electricity-Objekt → Fehler
- `product_type = 'both'` ohne gas-Objekt → Fehler
- ungültiger referral_code-Format → Fehler
- referral_code → .toUpperCase() Transform
- ungültige E-Mail → Fehler
- fehlender turnstile_token → Fehler

### RPC Integrationstests (brauchen Supabase lokal)

- Happy Path ohne referral_code → leads + address + energy_demands created
- Happy Path mit gültigem referral_code → + lead_referrals created
- ungültiger referral_code → lead trotzdem created, keine lead_referrals
- inaktiver referral_code → lead trotzdem created, keine lead_referrals
- `privacy_consent = false` → RAISE EXCEPTION
- `product_type = 'both'` → zwei energy_demands-Zeilen
- Gas-Demand mit hot_water_with_gas = true → CHECK constraint bestanden
- Electricity-Demand mit hot_water_with_gas = true → CHECK constraint schlägt fehl
- Jeder erfolgreiche Lead-Submit → genau 1 lead_status_history-Zeile mit old_status = NULL, new_status = 'new', reason = 'public_lead_submit'

### API Route Tests

- 201 bei gültiger Submission
- 422 bei Zod-Fehler (fehlender privacy_consent)
- 422 bei Captcha-Fehler (wenn TURNSTILE_SECRET_KEY gesetzt)
- 429 bei Rate-Limit-Überschreitung
- 400 bei ungültigem JSON

---

## 15. Was bewusst nicht in Block 10 gehört

| Thema                        | Begründung                                          |
|------------------------------|-----------------------------------------------------|
| E-Mail-Bestätigung           | Kein E-Mail-System in V1                            |
| Lead-Zuweisung               | assigned_to bleibt NULL — manuelle Zuweisung im CRM |
| Lead-Scoring                 | score = 0, score_label = 'cold' als feste Defaults  |
| Lead-Deduplication           | CRM-Mitarbeiter entscheidet manuell                 |
| Webhook-Notifications        | Kein Notification-System in V1                      |
| Frontend-Formular            | Eigener Block (Frontend), nicht Block 10            |
| Commissions / Pyramidensystem | Nicht in V1                                       |
| Dokumentupload               | Eigener Block (Storage)                             |
| Alpha-Export                 | Eigener Block                                       |
| Dashboard                    | Nicht Scope dieses Blocks                           |
| Volltests                    | Test-Block nach Block 10                            |
| `GET /api/public/leads`      | Öffentliche Liste der Leads = Sicherheitsrisiko     |

---

## Risiken

| Risiko                        | Schwere | Mitigation                                        |
|-------------------------------|---------|---------------------------------------------------|
| Spam-Submissions              | Hoch    | Rate Limit + Turnstile Captcha (beide Pflicht)    |
| Code-Enumeration (referral)   | Mittel  | Silentes Ignorieren ungültiger Codes              |
| Service Role Key Leak         | Kritisch| `import "server-only"` + `.env.local` nicht committed |
| Doppelte energy_demands-Zeilen | Mittel | UNIQUE (lead_id, energy_type) auf DB-Ebene        |
| Partial write bei Crash       | Hoch    | RPC ist atomare Transaktion → kein Partial write  |
| hot_water_with_gas für electricity | Niedrig | DB CHECK constraint verhindert es             |
| Fehlende lead_status_history  | Mittel  | RPC inseriert explizit (F1 geklärt, kein Trigger) |

---

## Zusammenfassung

| Punkt                  | Entscheidung                                         |
|------------------------|------------------------------------------------------|
| RPC-Name               | `submit_public_lead`                                 |
| Transaktionsgarantie   | Vollständig (eine PostgreSQL-Transaktion)             |
| referral_code Lookup   | Innerhalb der RPC-Funktion (atomar)                  |
| Ungültiger Code        | Silentes Ignorieren, kein Fehler                     |
| privacy_consent        | z.literal(true) + RPC RAISE EXCEPTION Guard          |
| lead_number            | DB-DEFAULT mit Sequence (kein Applikations-Code)     |
| Fehler-Propagierung    | RAISE EXCEPTION → handleSupabaseError() → HTTP       |
| Captcha                | Cloudflare Turnstile (Pflicht, Dev-Skip möglich)     |
| Rate Limiting          | Upstash Redis 5 req/10 min pro IP (Pflicht)          |
| Service Role           | Admin-Client, bypasses RLS                           |
| RPC Berechtigungen     | GRANT EXECUTE TO service_role, REVOKE von anon/authenticated |
| Supabase-JS-Call       | `adminClient.rpc('submit_public_lead', params)`      |
| Response               | 201 + { data: { lead_id, lead_number } }             |
| Atomare Writes         | 5: leads + addresses + energy_demands + lead_referrals (opt.) + lead_status_history |
| lead_status_history    | Explizit in RPC (kein Trigger), reason = 'public_lead_submit' |
| database.ts-Fix        | Erster Schritt in Block 10 (vor Migration)           |
| Migration              | `20260616000012_block10_submit_public_lead_rpc.sql`  |
