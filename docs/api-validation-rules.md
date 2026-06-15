# API Validation Rules – Energievermittlung CRM

Diese Datei dokumentiert alle Businessregeln, die die Next.js API Routes
erzwingen müssen. RLS schützt den Datenzugriff — diese Regeln schützen
die Datenkonsistenz und Businesslogik.

---

## 1. profiles

### Welche Felder darf ein Employee über die API ändern?

Whitelist (serverseitige API Route prüft, dass nur diese Felder in der
PATCH-Payload enthalten sind):

```
full_name
```

Nicht erlaubt für Employee-eigene Updates:
```
role
is_active
email
auth_user_id
```

Begründung: Employee hat kein UPDATE-Recht auf profiles via RLS. Eigene
Profiländerungen laufen über eine dedizierte API Route (`PATCH /api/me`),
die die Payload auf die Whitelist-Felder filtert und dann Service Role
für den DB-Write verwendet.

### Admin-Operationen

- Admin darf `role` und `is_active` ändern (über Admin-API-Route)
- Admin darf neue Profile anlegen (Mitarbeiteranlage)
- Kein Löschen von Profilen (RESTRICT auf auth_user_id, Mitarbeiter werden deaktiviert)

---

## 2. leads

### assigned_to bei UPDATE

Employee darf `leads.assigned_to` nicht ändern.

Die API Route prüft bei jedem PATCH/PUT auf einen Lead:
- Wenn die Payload `assigned_to` enthält und der User ein Employee ist → 403

Manager und Admin dürfen `assigned_to` frei setzen.

### privacy_consent und contact_consent bei INSERT

Beide müssen `true` sein. Die API Route lehnt Submissions mit
`privacy_consent = false` oder `contact_consent = false` mit 422 ab.

Das öffentliche Lead-Formular (Service Role) prüft das ebenfalls bevor
es in die Datenbank schreibt.

### product_type ↔ energy_demands Konsistenz

Bei jedem Lead-INSERT muss die API in derselben Transaktion die passenden
`energy_demands`-Zeilen anlegen:

| leads.product_type | energy_demands-Zeilen |
|--------------------|----------------------|
| `electricity` | genau eine Zeile mit energy_type = 'electricity' |
| `gas` | genau eine Zeile mit energy_type = 'gas' |
| `both` | zwei Zeilen: 'electricity' und 'gas' |

Wenn `product_type` nachträglich geändert wird, muss die API die
`energy_demands`-Zeilen entsprechend anpassen.

---

## 3. offers

### superseded-Angebote nicht akzeptieren

Die API lehnt `status = 'accepted'` auf einem Angebot mit
`status = 'superseded'` mit 409 ab.

### status = 'superseded' automatisch setzen

Wenn eine neue Angebotsversion erstellt wird (über `parent_offer_id`):
1. API setzt das Elternangebot auf `status = 'superseded'`
2. API erstellt das neue Angebot mit `version = parent.version + 1`
3. Beide Operationen in einer Transaktion

### energy_type ↔ energy_demand Konsistenz

Wenn `offers.energy_demand_id` gesetzt wird:
- Die API prüft, dass `energy_demands.energy_type` mit `offers.energy_type` übereinstimmt
- Bei Abweichung → 422

### Versionsketten-Zyklen verhindern

Bevor `parent_offer_id` gesetzt wird, prüft die API die Kette:
- Ist das zu referenzierende Angebot selbst bereits ein Kind eines anderen Angebots?
- Würde das Setzen eine Kette erzeugen, die zur neuen Offer-ID zurückführt?
- Wenn ja → 409

Einfache Prüfung für V1: die API folgt der `parent_offer_id`-Kette nach oben
und prüft, ob `id` des neuen Angebots irgendwo in der Kette vorkommt.

### storage_path nicht nachträglich ändern

Ein einmal gespeicherter `documents.storage_path` darf nicht über die API
geändert werden. Die physische Datei in Storage kann nicht verschoben werden.
API prüft: wenn `storage_path` oder `storage_bucket` in einem PATCH enthalten
sind → 400.

---

## 4. score und score_label

Jeder Schreibzugriff auf `leads.score` muss `score_label` atomar mitsetzen.

Mapping:

| score | score_label |
|-------|-------------|
| 0–49 | 'cold' |
| 50–79 | 'warm' |
| 80–100 | 'hot' |

Die API berechnet `score_label` server-seitig aus dem neuen `score`-Wert
und schreibt beide Felder in einem einzigen UPDATE.

---

## 5. lead_status_history

Bei jedem Statuswechsel auf einem Lead muss die API in derselben Transaktion
einen `lead_status_history`-Eintrag schreiben:

```
INSERT INTO lead_status_history
  (lead_id, old_status, new_status, changed_by, reason)
VALUES
  ($lead_id, $old_status, $new_status, $current_profile_id, $optional_reason)
```

Wenn die Transaktion fehlschlägt, wird kein Status geändert und kein
History-Eintrag geschrieben.

System-generierte Statuswechsel (automatische Prozesse): `changed_by = NULL`.

---

## 6. Storage

### Upload-Validierung (vor dem Schreiben in DB und Storage)

Die API Route prüft bei jedem Upload:

**Erlaubte MIME-Types:**
```
application/pdf
image/jpeg
image/png
image/webp
```

**Maximale Dateigröße:** 10 MB (konfigurierbar)

**Dateiname-Sanitierung:** Originaler Dateiname wird nur in `documents.file_name`
gespeichert. Der `storage_path` verwendet ausschließlich UUID-basierte Pfade:
`{lead_id}/{document_type}/{document_id}.{ext}`

### DSGVO-Löschreihenfolge

Beim Löschen eines Leads (Admin-Operation) muss die API in dieser Reihenfolge vorgehen:

1. Alle `documents`-Zeilen für den Lead laden
2. Storage-Dateien für jeden Eintrag löschen:
   `supabase.storage.from(bucket).remove([storage_path])`
3. Lead löschen (CASCADE entfernt alle DB-Einträge automatisch)

Wenn Schritt 2 fehlschlägt, darf Schritt 3 nicht ausgeführt werden.
Verwaiste Storage-Dateien (DB-Eintrag gelöscht, Datei noch vorhanden)
sind ein DSGVO-Problem.

### Signed URLs

- Generierung: ausschließlich serverseitig über API Route
- TTL: maximal 60 Minuten
- Kein direkter Storage-Bucket-URL im Client

---

## 7. Documents Update Rules

> **Hinweis RLS vs. API:** Die RLS-Policy für `documents` UPDATE ist bewusst
> etwas breiter formuliert als die tatsächlich erlaubten Feldänderungen.
> RLS kann nur prüfen *ob* eine Zeile aktualisiert werden darf, nicht *welche Felder*.
> Jede API Route, die ein Document-UPDATE exponiert, **muss** die Payload
> strikt per Feld-Whitelist filtern. Ohne diese Whitelist darf kein
> Document-UPDATE-Endpoint veröffentlicht werden.

### Felder, die nie per normaler API geändert werden dürfen

Unabhängig von der Rolle — diese Felder sind nach dem INSERT unveränderlich:

```
storage_path
storage_bucket
lead_id
uploaded_by
```

Wenn eine PATCH-Payload eines dieser Felder enthält → 400.
Die physische Datei in Storage kann nicht verschoben werden.
`lead_id` und `uploaded_by` sind historische Fakten des Uploads.

### Feldberechtigungen nach Rolle

| Feld | employee | manager | admin | OCR Worker |
|------|----------|---------|-------|------------|
| `document_type` | ja (eigene Uploads) | ja | ja | nein |
| `file_name` | ja (eigene Uploads) | ja | ja | nein |
| `ocr_status` | nein | nein | ja | ja |
| `ocr_text` | nein | nein | ja | ja |
| `ocr_processed_at` | nein | nein | ja | ja |
| `mime_type` | nein | nein | nein | nein |
| `file_size_bytes` | nein | nein | nein | nein |
| `storage_path` | nein | nein | nein | nein |
| `storage_bucket` | nein | nein | nein | nein |
| `lead_id` | nein | nein | nein | nein |
| `uploaded_by` | nein | nein | nein | nein |

**Employee:** darf nur `document_type` und `file_name` eigener Uploads korrigieren.
RLS prüft `uploaded_by = current_profile_id()`. Die API prüft zusätzlich,
dass die Payload ausschließlich erlaubte Felder enthält.

**Manager:** darf `document_type` und `file_name` aller Dokumente zugänglicher
Leads korrigieren. Keine OCR-Felder.

**Admin:** darf zusätzlich OCR-Felder manuell korrigieren (z. B. nach fehlerhafter
automatischer Extraktion).

**OCR Worker:** läuft mit Service Role und setzt ausschließlich OCR-Felder.
Der Worker darf keine anderen Felder berühren — die API Route des OCR-Webhooks
muss die Payload auf `ocr_status`, `ocr_text`, `ocr_processed_at` begrenzen.

---

## 8. lead_notes Update und Delete Rules

Nur der **Autor** (`created_by = current_profile_id()`) oder ein **Admin**
darf eine Notiz bearbeiten oder löschen.

**Manager darf lead_notes weder updaten noch löschen** — auch nicht für Leads,
auf die der Manager Zugriff hat, und auch nicht eigene Notizen.

Begründung: Notizen gelten als persönliche Arbeitsaufzeichnungen des Autors.
Nur der Autor selbst oder ein Admin darf Notizen ändern oder entfernen.
Diese Einschränkung ist bewusst — ein Manager soll Notizen lesen, aber nicht
in Aufzeichnungen anderer eingreifen können.

Die API Route prüft vor jedem PATCH/DELETE auf `lead_notes`:
- Ist der User Admin → erlaubt
- Ist der User der Autor (`created_by = current_profile_id()`) → erlaubt
- Sonst → 403

RLS erzwingt dieselbe Regel auf DB-Ebene als zusätzliche Schutzschicht.

---

## 9. employee-spezifische Einschränkungen (Zusammenfassung)

Diese Regeln liegen außerhalb der RLS-Fähigkeiten und müssen die API erzwingen:

| Regel | Endpoint |
|-------|----------|
| Employee darf `leads.assigned_to` nicht ändern | PATCH /api/leads/:id |
| Employee darf eigene `profiles.role` nicht ändern | PATCH /api/me |
| Employee darf eigene `profiles.is_active` nicht ändern | PATCH /api/me |
| Employee darf `documents.storage_path` nicht ändern | PATCH /api/documents/:id |
| Employee darf nur eigene `documents` updaten | PATCH /api/documents/:id |
| Manager darf `lead_notes` nicht updaten oder löschen | PATCH/DELETE /api/leads/:id/notes/:id |
| Employee darf `lead_status_history` nicht updaten | kein UPDATE-Endpoint |
