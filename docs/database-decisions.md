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
