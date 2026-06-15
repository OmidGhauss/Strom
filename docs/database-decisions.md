# Database Decisions – Energievermittlung CRM

## profiles.id vs. profiles.auth_user_id

`profiles` hat zwei Identifiers:

- `auth_user_id` (uuid): Fremdschlüssel auf `auth.users.id` – identifiziert den Auth-Account.
- `id` (uuid): Eigener Primärschlüssel der Tabelle.

Warum `id` zusätzlich?

Supabase Auth (`auth.users`) ist ein externes System, das wir nicht vollständig kontrollieren.
Ein eigener PK entkoppelt alle Business-Tabellen (z. B. `lead_notes.created_by → profiles.id`)
von Auth-Implementierungsdetails. Wenn ein Auth-Account ersetzt oder migriert wird, bleibt
`profiles.id` stabil und alle Verweise bleiben gültig.

---

## Mitarbeiter werden deaktiviert, nicht gelöscht

Mitarbeiter-Accounts werden nie aus der Datenbank gelöscht. Stattdessen wird `is_active = false`
gesetzt.

Warum?

Gelöschte Mitarbeiter würden Foreign-Key-Verweise aus `lead_notes.created_by`,
`lead_status_history.changed_by` und ähnlichen Spalten orphanen. Die Revisionsgeschichte
wäre nicht mehr vollständig lesbar.

`ON DELETE RESTRICT` auf `profiles.auth_user_id` verhindert außerdem das versehentliche
Löschen eines Auth-Accounts, solange ein Profil existiert. Das ist eine aktive Schutzmaßnahme.

Deaktivierung statt Löschung bedeutet: Der vollständige Verlauf bleibt erhalten, Dashboards
zeigen weiterhin die korrekten Autoren, und DSGVO-Löschanfragen werden als separater,
kontrollierter Prozess behandelt.

---

## product_type vs. customer_type

Diese Felder beschreiben zwei orthogonale Dimensionen eines Leads:

**product_type** – Welche Energieart wird angefragt?

| Wert          | Bedeutung                      |
|---------------|--------------------------------|
| `electricity` | Nur Strom                      |
| `gas`         | Nur Gas                        |
| `both`        | Strom und Gas in einem Auftrag |

`'business'` existiert **nicht** in `product_type`. Kundensegmente (Gewerbe,
Hausverwaltung usw.) sind ausschließlich Aufgabe von `customer_type`.

**customer_type** – Welcher Kundentyp ist der Lead?

| Wert                     | Bedeutung                               |
|--------------------------|-----------------------------------------|
| `private`                | Privatperson                            |
| `business`               | Gewerbliches Unternehmen                |
| `property_management`    | Hausverwaltung                          |
| `multi_location_company` | Unternehmen mit mehreren Standorten     |

Beide Felder beschreiben orthogonale Dimensionen. Ein Gewerbekunde, der Strom
anfragt, hat `customer_type = 'business'` und `product_type = 'electricity'`.

---

## documents – was sich ändern darf und was nicht

**Die Datei in Supabase Storage ist unveränderlich.** Ein hochgeladenes Dokument wird
nie ersetzt oder überschrieben — dafür gibt es keinen Mechanismus. Die Datei bleibt
nach dem Upload unverändert in Storage.

**Die Datenbankmetadaten sind editierbar.** Folgende Felder dürfen nach dem ersten
INSERT aktualisiert werden:

- `ocr_status`, `ocr_text`, `ocr_processed_at` — durch den asynchronen OCR-Worker
- `document_type` — manuelle Korrektur durch Mitarbeiter (z. B. `'other'` → `'invoice'`)

`updated_at` verfolgt, wann Metadaten zuletzt geändert wurden — nicht wann die Datei
geändert wurde (das passiert nie).

---

## Storage-Datei und DB-Eintrag sind entkoppelt

Die `documents`-Tabelle speichert nur Metadaten. Die Datei liegt in Supabase Storage.

**Supabase Storage löscht Dateien nicht automatisch**, wenn ein Datenbankeintrag entfernt
wird — auch nicht via `ON DELETE CASCADE`.

Konsequenz: Wenn ein Lead gelöscht wird (z. B. DSGVO-Löschung), müssen **zuerst**
alle zugehörigen Storage-Dateien durch Anwendungscode entfernt werden:

```typescript
// 1. Storage-Dateien löschen
const { data: docs } = await supabase
  .from('documents')
  .select('storage_path, storage_bucket')
  .eq('lead_id', leadId)

for (const doc of docs) {
  await supabase.storage.from(doc.storage_bucket).remove([doc.storage_path])
}

// 2. Erst danach den Lead löschen (CASCADE entfernt DB-Einträge)
await supabase.from('leads').delete().eq('id', leadId)
```

Wenn die Reihenfolge umgekehrt wird (Lead zuerst löschen), sind die Storage-Dateien
dauerhaft verwaist und nicht mehr referenzierbar — DSGVO-Problem.

---

## score und score_label – keine DB-Kopplung

`leads.score` (integer) und `leads.score_label` (enum) sind nicht per Datenbankconstraint
aneinander gekoppelt. Die Konsistenz liegt in der Anwendungslogik.

Entscheidung gegen DB-Kopplung:

- `GENERATED ALWAYS AS` würde manuelle Overrides blockieren. Ein Mitarbeiter soll
  einen Lead auf `'warm'` setzen können, auch wenn der berechnete Score noch bei 30
  liegt (z. B. nach einem vielversprechenden Telefonat).
- Ein `BEFORE UPDATE`-Trigger würde Threshold-Änderungen (z. B. `warm` ab 55 statt 50)
  zu einer Migration machen statt zu einer Code-Änderung.

API-Regel: Jeder Schreibzugriff auf `score` muss `score_label` atomar mitsetzen:

| score     | score_label |
|-----------|-------------|
| 0 – 49    | `cold`      |
| 50 – 79   | `warm`      |
| 80 – 100  | `hot`       |

Drift-Erkennung:
```sql
SELECT id, score, score_label FROM leads
WHERE (score <  50 AND score_label != 'cold')
   OR (score >= 50 AND score < 80 AND score_label != 'warm')
   OR (score >= 80 AND score_label != 'hot');
```

---

## product_type und energy_demands.energy_type – keine DB-Kopplung

Die Konsistenzregeln zwischen `leads.product_type` und den zugehörigen
`energy_demands`-Zeilen werden nicht per Datenbankconstraint erzwungen.
Die Regeln gelten auf API-Ebene.

API-Regeln beim Lead-Anlegen (innerhalb einer Transaktion):

| `leads.product_type` | Zu erstellende `energy_demands`-Zeilen         |
|----------------------|------------------------------------------------|
| `electricity`        | genau eine Zeile mit `energy_type = 'electricity'` |
| `gas`                | genau eine Zeile mit `energy_type = 'gas'`     |
| `both`               | zwei Zeilen: `electricity` **und** `gas`       |

Was die Datenbank trotzdem erzwingt (bereits implementiert):
- `UNIQUE (lead_id, energy_type)` verhindert doppelte Zeilen desselben Typs
- `energy_type` enum erlaubt nur `electricity` und `gas` — `'both'` ist dort unmöglich

Drift-Erkennung:
```sql
SELECT l.id, l.product_type, COUNT(e.id) AS demand_count
FROM leads l
LEFT JOIN energy_demands e ON e.lead_id = l.id
GROUP BY l.id, l.product_type
HAVING
  (l.product_type = 'electricity' AND COUNT(e.id) != 1) OR
  (l.product_type = 'gas'         AND COUNT(e.id) != 1) OR
  (l.product_type = 'both'        AND COUNT(e.id) != 2);
```

---

## ON DELETE CASCADE vs. RESTRICT

`addresses` und `energy_demands` verwenden `ON DELETE CASCADE` auf `leads(id)`.
`profiles` verwendet `ON DELETE RESTRICT` auf `auth.users(id)`.

Der Unterschied ist fachlich begründet:

- `profiles` ist eine eigenständige Entität (Mitarbeiter-Account). Mitarbeiter werden
  nie gelöscht, sondern deaktiviert. RESTRICT verhindert versehentliches Löschen.

- `addresses` und `energy_demands` sind existenziell vom Lead abhängig. Sie haben
  außerhalb des Leads keine Bedeutung. Wenn ein Lead gelöscht wird (z. B. DSGVO-
  Löschung), sollen alle zugehörigen Daten automatisch mitentfernt werden.

Dieselbe Regel gilt für alle weiteren Lead-abhängigen Tabellen:
`lead_status_history`, `lead_notes`, `documents`, `offers`, `communications_log`
→ alle verwenden `ON DELETE CASCADE`.

---

## Lead-Scoring: "Rechnung hochgeladen"

Der Scoring-Punkt "Rechnung hochgeladen: +25" wird **nicht** über
`energy_demands.meter_number IS NOT NULL` bewertet.

Quelle der Wahrheit ist die `documents`-Tabelle mit `document_type = 'invoice'`:

```
SELECT COUNT(*) > 0
FROM documents
WHERE lead_id = $1 AND document_type = 'invoice'
```

`meter_number` ist ein Datenpunkt, der aus der Rechnung extrahiert wird —
nicht der Nachweis, dass eine Rechnung vorliegt. Eine Rechnung kann existieren,
ohne dass `meter_number` bereits übertragen wurde.

---

## profiles.email – Denormalisierung

`profiles.email` ist eine Kopie aus `auth.users.email` und **nicht die Quelle der Wahrheit**.

Wenn ein Mitarbeiter seine E-Mail-Adresse in Supabase Auth ändert, wird `profiles.email`
**nicht automatisch synchronisiert**. Das Feld kann also veralten.

Quelle der Wahrheit: **immer `auth.users.email`**.

`profiles.email` existiert ausschließlich für den einfachen Lesezugriff in Listenansichten
und Dashboards, ohne Auth-Join. Vor dem Versand von E-Mails oder bei sicherheitsrelevanten
Operationen muss `auth.users.email` direkt abgefragt werden.
