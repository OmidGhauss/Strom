# Affiliate V1 – Architekturplan (Block 9a)

Version: v3 (freigegeben nach Codex Review)

---

## Ziel V1

Affiliate-Link → Lead-Zuordnung → Abschluss später auswertbar.

V1 ist reine Attribution. Keine Provisionsberechnung, kein Pyramidensystem.

---

## Neue Enums

```
affiliate_status:      active | inactive | suspended
affiliate_link_status: active | inactive
```

---

## Neue Tabellen

Reihenfolge wegen FK-Abhängigkeiten: affiliates → affiliate_links → lead_referrals.

### affiliates

| Feld        | Typ               | Constraints                          |
|-------------|-------------------|--------------------------------------|
| id          | uuid              | PK, DEFAULT gen_random_uuid()        |
| name        | text              | NOT NULL                             |
| email       | text              | NOT NULL, UNIQUE                     |
| status      | affiliate_status  | NOT NULL, DEFAULT 'active'           |
| notes       | text              | NULL                                 |
| created_at  | timestamptz       | NOT NULL, DEFAULT now()              |
| updated_at  | timestamptz       | NOT NULL, DEFAULT now() + Trigger    |

Affiliates werden deaktiviert (`status = 'inactive'`), nie gelöscht.

### affiliate_links

| Feld           | Typ                    | Constraints                                       |
|----------------|------------------------|---------------------------------------------------|
| id             | uuid                   | PK, DEFAULT gen_random_uuid()                     |
| affiliate_id   | uuid                   | NOT NULL, FK → affiliates RESTRICT                |
| referral_code  | text                   | NOT NULL, UNIQUE, CHECK (siehe unten)             |
| label          | text                   | NULL – internes Label (z. B. "Google Ads März")   |
| status         | affiliate_link_status  | NOT NULL, DEFAULT 'active'                        |
| created_at     | timestamptz            | NOT NULL, DEFAULT now()                           |
| updated_at     | timestamptz            | NOT NULL, DEFAULT now() + Trigger                 |

**referral_code CHECK-Constraints (beide gemeinsam):**
```sql
CHECK (referral_code = upper(referral_code))
CHECK (referral_code ~ '^[A-Z0-9-]{3,32}$')
```

Links werden deaktiviert (`status = 'inactive'`), nie gelöscht.

### lead_referrals

| Feld               | Typ         | Constraints                                  |
|--------------------|-------------|----------------------------------------------|
| id                 | uuid        | PK, DEFAULT gen_random_uuid()                |
| lead_id            | uuid        | NOT NULL, UNIQUE, FK → leads CASCADE         |
| affiliate_link_id  | uuid        | NOT NULL, FK → affiliate_links RESTRICT      |
| notes              | text        | NULL – für manuelle Admin-Zuordnungen        |
| created_at         | timestamptz | NOT NULL, DEFAULT now()                      |

Kein `updated_at` — die Referral-Zuordnung ist eine unveränderliche historische Tatsache.

---

## referral_code – Format und Normalisierung

### Format V1

| Regel | Wert |
|-------|------|
| Erlaubte Zeichen | A–Z, 0–9, Bindestrich (-) |
| Länge | 3 bis 32 Zeichen |
| Keine Leerzeichen | erzwungen durch Regex |
| Keine Umlaute | erzwungen durch Regex |
| Keine weiteren Sonderzeichen | nur Bindestrich erlaubt |

Beispiele: `SOLAR2026`, `MAX-MUSTER`, `PARTNER-A1`, `ABC`

### Zwei Schutzschichten

1. **API-Schicht:** normalisiert eingehenden Code mit `.toUpperCase()` und validiert Format (Zod-Regex) vor dem Lookup und vor dem INSERT
2. **DB-Schicht:** zwei CHECK-Constraints als letztes Sicherheitsnetz (schützt auch gegen direkte DB-Writes)

Damit sind `?ref=solar2026`, `?ref=Solar2026`, `?ref=SOLAR2026` identisch und alle korrekt.

---

## Foreign Keys + ON DELETE

| FK                                           | ON DELETE | Begründung                                    |
|----------------------------------------------|-----------|-----------------------------------------------|
| affiliate_links.affiliate_id → affiliates    | RESTRICT  | Affiliate mit Links nicht löschbar            |
| lead_referrals.lead_id → leads               | CASCADE   | DSGVO: Lead gelöscht → Referral weg           |
| lead_referrals.affiliate_link_id → affiliate_links | RESTRICT | Link mit zugeordneten Leads nicht löschbar |

---

## Indizes

### affiliates
- UNIQUE email
- INDEX status

### affiliate_links
- UNIQUE referral_code ← kritisch, Lookup bei jedem Formular-Submit
- INDEX affiliate_id ← "Alle Links von Affiliate X"
- INDEX status

### lead_referrals
- UNIQUE lead_id ← ein Lead hat maximal eine Referral-Quelle
- INDEX affiliate_link_id ← "Alle Leads über Link X"

---

## Trigger

- `set_affiliates_updated_at` → `trigger_set_updated_at()` (aus Block 2, wiederverwendbar)
- `set_affiliate_links_updated_at` → `trigger_set_updated_at()`
- `lead_referrals`: kein Trigger (kein updated_at)

---

## RLS-Regeln

### affiliates

| Operation | employee | manager | admin |
|-----------|----------|---------|-------|
| SELECT    | nein     | ja      | ja    |
| INSERT    | nein     | nein    | ja    |
| UPDATE    | nein     | nein    | ja    |
| DELETE    | nein     | nein    | nein (RESTRICT) |

### affiliate_links

| Operation | employee | manager | admin |
|-----------|----------|---------|-------|
| SELECT    | nein     | ja      | ja    |
| INSERT    | nein     | nein    | ja    |
| UPDATE    | nein     | nein    | ja    |
| DELETE    | nein     | nein    | nein (RESTRICT) |

### lead_referrals

| Operation | employee                   | manager                    | admin |
|-----------|----------------------------|----------------------------|-------|
| SELECT    | can_access_lead(lead_id)   | can_access_lead(lead_id)   | ja    |
| INSERT    | nein                       | nein                       | ja    |
| UPDATE    | nein                       | nein                       | nein  |
| DELETE    | nein                       | nein                       | ja    |

**Begründung der Trennung:**
- Employee kann erkennen, *dass* ein Lead über Referral kam (relevant für Kundenkontakt)
- Employee sieht `affiliate_link_id` (UUID), aber keine Affiliate-Stammdaten
- Die Dashboard-UI zeigt Employees nur "Referral-Lead: ja/nein", ohne Affiliate-Details
- Affiliate-Stammdaten (`affiliates`, `affiliate_links`) sind Manager/Admin-only
- Kein UPDATE auf `lead_referrals` — Zuordnung ist unveränderlich

---

## API-Regeln (für spätere Blocks)

### referral_code Validierung (Zod-Schema)

```
z.string()
  .toUpperCase()
  .regex(/^[A-Z0-9-]{3,32}$/)
  .optional()
```

Wird im Public Lead Submit und im Admin-Interface für Link-Erstellung verwendet.

### Public Lead Submit – Atomarität (Pflicht)

> `POST /api/public/leads` muss alle Schreiboperationen in einer einzigen
> PostgreSQL-Transaktion (via Supabase RPC) ausführen:
>
> 1. `leads`-Zeile erstellen
> 2. `energy_demands`-Zeilen erstellen (1 oder 2, je nach product_type)
> 3. `lead_referrals`-Zeile erstellen (nur wenn referral_code vorhanden und aktiv)
>
> Sequentielle Supabase-JS-Calls ohne Transaktion sind nicht zulässig.
> Eine teilweise Erstellung verletzt die Datenkonsistenz.
>
> Der referral_code-Lookup (read-only) findet vor der Transaktion statt.
> Die Transaktion schreibt dann mit der aufgelösten affiliate_link_id.

### Lookup-Logik

```
code = body.referral_code?.toUpperCase()
if code:
  link = SELECT FROM affiliate_links WHERE referral_code = code AND status = 'active'
  // Nicht gefunden oder inaktiv → Lead trotzdem anlegen, kein Fehler
  // Kein Hinweis an Client ob Code existiert (verhindert Code-Enumeration)
```

### Dashboard-API (spätere Blocks)

- `GET /api/affiliates` – Liste (Manager+)
- `GET /api/affiliates/[id]` – Detail
- `GET /api/affiliates/[id]/links` – Links eines Affiliates
- `GET /api/affiliates/[id]/stats` – Auswertung (Leads, Conversions)
- `GET /api/leads/[id]/referral` – Referral-Info zu einem Lead

---

## Dashboard-Auswertungen (mit V1-Daten bereits möglich)

| Auswertung | Query-Basis |
|-----------|-------------|
| Leads pro Affiliate | lead_referrals → affiliate_links → affiliates |
| Conversion Rate | Leads mit status = 'completed' / alle Leads dieses Affiliates |
| Leads pro Link | lead_referrals GROUP BY affiliate_link_id |
| Umsatz-Potenzial | Leads → Angebote mit status = 'accepted' → annual_price |
| Referral-Timeline | lead_referrals.created_at nach Affiliate gruppiert |

Alle Auswertungen laufen ohne commissions-Tabelle.

---

## Vorbereitung für spätere Pyramidensysteme

Was V1 bereits ermöglicht (ohne es zu bauen):
- `affiliates` ist eine eigene Tabelle → `parent_affiliate_id` kann später hinzugefügt werden
- `lead_referrals` referenziert `affiliate_link_id` → Pyramide kann über affiliate_links traversiert werden
- Keine Commission-Logik in V1 → `commissions`-Tabelle kann `lead_referrals.id` als FK ergänzen

Was bewusst NICHT eingebaut wird:
- `parent_affiliate_id` auf affiliates
- `commission_rate` auf affiliate_links
- Tier/Level-System
- commissions-Tabelle

---

## Was bewusst NICHT in V1 gehört

- Multi-Level / Pyramidensystem
- Provisionsberechnung und -auszahlung
- commissions-Tabelle
- Klick-Tracking (Linkaufrufe vor Lead-Erstellung)
- Attribution Window (zeitliche Ablauflogik)
- Affiliate-Portal (eigener Login für Affiliates)
- Echtzeit-Performance-Dashboard
- Klickbetrug-Erkennung
- UTM-Integration (UTM-Felder bereits in leads vorhanden, reichen für V1)

---

## Offene Fragen (alle entschieden)

| Punkt | Entscheidung |
|-------|-------------|
| referral_code UPPERCASE | API + DB CHECK |
| referral_code Format | `^[A-Z0-9-]{3,32}$` — API Zod + DB CHECK |
| referral_code Vergabe | Admin vergibt manuell (NOT NULL, kein Default) |
| Employee-Sichtbarkeit lead_referrals | ja, via can_access_lead(lead_id) |
| Employee-Sichtbarkeit affiliates/links | nein |
| Public Lead Submit Atomarität | RPC zwingend, keine sequentiellen Calls |
| commissions in V1 | nein |
