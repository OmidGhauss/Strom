# RLS Security Plan – Energievermittlung CRM

## 1. Übergreifende Architektur

Drei Zugriffspfade existieren nebeneinander:

```
Browser (authenticated) → Supabase JS Client → RLS greift vollständig
Next.js API Route       → Service Role Client  → RLS wird bypassed
Öffentliches Formular   → Next.js API Route → Service Role → RLS bypassed
```

Das öffentliche Lead-Formular schreibt **niemals** direkt in die Datenbank.
Es geht immer über eine Next.js API Route, die den Supabase Service Role Client
verwendet. Damit entfällt die Notwendigkeit, `anon`-Policies für CRM-Tabellen
zu schreiben — keine einzige CRM-Tabelle ist für `anon` zugänglich.

**Service Role Key:**
- Nur in Next.js API Routes als Server-Side-Umgebungsvariable
- Niemals im Client-Bundle (NEXT_PUBLIC_*)
- Niemals im Browser
- Bypassed alle RLS-Regeln — Missbrauch führt zu vollständigem Sicherheitsverlust

---

## 2. Hilfsfunktionen

Alle fünf Funktionen sind `SECURITY DEFINER`. Ohne `SECURITY DEFINER` können die
Funktionen `profiles` nicht lesen, sobald RLS auf `profiles` aktiv ist.

Pflichtanforderungen für alle Hilfsfunktionen:

```
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
LANGUAGE sql
STABLE
RETURNS NULL ON NULL INPUT
GRANT EXECUTE TO authenticated
```

`RETURNS NULL ON NULL INPUT` (STRICT): Wenn `auth.uid()` NULL ist (anon-Kontext),
gibt die Funktion sofort NULL zurück ohne Tabellenabfrage.

### current_profile_id() → uuid
```
SELECT id FROM profiles WHERE auth_user_id = auth.uid()
```
Gibt die interne `profiles.id` des eingeloggten Users zurück.

### current_user_role() → user_role
```
SELECT role FROM profiles WHERE auth_user_id = auth.uid()
```

### is_admin() → boolean
```
current_user_role() = 'admin'
```

### is_manager_or_above() → boolean
```
current_user_role() IN ('admin', 'manager')
```

### can_access_lead(p_lead_id uuid) → boolean
```
is_manager_or_above()
OR EXISTS (
  SELECT 1 FROM leads
  WHERE id = p_lead_id
    AND assigned_to = current_profile_id()
)
```
Zentrale Zugriffsfunktion für alle lead_id-abhängigen Tabellen. Wenn ein Lead
reassigned wird, ändert sich der Zugriff auf alle abhängigen Tabellen automatisch.

---

## 3. Zirkularitätsregel: profiles

`profiles`-Policies dürfen **keinesfalls** die Hilfsfunktionen `current_user_role()`,
`is_admin()` oder `is_manager_or_above()` direkt aufrufen.

Diese Funktionen lesen aus `profiles`. Würde `profiles`-RLS dieselben Funktionen
aufrufen, entsteht eine Endlosrekursion:

```
profiles RLS → is_admin() → SELECT FROM profiles → profiles RLS → ...
```

`is_manager_or_above()` kann auf `profiles` zugreifen ohne Rekursion, weil es
SECURITY DEFINER ist (der interne SELECT läuft als Owner, der RLS bypassed).
Trotzdem: für Klarheit und Sicherheit verwenden `profiles`-Policies
ausschließlich `auth.uid()` direkt.

**Richtig für profiles:**
```sql
-- Policy 1: alle authenticated sehen eigene Zeile
USING (auth_user_id = auth.uid())

-- Policy 2: admin/manager sehen alle Zeilen
USING (is_manager_or_above())
```

`is_manager_or_above()` ist hier sicher, weil es SECURITY DEFINER den Owner-Context
nutzt. Trotzdem: `auth_user_id = auth.uid()` enthält keinen Hilfsfunktionsaufruf
und ist die sicherere erste Policy.

---

## 4. Policy-Matrix

### profiles

| Operation | employee | manager | admin |
|-----------|----------|---------|-------|
| SELECT | eigene Zeile | alle Zeilen | alle Zeilen |
| INSERT | nein | nein | ja |
| UPDATE | **nein** | **nein** | ja |
| DELETE | nein | nein | nein (RESTRICT verhindert es) |

Eigene Profiländerungen (full_name) kommen über eine API Route mit Spalten-Whitelist.
Employee darf `role` und `is_active` nicht selbst ändern — daher kein UPDATE via RLS.

### leads

| Operation | employee | manager | admin |
|-----------|----------|---------|-------|
| SELECT | assigned_to = current_profile_id() | alle | alle |
| INSERT | WITH CHECK: assigned_to = current_profile_id() | ja | ja |
| UPDATE | assigned_to = current_profile_id() | alle | alle |
| DELETE | nein | nein | ja |

INSERT WITH CHECK für employee: verhindert dass Employees einen Lead anlegen und
`assigned_to = NULL` oder eine fremde profile_id setzen.

### addresses

| Operation | employee | manager | admin |
|-----------|----------|---------|-------|
| SELECT | can_access_lead(lead_id) | can_access_lead | can_access_lead |
| INSERT | can_access_lead(lead_id) | can_access_lead | can_access_lead |
| UPDATE | can_access_lead(lead_id) | can_access_lead | can_access_lead |
| DELETE | nein | nein | ja |

### energy_demands

Identisch zu addresses.

### lead_status_history

| Operation | employee | manager | admin |
|-----------|----------|---------|-------|
| SELECT | can_access_lead(lead_id) | can_access_lead | can_access_lead |
| INSERT | can_access_lead(lead_id) | can_access_lead | can_access_lead |
| UPDATE | **nein** | **nein** | **nein** |
| DELETE | nein | nein | ja (DSGVO) |

Unveränderlich — kein UPDATE für niemanden.

### lead_notes

| Operation | employee | manager | admin |
|-----------|----------|---------|-------|
| SELECT | can_access_lead(lead_id) | can_access_lead | can_access_lead |
| INSERT | can_access_lead(lead_id) | can_access_lead | can_access_lead |
| UPDATE | created_by = current_profile_id() | nein | ja |
| DELETE | created_by = current_profile_id() | nein | ja |

Employee kann eigene Notizen bearbeiten und löschen.

**Manager dürfen lead_notes bewusst nicht updaten oder löschen** — auch nicht
eigene Notizen. Notizen gelten als persönliche Arbeitsaufzeichnungen des Autors.
Nur der Autor selbst (Employee) oder ein Admin darf Notizen ändern oder entfernen.
Diese Einschränkung ist in der RLS-Policy über `NOT is_manager_or_above()` umgesetzt.

### documents

| Operation | employee | manager | admin |
|-----------|----------|---------|-------|
| SELECT | can_access_lead(lead_id) | can_access_lead | can_access_lead |
| INSERT | can_access_lead(lead_id) | can_access_lead | can_access_lead |
| UPDATE | uploaded_by = current_profile_id() | can_access_lead | ja |
| DELETE | nein | nein | ja |

Employee kann Metadaten eigener Uploads korrigieren (z. B. document_type).
Manager kann Dokument-Metadaten aller Leads sehen und ändern.
Nur Admin löscht (DSGVO-Prozess mit vorheriger Storage-Datei-Löschung).

### offers

| Operation | employee | manager | admin |
|-----------|----------|---------|-------|
| SELECT | can_access_lead(lead_id) | can_access_lead | can_access_lead |
| INSERT | can_access_lead(lead_id) | can_access_lead | can_access_lead |
| UPDATE | can_access_lead(lead_id) | can_access_lead | can_access_lead |
| DELETE | nein | nein | ja |

### communications_log

Identisch zu offers.

---

### affiliates (Block 9a)

| Operation | employee | manager | admin |
|-----------|----------|---------|-------|
| SELECT | nein | ja | ja |
| INSERT | nein | nein | ja |
| UPDATE | nein | nein | ja |
| DELETE | nein | nein | nein (RESTRICT) |

### affiliate_links (Block 9a)

| Operation | employee | manager | admin |
|-----------|----------|---------|-------|
| SELECT | nein | ja | ja |
| INSERT | nein | nein | ja |
| UPDATE | nein | nein | ja |
| DELETE | nein | nein | nein (RESTRICT) |

### lead_referrals (Block 9a)

| Operation | employee | manager | admin |
|-----------|----------|---------|-------|
| SELECT | can_access_lead(lead_id) | can_access_lead(lead_id) | ja |
| INSERT | nein | nein | ja |
| UPDATE | nein | nein | nein |
| DELETE | nein | nein | ja |

**Wichtig — Employee-Sichtbarkeit auf lead_referrals:**
Employee sieht, *dass* ein Lead über einen Referral-Link kam (`affiliate_link_id` ist sichtbar),
aber er kann die Affiliate-Stammdaten nicht lesen (`affiliates` und `affiliate_links` sind für
Employee nicht zugänglich). Die Dashboard-UI zeigt Employees daher nur "Referral-Lead: ja/nein"
ohne Affiliate-Details.

---

## 5. DELETE-Zusammenfassung

| Tabelle | employee | manager | admin |
|---------|----------|---------|-------|
| profiles | nein | nein | nein (RESTRICT) |
| leads | nein | nein | ja |
| addresses | nein | nein | ja (via CASCADE) |
| energy_demands | nein | nein | ja (via CASCADE) |
| lead_status_history | nein | nein | ja (DSGVO) |
| lead_notes | eigene | nein | ja |
| documents | nein | nein | ja |
| offers | nein | nein | ja |
| communications_log | nein | nein | ja |
| affiliates | nein | nein | nein (RESTRICT) |
| affiliate_links | nein | nein | nein (RESTRICT) |
| lead_referrals | nein | nein | ja (CASCADE von leads deckt Standardfall ab) |

Manager hat kein DELETE auf Leads. DSGVO-Löschungen sind Admin-Operationen
mit explizitem Prozess (Storage-Dateien zuerst, dann Lead).

---

## 6. Was RLS nicht leistet

RLS steuert Zugriffsrechte auf Zeilenebene. Business-Regeln gehören in die API.

RLS kann nicht:
- Einzelne Spalten in einer UPDATE-Operation sperren
- Prüfen ob `product_type` zur Anzahl der `energy_demands`-Zeilen passt
- Prüfen ob `offers.energy_type` mit `energy_demands.energy_type` übereinstimmt
- `score` und `score_label` synchron halten
- Statuswechsel-Reihenfolge erzwingen
- Verhindern dass `superseded`-Angebote akzeptiert werden
- Versionsketten-Zyklen in `offers.parent_offer_id` erkennen
- `lead_status_history`-Einträge bei Statuswechsel erzwingen
- Spam oder Bot-Submissions blockieren
- Formular-Feldformate validieren

→ Alle diese Regeln stehen in docs/api-validation-rules.md

---

## 7. Storage-Entscheidung (V1)

**V1: Service Role only. Keine Storage-Bucket-Policies in Block 8.**

Regeln:
- Bucket `documents` → privat, kein public access
- Alle Dateioperationen laufen über Next.js API Routes mit Service Role
- Clients erhalten nur signierte URLs (signed URLs) mit kurzer TTL (max. 60 Minuten)
- Upload: nur über API Route, serverseitige Validierung von MIME-Type und Dateigröße
- Download: API Route generiert signed URL und gibt sie zurück, Datei lädt direkt von Storage
- Delete: nur Admin-API-Route, Storage-Datei zuerst, dann DB-Eintrag

Storage-Bucket-Policies (für direkten Client-Upload ohne API Route) → Block 8b.

---

## 8. Gefährliche Patterns — verboten

| Pattern | Warum verboten |
|---------|----------------|
| `USING (true)` für authenticated | Alle Zeilen für alle eingeloggten User sichtbar — Datenleck |
| `USING (auth.uid() IS NOT NULL)` | Identisches Problem — kein Rollencheck |
| Hilfsfunktionen ohne SECURITY DEFINER | Rekursion oder false Denial wenn profiles RLS aktiv |
| profiles-Policies die current_user_role() direkt aufrufen | Zirkuläre Referenz |
| Mehrere PERMISSIVE Policies ohne Überblick | PERMISSIVE Policies werden ODER-verknüpft; eine zu breite Policy hebelt alle engeren aus |
| anon irgendeine CRM-Tabelle zugänglich machen | Keine einzige Policy für anon auf CRM-Tabellen |
| Service Role Key in Client-Bundle | Bypassed alle RLS-Regeln komplett |
| RLS aktivieren ohne alle Operationen zu prüfen | Fehlende Policy = kein Zugriff (Defaultverhalten) — kann unbeabsichtigt Mitarbeiter aussperren |

---

## 9. Migrationsdatei

`supabase/migrations/20260615000010_block8_rls.sql`

Inhalt (noch nicht erstellt):
1. `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` für alle 9 Tabellen
2. Hilfsfunktionen mit SECURITY DEFINER
3. Alle Policies gemäß Policy-Matrix
