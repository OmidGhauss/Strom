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

| Wert          | Bedeutung                                    |
|---------------|----------------------------------------------|
| `electricity` | Nur Strom                                    |
| `gas`         | Nur Gas                                      |
| `both`        | Strom und Gas in einem Auftrag               |
| `business`    | Geschäftstarif (Energie-Art noch offen)      |

**customer_type** – Welcher Kundentyp ist der Lead?

| Wert                    | Bedeutung                              |
|-------------------------|----------------------------------------|
| `private`               | Privatperson                           |
| `business`              | Gewerbliches Unternehmen               |
| `property_management`   | Hausverwaltung                         |
| `multi_location_company`| Unternehmen mit mehreren Standorten    |

Beide Felder zusammen steuern Bearbeitungslogik und Lead-Scoring.
`product_type = 'business'` ist kein Synonym für `customer_type = 'business'` –
ersteres beschreibt die angebotene Produktkategorie, letzteres den Kundentyp.

---

## profiles.email – Denormalisierung

`profiles.email` ist eine Kopie aus `auth.users.email` und **nicht die Quelle der Wahrheit**.

Wenn ein Mitarbeiter seine E-Mail-Adresse in Supabase Auth ändert, wird `profiles.email`
**nicht automatisch synchronisiert**. Das Feld kann also veralten.

Quelle der Wahrheit: **immer `auth.users.email`**.

`profiles.email` existiert ausschließlich für den einfachen Lesezugriff in Listenansichten
und Dashboards, ohne Auth-Join. Vor dem Versand von E-Mails oder bei sicherheitsrelevanten
Operationen muss `auth.users.email` direkt abgefragt werden.
