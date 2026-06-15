# Backend Database Plan – Energievermittlung CRM

## 0. Ziel

Dieses Dokument ist die zentrale Kontextdatei für die Backend- und Datenbankentwicklung des Energievermittlungsportals.

Projektziel:

```text
Besucher
→ Multi-Step-Formular
→ Lead
→ Mitarbeiter-Dashboard
→ Angebot
→ Vertrag
→ Abschluss
```

Dieses Dokument soll von Claude Code, Codex, ChatGPT und Gemini als gemeinsamer Kontext genutzt werden.

Wichtig:

- Wir bauen Schritt für Schritt.
- Keine große Komplett-Implementierung auf einmal.
- Erst planen, dann implementieren.
- Jede Änderung soll reviewbar und commitbar sein.
- Frontend und Backend dürfen unterschiedlich weit sein.
- Felder, die das Frontend noch nicht sendet, müssen optional sein.
- Nur echte Pflichtfelder dürfen `NOT NULL` sein.

---

## 1. Rollen der KI-Tools

### ChatGPT

Rolle:

- Architektur
- Planung
- Aufgaben schneiden
- Entscheidung nach Reviews
- Prompt-Erstellung

### Gemini

Rolle:

- Research
- Business-Analyse
- CRM-Best-Practices
- Energievertrieb-Fachwissen
- DSGVO-/Compliance-Ideen
- Dokumentationsideen

### Claude Code

Rolle:

- Hauptimplementierung
- Datenbank-Migrationen
- Supabase-Struktur
- API-Implementierung
- technische Umsetzung in kleinen Schritten

### Codex

Rolle:

- Reviewer
- Sicherheitsprüfung
- Datenbankprüfung
- TypeScript-/SQL-Review
- Architekturkritik

Codex darf nur coden, wenn es ausdrücklich erlaubt wird.

---

## 2. Grundprinzipien

### 2.1 Kleine Schritte

Nicht:

```text
Baue die komplette Datenbank, APIs, Auth, Uploads, E-Mails und PDFs.
```

Sondern:

```text
Erstelle nur Block 1.
Warte auf Review.
Dann Block 2.
```

### 2.2 Optional-first API

Das Backend soll nicht abbrechen, nur weil das Frontend ein Feld noch nicht sendet.

Beispiel:

```sql
gas_type text null
```

ist erlaubt.

```sql
gas_type text not null
```

ist nicht erlaubt, solange das Frontend dieses Feld nicht garantiert sendet.

### 2.3 Repository ist die Wahrheit

Wichtige Dateien:

```text
/docs/backend-database-plan.md
/docs/progress.md
/docs/api-contracts.md
/docs/database-decisions.md
```

Der Chatverlauf ist nicht die Wahrheit. Das Repository ist die Wahrheit.

### 2.4 Erst V1, dann Erweiterungen

V1 soll ein funktionierendes Lead-CRM ermöglichen.

Nicht in V1:

- komplexe Provisionen
- vollständige Anbieter-/Tarifdatenbank
- automatische Marktkommunikation
- KI-Agenten
- komplexes Vertragsclearing
- White-Label-System

---

## 3. Empfohlener Tech Stack

```text
VS Code
GitHub
Next.js
TypeScript
Supabase
PostgreSQL
Supabase Auth
Supabase Storage
Zod
Resend
Vercel
```

---

## 4. Zielarchitektur

```text
Lovable Frontend / Website
        ↓
Next.js API Routes
        ↓
Supabase / PostgreSQL
        ↓
Dashboard / CRM
```

Die öffentliche Website und das interne Dashboard sind zwei Frontends, greifen aber auf dieselben Backend-Daten zu.

---

## 5. V1 Datenbanktabellen

Für V1 sollen nur diese Kernbereiche umgesetzt werden:

```text
profiles
leads
addresses
energy_demands
lead_status_history
lead_notes
documents
offers
communications_log
```

Noch nicht in V1:

```text
contracts
providers
tariffs
bank_details
meter_details
commissions
audit_logs
contract_bundles
retention_triggers
```

Diese können später vorbereitet werden, aber nicht in der ersten Implementierung.

---

## 6. Tabellenbeschreibung V1

## 6.1 profiles

Zweck:

Interne Mitarbeiter, Admins und Manager.

Hinweis:

Supabase Auth verwaltet die eigentliche Authentifizierung. Die Tabelle `profiles` speichert zusätzliche Rollen- und Profildaten.

Wichtige Felder:

```text
id
auth_user_id
full_name
email
role
is_active
created_at
updated_at
```

Rollen:

```text
admin
manager
employee
```

---

## 6.2 leads

Zweck:

Zentrale Tabelle für eingehende Anfragen aus dem Formular.

Wichtige Felder:

```text
id
lead_number
product_type
customer_type
status
score
score_label
source
utm_source
utm_medium
utm_campaign
utm_content
utm_term
assigned_to
privacy_consent
contact_consent
data_transfer_consent
created_at
updated_at
```

Product Types:

```text
electricity
gas
both
business
```

Customer Types:

```text
private
business
property_management
multi_location_company
```

Lead Status:

```text
new
in_review
question_open
offer_created
offer_sent
interested
contract_prepared
contract_sent
completed
rejected
unreachable
follow_up
disqualified
lost
```

Wichtig:

- `product_type`, `customer_type`, `status`, `privacy_consent`, `contact_consent` sind Pflichtfelder.
- Marketing-Felder sind optional.
- `assigned_to` ist optional.

---

## 6.3 addresses

Zweck:

Adressen getrennt speichern, weil Lieferadresse, Rechnungsadresse und Kontaktadresse unterschiedlich sein können.

Wichtige Felder:

```text
id
lead_id
address_type
street
house_number
address_addition
postal_code
city
state
country
created_at
updated_at
```

Address Types:

```text
delivery
billing
contact
```

Wichtig:

- Für V1 darf fast alles optional sein.
- `postal_code` ist wichtig, aber nur dann Pflicht, wenn das Frontend es garantiert sendet.

---

## 6.4 energy_demands

Zweck:

Technische Verbrauchsdaten getrennt vom Lead speichern.

Ein Lead kann theoretisch mehrere Energiebedarfe haben, z. B. Strom und Gas.

Wichtige Felder:

```text
id
lead_id
energy_type
annual_consumption_kwh
consumption_known
household_size
living_area_sqm
heating_type
hot_water_with_gas
current_provider
current_tariff
monthly_payment
contract_end_date
cancellation_period_known
price_guarantee
meter_number
market_location_id
created_at
updated_at
```

Energy Types:

```text
electricity
gas
```

Wichtig:

- `meter_number` und `market_location_id` sind optional.
- Diese Felder können später aus Rechnungen ergänzt werden.
- Für V1 keine komplexe Tariflogik.

---

## 6.5 lead_status_history

Zweck:

Jede Statusänderung wird nachvollziehbar gespeichert.

Wichtige Felder:

```text
id
lead_id
old_status
new_status
changed_by
reason
created_at
```

Wichtig:

- Kein Statuswechsel ohne Historieneintrag.
- `changed_by` kann optional sein, wenn das System den Status ändert.

---

## 6.6 lead_notes

Zweck:

Interne Mitarbeiter-Notizen zu Leads.

Wichtige Felder:

```text
id
lead_id
created_by
note
created_at
updated_at
```

---

## 6.7 documents

Zweck:

Dateien wie Rechnungen, Angebote und Vertragsentwürfe speichern.

Die Datei selbst liegt in Supabase Storage. Die Datenbank speichert nur Metadaten.

Wichtige Felder:

```text
id
lead_id
uploaded_by
document_type
file_name
file_path
mime_type
file_size
created_at
```

Document Types:

```text
invoice
offer_pdf
contract_pdf
other
```

---

## 6.8 offers

Zweck:

Angebote speichern, die Mitarbeiter für Leads erstellen oder versenden.

Wichtige Felder:

```text
id
lead_id
created_by
offer_number
provider_name
tariff_name
energy_type
monthly_price
annual_price
estimated_savings
status
valid_until
created_at
updated_at
```

Offer Status:

```text
draft
created
sent
accepted
rejected
expired
```

Wichtig:

- Anbieter und Tarif werden in V1 als Text gespeichert.
- Eigene Tabellen `providers` und `tariffs` kommen später.

---

## 6.9 communications_log

Zweck:

Alle Kontaktpunkte speichern:

- E-Mail
- Telefon
- Systembenachrichtigung
- Rückfrage
- Angebot gesendet

Wichtige Felder:

```text
id
lead_id
created_by
communication_type
direction
subject
content_summary
status
created_at
```

Communication Types:

```text
email
call
sms
system
note
```

Direction:

```text
inbound
outbound
internal
```

Status:

```text
success
failed
pending
```

---

## 7. Lead Scoring V1

Das Lead Scoring soll regelbasiert sein. Keine KI.

Beispielwerte:

```text
Telefon vorhanden: +20
E-Mail vorhanden: +10
Rechnung hochgeladen: +25
Gewerbekunde: +20
Strom und Gas angefragt: +10
Monatlicher Abschlag > 150 Euro: +10
Jahresverbrauch > 5000 kWh: +10
Vertragsende innerhalb 3 Monate: +15
```

Maximalwert:

```text
100
```

Labels:

```text
0-49   cold
50-79  warm
80-100 hot
```

Wichtig:

Der Score muss erklärbar bleiben.

---

## 8. Implementierungsblöcke

## Block 1: Projekt- und Supabase-Grundlage

Ziel:

Projekt ist bereit für Datenbankarbeit.

Aufgaben:

```text
Supabase CLI prüfen
.env.local vorbereiten
Supabase Client vorbereiten
Migrationsstruktur prüfen
/docs/progress.md anlegen
```

Noch keine Tabellen außer eventuell notwendigen Basics.

---

## Block 2: Enums und Basistabellen

Ziel:

Grundlegende Enums und `profiles` erstellen.

Aufgaben:

```text
Enums für Rollen, Lead Status, Product Types, Customer Types
profiles Tabelle
updated_at Trigger-Funktion
```

---

## Block 3: Leads

Ziel:

Die zentrale Lead-Tabelle erstellen.

Aufgaben:

```text
leads Tabelle
lead_number
status
score
consents
marketing attribution
assigned_to
Indexes
```

---

## Block 4: Addresses und Energy Demands

Ziel:

Lead-Daten fachlich sauber trennen.

Aufgaben:

```text
addresses Tabelle
energy_demands Tabelle
Foreign Keys zu leads
optionale Felder
Indexes
```

---

## Block 5: Historie und Notizen

Ziel:

CRM-Nachvollziehbarkeit.

Aufgaben:

```text
lead_status_history
lead_notes
```

---

## Block 6: Documents

Ziel:

Dokument-Metadaten und Storage-Anbindung vorbereiten.

Aufgaben:

```text
documents Tabelle
document_type enum
Storage Bucket Konzept dokumentieren
```

---

## Block 7: Offers und Communications Log

Ziel:

Angebote und Kontaktverlauf vorbereiten.

Aufgaben:

```text
offers Tabelle
communications_log Tabelle
```

---

## Block 8: Row Level Security

Ziel:

Sicherheit und Rollenrechte vorbereiten.

Aufgaben:

```text
RLS aktivieren
Policies für Mitarbeiter/Admins planen
Service Role nur serverseitig verwenden
```

Wichtig:

RLS erst sauber planen, dann aktivieren.

---

## 9. Nicht-Ziele für die erste Datenbankrunde

Nicht umsetzen:

```text
PDF-Generierung
E-Mail-Versand
vollständige API-Routen
Dashboard-Statistiken
KI-Agenten
Ollama
OpenAI API
komplexe Tarifvergleiche
Bankdaten
Provisionen
```

---

## 10. Arbeitsregeln für Claude Code

Claude Code soll immer:

1. zuerst den aktuellen Plan lesen
2. dann einen kurzen Schrittplan erstellen
3. auf Bestätigung warten
4. nur den freigegebenen Block implementieren
5. keine zusätzlichen Features bauen
6. keine großen Refactorings ohne Zustimmung machen
7. nach jedem Block eine Zusammenfassung geben
8. `docs/progress.md` aktualisieren

---

## 11. Arbeitsregeln für Codex

Codex ist standardmäßig Reviewer.

Codex soll:

1. keine Dateien ändern
2. keine Implementierung starten
3. Risiken nennen
4. SQL-Constraints prüfen
5. Sicherheitsprobleme prüfen
6. Supabase-Best-Practices prüfen
7. konkrete Verbesserungsvorschläge geben
8. nur coden, wenn ausdrücklich erlaubt

---

## 12. Erste konkrete Aufgabe

Die erste Aufgabe ist nicht die komplette Datenbank.

Die erste Aufgabe ist:

```text
Block 1: Projekt- und Supabase-Grundlage prüfen und vorbereiten.
```

Danach folgt:

```text
Block 2: Enums und profiles.
```

Dann erst:

```text
Block 3: leads.
```

---
