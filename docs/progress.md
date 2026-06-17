# Progress – Energievermittlung CRM Backend

## Block 1: Projekt- und Supabase-Grundlage ✓

Abgeschlossen: 2026-06-15

### Erledigte Schritte

- [x] Next.js-Projekt angelegt (TypeScript, App Router, src/, ESLint, Tailwind)
- [x] Supabase CLI installiert (v2.106.0 via Homebrew)
- [x] `.env.local.example` angelegt
- [x] `.gitignore` korrigiert (`.env*.example` wird nicht mehr ausgeschlossen)
- [x] `@supabase/supabase-js` und `@supabase/ssr` installiert
- [x] `src/lib/supabase/client.ts` (Browser-Client) angelegt
- [x] `src/lib/supabase/server.ts` (Server-Client für API Routes) angelegt
- [x] `supabase init` ausgeführt → `supabase/config.toml` und `supabase/migrations/` vorhanden

### Noch offen

- [ ] `.env.local` muss manuell mit echten Supabase-Zugangsdaten befüllt werden
  (NEXT_PUBLIC_SUPABASE_URL und NEXT_PUBLIC_SUPABASE_ANON_KEY aus dem Supabase-Dashboard)

### Entscheidungen

- Supabase Client wird per `@supabase/ssr` erstellt, nicht direkt per `createClient()` aus `@supabase/supabase-js`
  → Grund: SSR-kompatibel für App Router (Cookie-basierte Sessions)

---

## Block 2: Enums und Basistabellen ✓

Abgeschlossen: 2026-06-15

### Erledigte Schritte

- [x] Migration erstellt: `supabase/migrations/20260615000001_block2_enums_and_profiles.sql`
- [x] Enums angelegt: `user_role`, `lead_status`, `product_type`, `customer_type`
- [x] `profiles` Tabelle mit eigenem PK (`id`) und `auth_user_id` FK
- [x] FK auf `auth.users.id` mit `ON DELETE RESTRICT` (kein CASCADE)
- [x] `updated_at` Trigger-Funktion `trigger_set_updated_at()` angelegt (wiederverwendbar)
- [x] Trigger `set_profiles_updated_at` an `profiles` gehängt
- [x] `docs/database-decisions.md` befüllt

### Entscheidungen

- `ON DELETE RESTRICT` statt CASCADE: Auth-Account kann nicht gelöscht werden, solange
  ein Profil existiert. Schutz vor versehentlichem Datenverlust.
- `profiles.id` (eigener PK) entkoppelt Business-Tabellen von `auth.users.id`.
- Mitarbeiter werden über `is_active = false` deaktiviert, nie gelöscht.
- `profiles.email` ist denormalisiert – Quelle der Wahrheit ist `auth.users.email`.

---

## Block 2b: product_type Enum Korrektur ✓

Abgeschlossen: 2026-06-15

### Erledigte Schritte

- [x] Migration erstellt: `supabase/migrations/20260615000002_block2b_fix_product_type_enum.sql`
- [x] `product_type` Enum neu erstellt ohne `'business'` (DROP + Recreate)
- [x] `docs/database-decisions.md` aktualisiert
- [x] `docs/backend-database-plan.md` aktualisiert (Abschnitt 6.2)

### Entscheidung

`'business'` gehört nicht in `product_type`. Energieart (Strom/Gas/beides) und
Kundensegment (Privat/Gewerbe) sind orthogonale Dimensionen. `customer_type`
trägt die Segmentinformation alleine.

---

## Block 3: leads-Tabelle ✓

Abgeschlossen: 2026-06-15

### Erledigte Schritte

- [x] Migration erstellt: `supabase/migrations/20260615000003_block3_leads.sql`
- [x] Enum `lead_score_label` angelegt: `cold`, `warm`, `hot`
- [x] Sequence `lead_number_seq` angelegt (START 1000)
- [x] `leads`-Tabelle mit allen Feldern gemäß finalem Plan
- [x] `lead_number` per DEFAULT-Expression erzeugt (kein Trigger nötig)
- [x] FK `assigned_to → profiles(id) ON DELETE SET NULL`
- [x] CHECK-Constraint `score >= 0 AND score <= 100`
- [x] Trigger `set_leads_updated_at` für `updated_at`
- [x] 4 Indizes angelegt (UNIQUE lead_number, status, assigned_to, created_at DESC)

### Entscheidungen

- `first_name`, `last_name`, `email` sind NOT NULL — ohne diese Felder ist ein Lead nicht arbeitsfähig
- `phone` ist nullable — E-Mail ist der Mindest-Kontaktkanal
- `privacy_consent` und `contact_consent` haben keinen Default — müssen explizit gesetzt werden
- UTM-Felder direkt in `leads` (1:1-Beziehung, kein Multi-Touch in V1)
- `lead_number` via Sequence + DEFAULT-Expression (kein Trigger)
- `score_label` als eigener Enum `lead_score_label` (konsistent mit anderen Enums)
- Indizes für `product_type`, `customer_type` und `(status, assigned_to)` werden erst bei nachgewiesenen Abfrageanforderungen ergänzt

---

## Block 4: addresses und energy_demands ✓

Abgeschlossen: 2026-06-15

### Erledigte Schritte

- [x] Migration erstellt: `supabase/migrations/20260615000004_block4_addresses_energy_demands.sql`
- [x] Enum `address_type` angelegt: `delivery`, `billing`, `contact`
- [x] Enum `energy_type` angelegt: `electricity`, `gas`
- [x] `addresses`-Tabelle mit UNIQUE `(lead_id, address_type)`, FK `ON DELETE CASCADE`
- [x] `energy_demands`-Tabelle mit UNIQUE `(lead_id, energy_type)`, FK `ON DELETE CASCADE`
- [x] CHECK `hot_water_with_gas IS NULL OR energy_type = 'gas'`
- [x] Trigger `set_addresses_updated_at` und `set_energy_demands_updated_at`
- [x] `docs/database-decisions.md` aktualisiert

### Entscheidungen

- `energy_type` ist ein eigener Enum (electricity, gas) — `product_type` wird nicht
  wiederverwendet, weil `'both'` in energy_demands fachlich falsch wäre
- ON DELETE CASCADE (nicht RESTRICT): Adressen und Energiedaten sind existenziell
  vom Lead abhängig und werden bei DSGVO-Löschung automatisch mitentfernt
- `country` DEFAULT `'DE'` — ausschließlich deutscher Energiemarkt
- `meter_number` bleibt nullable — kommt aus Rechnungen, nicht aus dem Formular
- Scoring-Punkt "Rechnung hochgeladen" wird über `documents`-Tabelle bewertet,
  nicht über `meter_number IS NOT NULL` (dokumentiert in database-decisions.md)

---

## Block 4c: Korrekturen nach Codex Review ✓

Abgeschlossen: 2026-06-15

### Erledigte Schritte

- [x] Migration erstellt: `supabase/migrations/20260615000005_block4c_profiles_email_unique.sql`
- [x] UNIQUE Constraint auf `profiles.email`
- [x] `docs/database-decisions.md` aktualisiert: score/score_label API-Regel
- [x] `docs/database-decisions.md` aktualisiert: product_type/energy_type API-Regel

### Entscheidungen

- `profiles.email UNIQUE` — konsistent mit `auth.users.email`, das in Supabase Auth
  bereits UNIQUE ist
- `score` und `score_label` werden nicht per DB gekoppelt — manuelle Overrides
  durch Mitarbeiter müssen möglich bleiben; API pflegt beide Felder atomar
- `product_type` und `energy_demands.energy_type` werden nicht per DB-Constraint
  verknüpft — Komplexität nicht gerechtfertigt für V1; API ist verantwortlich

---

## Block 5: lead_status_history und lead_notes ✓

Abgeschlossen: 2026-06-15

### Erledigte Schritte

- [x] Migration erstellt: `supabase/migrations/20260615000006_block5_lead_status_history_lead_notes.sql`
- [x] `lead_status_history` mit FK CASCADE (lead) und SET NULL (changed_by)
- [x] `lead_notes` mit FK CASCADE (lead) und RESTRICT (created_by)
- [x] Composite INDEX `(lead_id, created_at DESC)` auf beiden Tabellen
- [x] Kein `updated_at` auf `lead_status_history` — Einträge sind unveränderlich
- [x] `updated_at`-Trigger auf `lead_notes` via `trigger_set_updated_at()`

### Entscheidungen

- `lead_status_history` hat kein `updated_at` — Historieneinträge sind abgeschlossene
  Tatsachen und dürfen nie verändert werden
- `old_status` nullable — beim allerersten Statuswechsel (NULL → 'new') gibt es
  keinen Vorgängerstatus
- `changed_by` nullable — systemgenerierte Statuswechsel haben keinen menschlichen
  Urheber; ON DELETE SET NULL erhält den Historieneintrag auch wenn die
  Profil-Referenz verloren geht
- `created_by` in `lead_notes` NOT NULL + RESTRICT — eine Notiz hat immer einen
  Autor; Profil kann nicht entfernt werden solange Notizen existieren
- Statusänderungen werden ausschließlich durch Anwendungscode erzeugt (kein
  DB-Trigger), weil `changed_by` auf SQL-Ebene nicht verfügbar ist
- `lead_notes` sind editierbar (Tippfehler, Ergänzungen); Einschränkung auf den
  Autor ist RLS-Logik (Block 8)

---

## Block 6: Dokumentenmanagement ✓

Abgeschlossen: 2026-06-15

### Erledigte Schritte

- [x] Migration erstellt: `supabase/migrations/20260615000007_block6_documents.sql`
- [x] Enum `document_type` angelegt: `invoice`, `offer_pdf`, `contract_pdf`,
  `cancellation_confirmation`, `power_of_attorney`, `other`
- [x] `documents`-Tabelle mit allen Feldern
- [x] FK `lead_id → leads(id) ON DELETE CASCADE`
- [x] FK `uploaded_by → profiles(id) ON DELETE SET NULL`
- [x] UNIQUE `storage_path`
- [x] Composite INDEX `(lead_id, document_type)`
- [x] OCR-Felder als nullable Vorbereitung (`ocr_status`, `ocr_text`, `ocr_processed_at`)
- [x] `docs/database-decisions.md` aktualisiert: Storage/DB-Entkopplung dokumentiert

### Entscheidungen

- Kein `updated_at` — Dokumente sind unveränderliche Einträge; Korrekturen
  erfolgen durch Löschen und Neu-Hochladen
- `storage_bucket` als eigene Spalte — entkoppelt physische Storage-Struktur
  von der Datenbanklogik; DEFAULT `'documents'`
- `uploaded_by` nullable — systemgenerierte Dokumente haben keinen menschlichen Uploader
- OCR-Felder in V1 immer NULL — Vorbereitung ohne Implementierung
- Storage-Datei muss vor Lead-Löschung per Anwendungscode entfernt werden
  (CASCADE löscht nur den DB-Eintrag, nicht die Datei in Storage)

---

## Block 6b: documents updated_at Korrektur ✓

Abgeschlossen: 2026-06-15

### Erledigte Schritte

- [x] Migration erstellt: `supabase/migrations/20260615000008_block6b_documents_updated_at.sql`
- [x] `documents.updated_at timestamptz NOT NULL DEFAULT now()` ergänzt
- [x] Trigger `set_documents_updated_at` via `trigger_set_updated_at()` angelegt
- [x] `docs/database-decisions.md` aktualisiert: Datei unverändert, Metadaten editierbar

### Entscheidung

Die ursprüngliche Aussage "Dokumente sind unveränderlich" war zu weit gefasst.
Die Datei in Supabase Storage bleibt unveränderlich. Die Datenbankmetadaten
(OCR-Felder, document_type-Korrekturen) dürfen aktualisiert werden.
`updated_at` verfolgt ausschließlich Metadaten-Änderungen.

---

## Block 7: offers und communications_log ✓

Abgeschlossen: 2026-06-15

### Erledigte Schritte

- [x] Migration erstellt: `supabase/migrations/20260615000009_block7_offers_communications_log.sql`
- [x] Enum `offer_status`: `draft`, `sent`, `accepted`, `rejected`, `expired`, `superseded`
- [x] Enum `communication_type`: `email`, `call`, `sms`, `system`
- [x] Enum `communication_direction`: `inbound`, `outbound`, `internal`
- [x] Enum `communication_status`: `pending`, `success`, `failed`
- [x] Sequence `offer_number_seq` (START 1000, Format AN-YYYY-NNNNN)
- [x] `offers`-Tabelle mit offer_number DEFAULT-Expression
- [x] `offers`: FK CASCADE (lead), SET NULL (energy_demand, created_by, parent_offer, pdf_document)
- [x] `offers`: Composite INDEX `(lead_id, status)`, UNIQUE `offer_number`
- [x] `offers`: `updated_at`-Trigger
- [x] `communications_log`-Tabelle mit `offer_id` und `external_id`
- [x] `communications_log`: FK CASCADE (lead), SET NULL (offer, created_by)
- [x] `communications_log`: INDEX `(lead_id, created_at DESC)`, `updated_at`-Trigger
- [x] `docs/database-decisions.md` aktualisiert: Versionierung, Reporting, Energy-Type-Konsistenz, Direction-Semantik

### Entscheidungen

- `offer_status` ohne `created` — `draft` deckt diesen Zustand bereits ab
- `communication_type` ohne `note` — interne Notizen gehören in `lead_notes`
- `updated_at` auf `communications_log` — Status-Updates via Webhooks (Resend Delivery) erfordern Updates
- `offer_id` in `communications_log` — sofort nützlich für "Angebot X per E-Mail versendet"
- Versionsketten-Zyklen werden durch API verhindert (kein DB-Constraint möglich)
- `superseded`-Angebote dürfen nicht mehr akzeptiert werden (API-Validierung)

---

## Block 8: Row Level Security

### Planung abgeschlossen: 2026-06-15

Neue Dokumentationsdateien erstellt:

- [x] `docs/security-rls-plan.md` — vollständige RLS-Architektur
- [x] `docs/api-validation-rules.md` — Businessregeln, die die API erzwingen muss

### Planentscheidungen

- `profiles` UPDATE: admin-only — Employees dürfen ihr Profil nicht direkt updaten
- `leads` INSERT employee: WITH CHECK `assigned_to = current_profile_id()`
- Manager/Admin: Leads frei anlegen und zuweisen
- DELETE: ausschließlich admin auf allen Tabellen (außer eigene lead_notes)
- `lead_status_history` UPDATE: niemand — unveränderlich
- Storage V1: private bucket, Zugriff nur über API Routes und signed URLs
- Keine Storage-Bucket-Policies in Block 8 → Block 8b
- 5 SECURITY DEFINER Hilfsfunktionen geplant
- `profiles`-Policies verwenden `auth.uid()` direkt (keine Hilfsfunktionen) um Zirkularität zu vermeiden

### Implementierung ✓

Abgeschlossen: 2026-06-15

Migration: `supabase/migrations/20260615000010_block8_rls.sql`

### Erledigte Schritte

- [x] 5 SECURITY DEFINER Hilfsfunktionen angelegt
- [x] GRANT EXECUTE TO authenticated für alle Hilfsfunktionen
- [x] RLS auf allen 9 CRM-Tabellen aktiviert
- [x] 37 Policies gemäß Policy-Matrix angelegt

### Entscheidungen

- `profiles`-Policies verwenden `auth.uid()` direkt (keine Hilfsfunktionen)
  um Zirkuläre Referenz zu vermeiden
- `lead_notes` UPDATE/DELETE: `NOT is_manager_or_above()` stellt sicher,
  dass ausschließlich Employees eigene Notizen bearbeiten können
  (Manager-Einschränkung gemäß Policy-Matrix)
- `documents` UPDATE: Manager darf alle zugänglichen Dokument-Metadaten
  ändern; Spalten-Whitelist (keine storage_path, keine OCR-Felder für Manager)
  liegt in der API Route
- `lead_status_history`: kein UPDATE-Policy = kein UPDATE möglich
- Storage: V1 Service Role only, keine Storage-Bucket-Policies → Block 8b

---

## Block 9: Backend/API Foundation ✓

Abgeschlossen: 2026-06-15

### Next.js 16 Breaking Change (aus Docs-Prüfung)

- `middleware.ts` ist in Next.js 16 **deprecated** und heißt jetzt `proxy.ts`
- Die exportierte Funktion heißt `proxy` (nicht `middleware`)
- Dynamic-Route `params` ist eine Promise und muss mit `await params` gelesen werden
- `cookies()` aus `next/headers` ist async (bereits in Block 1 korrekt implementiert)

### Erledigte Schritte

- [x] `server-only` Package installiert (Build-Zeit-Absicherung für Admin-Client)
- [x] Ordnerstruktur für alle geplanten API Routes angelegt (`src/app/api/`)
- [x] `src/lib/supabase/admin.ts` — Service Role Client mit `server-only` Guard
- [x] `src/lib/api/errors.ts` — Error-Response-Helfer, Supabase-Error-Mapping
- [x] `src/lib/api/responses.ts` — `singleResponse`, `listResponse`, `noContentResponse`
- [x] `src/lib/api/auth.ts` — `requireAuth()` Helfer (gibt `profileId`, `role`, `authUserId`)
- [x] `src/lib/api/guards.ts` — alle Business Guards aus `docs/api-validation-rules.md`
- [x] `src/lib/validation/common.ts` — UUID-Schema, Pagination-Schema, Pagination-Helfer
- [x] `src/types/database.ts` — manuelle DB-Typen für alle 9 Tabellen + `Database`-Typ
- [x] `proxy.ts` (Projektroot) — Auth-Check für `/api/*` außer `/api/public/*`
- [x] `src/app/api/leads/route.ts` — `GET /api/leads` mit Auth, RLS, Pagination

### Korrekturen nach Codex Review (Block 9b)

- [x] `src/types/database.ts`: `LeadStatus` korrigiert — entspricht jetzt exakt dem DB-Enum aus der Migration
  (alte Werte wie `contacted`, `won`, `callback_requested` entfernt; korrekte Werte: `in_review`, `offer_created`, `contract_prepared` etc.)
- [x] `src/lib/api/auth.ts`: `import "server-only"` ergänzt
- [x] `.env.local.example`: `SUPABASE_SERVICE_ROLE_KEY=` mit Sicherheitshinweis ergänzt
- [x] `src/lib/api/errors.ts`: `console.error` in `handleSupabaseError` ergänzt (serverseitige Protokollierung ohne DB-Details an Client)

### Entscheidungen

- `middleware.ts` wurde **nicht** angelegt — Next.js 16 verwendet `proxy.ts` (Breaking Change)
- `proxy.ts` lädt Session via `@supabase/ssr` mit `request.cookies.getAll()` (nicht `next/headers`)
- `requireAuth()` in `auth.ts` ist die zweite Sicherheitsschicht im Route Handler (Proxy allein reicht nicht)
- Service Role Client (`admin.ts`) ist in Block 9 angelegt, aber für keinen Endpoint verwendet
- Zod v4 war bereits als transitive Dependency installiert (kein explizites `npm install` nötig)
- `database.ts` ist manuell gepflegt; wird durch `supabase gen types typescript` ersetzt sobald ein verbundenes Supabase-Projekt verfügbar ist

### Nicht in Block 9 (bewusst ausgelassen)

- `POST /api/public/leads` → nach Affiliate-V1-Datenblock (Multi-Table atomar via RPC)
- Alle weiteren Write-Endpoints (P1–P5) → Block 10+
- Lead-DELETE DSGVO-Prozess → Block 10
- Rate Limiting / Captcha → Pflicht vor Go-Live des Public Lead Submit
- Tests → als TODO dokumentiert, eigener Block

### TODOs (für spätere Blocks)

- [ ] RLS-Tests: Employee sieht nur eigene Leads, kein Kreuz-Lesezugriff
- [ ] API-Integration-Tests: `GET /api/leads` mit verschiedenen Rollen
- [ ] Guards-Unit-Tests: `computeScoreLabel`, `assertEmployeeCannotChangeAssignedTo` etc.
- [ ] Public Form E2E: erst wenn `POST /api/public/leads` existiert
- [ ] `supabase gen types typescript` → `src/types/database.ts` ersetzen

### Geplante Folge-Blocks

```
Block 9:   API Foundation + GET /api/leads             ✓
    ↓
Block 9a:  Affiliate V1 Datenmodell                    ✓
    ↓
Block ?:   Public Lead Submit – POST /api/public/leads
           mit atomarem Lead + energy_demands + lead_referrals via RPC
           + Rate Limiting / Captcha (Pflicht)
    ↓
Block ?:   Weitere interne CRM-Endpoints (P1–P5)
    ↓
Block ?:   Tests (RLS, API, E2E)
```

---

## Block 9a: Affiliate V1 Datenmodell ✓

Abgeschlossen: 2026-06-16

Planungsdokument: `docs/affiliate-v1-plan.md`
Migration: `supabase/migrations/20260615000011_block9a_affiliate_v1.sql`

### Erledigte Schritte

- [x] Migration `20260615000011_block9a_affiliate_v1.sql` erstellt
- [x] Tabellen `affiliates`, `affiliate_links`, `lead_referrals` angelegt
- [x] `referral_code` Constraints: UNIQUE + CHECK UPPERCASE + CHECK `^[A-Z0-9-]{3,32}$`
- [x] RLS auf allen 3 Tabellen aktiviert, 8 Policies angelegt
- [x] `src/types/database.ts` und `docs/security-rls-plan.md` ergänzt

### Entscheidungen

- `referral_code` immer UPPERCASE — API normalisiert, DB erzwingt per CHECK
- Employee sieht `lead_referrals` via `can_access_lead(lead_id)`, aber nicht `affiliates`/`affiliate_links`
- Keine `commissions`-Tabelle in V1 — reine Attribution
- Kein Pyramidensystem in V1
- ON DELETE CASCADE für `lead_referrals.lead_id` (DSGVO), RESTRICT für alle anderen FKs

---

## Block 10a: database.ts Synchronisierung ✓

Abgeschlossen: 2026-06-16

Erster Schritt von Block 10 (Public Lead Submit). Keine SQL-Migration, keine API Route.

### Abweichungen gefunden und korrigiert

| Typ | Abweichung | Korrektur |
|---|---|---|
| `Profile.full_name` | `string \| null` — DB ist `NOT NULL` | → `string` |
| `Lead` | fehlende Felder | `source: string \| null`, `data_transfer_consent: boolean \| null` ergänzt |
| `Address.zip_code` | falsche Feldbezeichnung | → `postal_code` |
| `Address` | fehlende Felder | `address_addition: string \| null`, `state: string \| null` ergänzt |
| `EnergyDemand` | 11 Felder fehlten | `consumption_known`, `household_size`, `living_area_sqm`, `heating_type`, `current_provider`, `current_tariff`, `monthly_payment`, `contract_end_date`, `cancellation_period_known`, `price_guarantee`, `market_location_id` ergänzt |
| `LeadNote.content` | falsche Feldbezeichnung — DB-Spalte heißt `note` | → `note` |
| `Document.mime_type` | nicht nullable — DB ist `NULL`-fähig | → `string \| null` |
| `Document.file_size_bytes` | nicht nullable — DB ist `bigint NULL` | → `number \| null` |

### Weitere Anpassungen

- `lead_notes.Update`: `Pick<LeadNote, "content">` → `Pick<LeadNote, "note">`
- `documents.Update`: `mime_type` und `file_size_bytes` in Whitelist aufgenommen
- Enums und Affiliate-Typen: keine Abweichungen gefunden

### Ergebnis

- `npx tsc --noEmit` — 0 Fehler, 0 Warnungen
- Keine anderen Quelldateien referenzieren die umbenannten Felder (`content`, `zip_code`)

---

## Block 10b: RPC submit_public_lead() ✓

Abgeschlossen: 2026-06-16

Planungsdokument: `docs/block10b-rpc-plan.md`
Migration: `supabase/migrations/20260615000012_block10b_submit_public_lead_rpc.sql`

### Erledigte Schritte

- [x] Funktion `submit_public_lead()` erstellt — `LANGUAGE plpgsql`, `SECURITY DEFINER`, `SET search_path = pg_catalog, public, pg_temp`
- [x] 3 Guards implementiert: `CONSENT_REQUIRED`, `ENERGY_DEMANDS_REQUIRED`, `ENERGY_DEMANDS_PRODUCT_TYPE_MISMATCH`
- [x] 5 atomare Writes: `leads` → `addresses` (opt.) → `energy_demands` → `lead_referrals` (opt.) → `lead_status_history`
- [x] `lead_status_history`: `old_status = NULL`, `new_status = 'new'`, `reason = 'public_lead_submit'`
- [x] referral_code Lookup innerhalb der RPC — silent fail bei ungültigem/inaktivem Code
- [x] `REVOKE EXECUTE FROM PUBLIC, anon, authenticated`
- [x] `GRANT EXECUTE TO service_role`
- [x] `npx tsc --noEmit` — 0 Fehler

### Entscheidungen

- Guard 3 zählt nach `energy_type`-Wert (nicht nach Array-Position) — Reihenfolge der Elemente ist irrelevant
- `assigned_to = NULL` hardcoded — öffentliche Leads starten immer unassigned
- `score = 0`, `score_label = 'cold'`, `status = 'new'` explizit gesetzt (DEFAULTs vorhanden, aber explizit für Klarheit)
- `country` fällt auf `'DE'` zurück wenn nicht im `p_address`-Objekt angegeben
- Keine Validierung innerhalb der RPC für Felder, die DB-Constraints (NOT NULL, CHECK, UNIQUE) oder API-Schicht (Zod) bereits abdecken

---

## Block 10c: POST /api/public/leads ✓

Abgeschlossen: 2026-06-16

Planungsdokument: `docs/block10c-api-plan.md`

### Neue Dateien

- [x] `src/app/api/public/leads/route.ts` — Route Handler (POST)
- [x] `src/lib/validation/public-lead.ts` — Zod Schema `PublicLeadSchema`
- [x] `src/lib/captcha/turnstile.ts` — Cloudflare Turnstile Verifikation
- [x] `src/lib/rate-limit/index.ts` — Upstash Redis Fixed Window Rate Limit

### Geänderte Dateien

- [x] `src/lib/api/errors.ts` — erweitert um P0001 (3 RPC Guards), 23502, 23514, 22P02
- [x] `src/types/database.ts` — `submit_public_lead` in `Database.Functions` ergänzt
- [x] `.env.local.example` — 4 neue Env Vars ergänzt
- [x] `package.json` — `@upstash/ratelimit`, `@upstash/redis`, `zod` (direkte Dep) hinzugefügt

### Ablauf der Route (Rate Limit → JSON → Zod → Turnstile → RPC)

1. IP aus `X-Forwarded-For` extrahieren
2. Rate Limit prüfen (5 Req/10 Min pro IP) → 429 + `Retry-After` bei Überschreitung
3. JSON parsen → 400 bei ungültigem Body
4. Zod validieren → 422 + `flatten()` Details bei Fehler
5. Turnstile verifizieren → 422 bei Captcha-Fehler
6. `adminClient.rpc("submit_public_lead", params)` — einzige DB-Operation
7. Fehler → `handleSupabaseError()` → passender HTTP-Status
8. Erfolg → 201 `{ data: { lead_id, lead_number } }`

### Entscheidungen

- `source = "website_form"` hardcoded in Route (nie vom Client gesteuert)
- `referral_code: ""` und Whitespace → `undefined` via `z.preprocess` (kein 422)
- Nur echte Referral-Codes werden gegen Regex `^[A-Z0-9-]{3,32}$` geprüft
- Rate Limit deaktiviert wenn `UPSTASH_REDIS_*` nicht gesetzt (Dev-Bypass)
- Turnstile deaktiviert wenn `TURNSTILE_SECRET_KEY` nicht gesetzt (Dev-Bypass)
- P0001 in `handleSupabaseError()` mappt auf `error.message` → 3 verschiedene 422-Meldungen
- 23514 (CHECK-Verletzung) und 22P02 (ungültiger Enum-Cast) → 422 (neu)
- `npx tsc --noEmit` — 0 Fehler

---

## Block 11: Interne CRM Lead APIs ✓

Abgeschlossen: 2026-06-17

Plan: Block-11-Architekturplan Rev. 3

### Neue Migration

- [x] `supabase/migrations/20260617000001_block11_change_lead_status_rpc.sql`
  - RPC `change_lead_status(p_lead_id, p_new_status, p_changed_by, p_reason?)` — SECURITY INVOKER
  - Atomar: UPDATE leads.status + INSERT lead_status_history in einer Transaktion
  - P0001 LEAD_NOT_FOUND als Sicherheitsnetz
  - REVOKE FROM PUBLIC, anon, authenticated / GRANT TO service_role

### Neue Dateien (7)

- [x] `src/lib/validation/lead.ts` — UpdateLeadSchema, UpdateLeadStatusSchema, LEAD_STATUS_VALUES
- [x] `src/app/api/leads/[id]/route.ts` — GET + PATCH
- [x] `src/app/api/leads/[id]/status/route.ts` — PATCH (mit RLS-Gate + No-op Guard)
- [x] `src/app/api/leads/[id]/status-history/route.ts` — GET (paginiert)
- [x] `src/app/api/leads/[id]/addresses/route.ts` — GET
- [x] `src/app/api/leads/[id]/energy-demands/route.ts` — GET
- [x] `src/app/api/leads/[id]/referral/route.ts` — GET (rollenbasiertes Branching)

### Geänderte Dateien (3)

- [x] `src/lib/api/guards.ts` — assertStatusTransitionAllowedForRole hinzugefügt
- [x] `src/lib/api/errors.ts` — P0001 LEAD_NOT_FOUND → 404 ergänzt
- [x] `src/types/database.ts` — change_lead_status in Functions ergänzt

### Implementierte Endpoints

| Method | Pfad | Beschreibung |
|--------|------|--------------|
| GET | /api/leads/[id] | Lead-Detail inkl. addresses[] + energy_demands[] (embedded) |
| PATCH | /api/leads/[id] | Stammdaten (Whitelist, ohne product_type) |
| PATCH | /api/leads/[id]/status | Statuswechsel atomar via RPC |
| GET | /api/leads/[id]/status-history | Statushistorie paginiert |
| GET | /api/leads/[id]/addresses | Alle Adressen (max. 3) |
| GET | /api/leads/[id]/energy-demands | Alle Energiebedarfe (max. 2) |
| GET | /api/leads/[id]/referral | Referral-Info (rollenabhängig) |

### Sicherheitslogik

- `requireAuth()` als erster Schritt in jedem Handler
- UUID-Validierung des `id`-Params vor DB-Zugriff → 404 bei ungültiger UUID
- User-aware Client (`createClient()`) für alle `.from()` Queries — RLS wirkt
- `adminClient.rpc("change_lead_status")` wird **ausschließlich** nach positivem RLS-Gate aufgerufen
- No-op Guard: body.status === currentStatus → früher Return, kein RPC, kein History-Eintrag
- Employee → terminale Statuse (completed/rejected/disqualified/lost) → 403 via assertStatusTransitionAllowedForRole
- Employee → assigned_to → 403 via assertEmployeeCannotChangeAssignedTo
- product_type nicht in UpdateLeadSchema (nur atomar mit energy_demands änderbar, späterer Block)
- Referral-Endpoint: rollenbasiertes Branching — Employee sieht is_referral only, Manager/Admin sehen Affiliate-Daten

### Entscheidungen

- SECURITY INVOKER explizit im RPC — kein SECURITY DEFINER (service_role bypassed RLS ohnehin)
- changed_by = profileId aus requireAuth(), nie aus dem Request-Body
- No-op Statuswechsel: 200 mit changed: false, kein History-Eintrag
- GET /api/leads/[id]: RLS + PGRST116 → 404 — kein Info-Leak ob Lead existiert
- Referral FK-Hint-Syntax: affiliate_links!affiliate_link_id(...) für deterministischen Join
- Adressen/Energy-Demands ohne Pagination (max. 3/2 Zeilen)

### Ergebnis

- `npx tsc --noEmit` → Exit 0, 0 Fehler

### Nicht in Block 11 (bewusst ausgelassen)

- product_type: isolierte Änderung ausgeschlossen — atomar mit energy_demands in späterem Block
- Notes-CRUD → Block 13
- Adress-/Energiebedarf-Bearbeitung → Block 12
- Lead-Löschung, Offers, Communications, Documents, E-Mail-Automationen → spätere Blöcke

---

## Block 12: Address & Energy Demand Management ✓

Abgeschlossen: 2026-06-17

Plan: Block-12-Architekturplan Rev. 2 + Ergänzungen (Race Case, EnergyDemand 404)

### Neue Dateien (2)

- [x] `src/app/api/leads/[id]/addresses/[addressType]/route.ts` — PATCH (try-UPDATE-then-INSERT)
- [x] `src/app/api/leads/[id]/energy-demands/[energyType]/route.ts` — PATCH (UPDATE-only)

### Geänderte Dateien (1)

- [x] `src/lib/validation/lead.ts` — AddressTypeSchema, UpdateAddressSchema, EnergyTypeSchema, UpdateEnergyDemandSchema ergänzt

### Implementierte Endpoints

| Method | Pfad | Beschreibung |
|--------|------|--------------|
| PATCH | /api/leads/[id]/addresses/[addressType] | Adresse anlegen oder partiell updaten |
| PATCH | /api/leads/[id]/energy-demands/[energyType] | Energiebedarf partiell updaten |

### Sicherheitslogik

- `requireAuth()` als erster Schritt
- UUID-Validierung + addressType/energyType Enum-Validierung vor DB-Zugriff
- User-aware Client für alle Queries — kein adminClient in Block 12
- RLS: addresses INSERT + UPDATE = `can_access_lead(lead_id)`
- RLS: energy_demands UPDATE = `can_access_lead(lead_id)`
- Unberechtigte Zugriffe: PGRST116 → 404 (kein Info-Leak)

### Entscheidungen

- **Echter PATCH für addresses:** try-UPDATE-then-INSERT statt `.upsert()` — `.upsert()` würde omitted fields auf NULL überschreiben
- **UPDATE-only für energy_demands:** kein Upsert — Anlegen von energy_demands nur via product_type-Endpoint (Block 12b), damit Konsistenz mit `leads.product_type` gewahrt bleibt
- `hot_water_with_gas` bei `energyType = "electricity"` → 422 (DB-CHECK vorab geprüft)
- TOCTOU beim Address-INSERT: 23505 unique_violation → 409 via `handleSupabaseError` (bereits gemappt), kein automatischer Retry in V1
- PGRST116 bei energy_demands UPDATE: explizit vor `handleSupabaseError` → `ApiErrors.notFound("EnergyDemand")`

### Nicht in Block 12 (bewusst ausgelassen)

- `PATCH /api/leads/[id]/product-type` → Block 12b (atomarer product_type + energy_demands Wechsel, Konfliktregeln bei bestehenden Offers noch offen)
- `DELETE /api/leads/[id]/addresses/[addressType]` → späterer Block
- `DELETE /api/leads/[id]/energy-demands/[energyType]` → späterer Block
- Notes, Documents, Offers, Communications, E-Mail-Automationen → spätere Blöcke

### Ergebnis

- `npx tsc --noEmit` → Exit 0, 0 Fehler

---

## Block 12b: Product Type Change RPC ✓

Abgeschlossen: 2026-06-17

Plan: Block-12b-Architekturplan Rev. 3

### Neue Dateien (2)

- [x] `supabase/migrations/20260618000002_block12b_change_lead_product_type_rpc.sql`
  - RPC `change_lead_product_type(p_lead_id, p_product_type)` — SECURITY INVOKER
  - Locking: SELECT leads FOR UPDATE + SELECT energy_demands FOR UPDATE
  - Offers-Conflict-Check nach Locking → OFFERS_REFERENCE_ENERGY_DEMAND → P0001
  - Atomar: UPDATE leads + DELETE energy_demands + INSERT energy_demands
  - RETURNS TABLE(lead_id, old_product_type, new_product_type, energy_types[])
  - REVOKE FROM PUBLIC, anon, authenticated / GRANT TO service_role
- [x] `src/app/api/leads/[id]/product-type/route.ts` — PATCH

### Geänderte Dateien (4)

- [x] `src/lib/validation/lead.ts` — UpdateProductTypeSchema + UpdateProductTypeInput
- [x] `src/lib/api/guards.ts` — assertManagerOrAbove (employee → 403)
- [x] `src/lib/api/errors.ts` — P0001 OFFERS_REFERENCE_ENERGY_DEMAND → 409
- [x] `src/types/database.ts` — change_lead_product_type in Functions

### Implementierter Endpoint

| Method | Pfad | Beschreibung |
|--------|------|--------------|
| PATCH | /api/leads/[id]/product-type | product_type + energy_demands atomar via RPC |

### Sicherheitslogik

- `requireAuth()` + `assertManagerOrAbove` → employee erhält 403 (vor RLS-Gate)
- UUID-Validierung vor DB-Zugriff
- User-aware RLS-Gate (createClient) vor adminClient.rpc
- No-op Guard: gleicher product_type → 200 changed:false, kein RPC
- adminClient.rpc ausschließlich nach positivem Gate

### Locking-Kette

- `SELECT leads … FOR UPDATE`: verhindert parallele product_type-Wechsel für denselben Lead
- `SELECT energy_demands … FOR UPDATE`: Offer-Insert-Race verhindert — FK-Prüfung des parallelen Inserts wartet auf COMMIT/ROLLBACK
  - Nach COMMIT: energy_demand gelöscht → Offer-FK-Prüfung schlägt fehl (23503)
  - Nach ROLLBACK: Lock freigegeben → Offer-Insert kann fortfahren
- Offers-Conflict-Check nach Locking: stabil, kein TOCTOU

### Entscheidungen

- SECURITY INVOKER explizit — kein SECURITY DEFINER (service_role bypassed RLS ohnehin)
- Hard block bei Offers-Conflict — kein Force-Flag, kein Status-Filter in V1
- energy_types deterministisch (electricity vor gas) — kein array_agg nach Änderungen
- Kein product_type-Audit-Trail in V1

### Nicht in Block 12b (bewusst ausgelassen)

- lead_product_type_history → späterer Block
- Force-Flag / Status-gefilterter Conflict-Check → späterer Block
- DELETE /addresses, DELETE /energy-demands → späterer Block
- Offers, Notes, Documents, E-Mail → spätere Blöcke

### Ergebnis

- `npx tsc --noEmit` → Exit 0, 0 Fehler

---

## Block 13: Lead Notes CRUD ✓

Abgeschlossen: 2026-06-17

Plan: Block-13-Architekturplan Rev. 1

### Neue Dateien (2)

- [x] `src/app/api/leads/[id]/notes/route.ts` — GET + POST
- [x] `src/app/api/leads/[id]/notes/[noteId]/route.ts` — PATCH + DELETE

### Geänderte Dateien (1)

- [x] `src/lib/validation/lead.ts` — CreateNoteSchema, CreateNoteInput, UpdateNoteSchema, UpdateNoteInput

### Implementierte Endpoints

| Method | Pfad | Beschreibung |
|--------|------|--------------|
| GET | /api/leads/[id]/notes | Notes paginiert (absteigend created_at) |
| POST | /api/leads/[id]/notes | Note erstellen (created_by serverseitig) |
| PATCH | /api/leads/[id]/notes/[noteId] | Note updaten (Autor/Admin) |
| DELETE | /api/leads/[id]/notes/[noteId] | Note löschen (Autor/Admin) → 204 |

### Sicherheitslogik

- `requireAuth()` als erster Schritt in jedem Handler
- UUID-Validierung für `id` (alle) und `noteId` (PATCH/DELETE) vor DB-Zugriff
- User-aware Client für alle Queries — kein adminClient, kein RPC
- `created_by` immer aus `auth.profileId`, nie aus dem Request-Body
- GET: unzugänglicher Lead → leere Liste (kein Info-Leak)
- POST: RLS INSERT (`can_access_lead`) reicht für V1 — kein separates Gate
- PATCH/DELETE: Note zuerst lesen → `assertNoteEditableByUser` → UPDATE/DELETE
- `.eq("id", noteId).eq("lead_id", id)` in allen noteId-Queries → kein Cross-Lead-Zugriff

### Autorprüfung (assertNoteEditableByUser — bereits in guards.ts)

| Rolle | PATCH/DELETE |
|-------|-------------|
| admin | immer erlaubt |
| manager | immer 403 — auch eigene Notes |
| employee | nur eigene Notes; fremde → 403 |

### Entscheidungen

- `note` (DB-Feld) konsequent verwendet — kein `content`
- `note` max 10000 Zeichen in Zod (kein DB-Limit, Schutz vor großen Payloads)
- DELETE gibt 204 zurück — bei TOCTOU (Note bereits gelöscht) gibt DELETE 0 rows ohne Fehler → 204 korrekt
- RLS UPDATE/DELETE als Sicherheitsnetz hinter Guard

### Nicht in Block 13 (bewusst ausgelassen)

- GET /api/leads/[id]/notes/[noteId] (einzelne Note)
- Bulk-Delete, Notes-Suche/Filter
- Documents, Offers, Communications → spätere Blöcke

### Ergebnis

- `npx tsc --noEmit` → Exit 0, 0 Fehler

---

## Block 14: Offers CRUD V1 ✓

Abgeschlossen: 2026-06-17

Plan: Block-14-Architekturplan Rev. 2

### Neue Dateien (2)

- [x] `src/app/api/leads/[id]/offers/route.ts` — GET + POST
- [x] `src/app/api/leads/[id]/offers/[offerId]/route.ts` — PATCH

### Geänderte Dateien (2)

- [x] `src/lib/validation/lead.ts` — CreateOfferSchema, CreateOfferInput, UpdateOfferSchema, UpdateOfferInput
- [x] `src/lib/api/guards.ts` — assertOfferEditableByUser

### Implementierte Endpoints

| Method | Pfad | Beschreibung |
|--------|------|--------------|
| GET | /api/leads/[id]/offers | Offers paginiert (absteigend created_at, Default 20) |
| POST | /api/leads/[id]/offers | Offer erstellen (status=draft, created_by serverseitig) |
| PATCH | /api/leads/[id]/offers/[offerId] | Draft-Offer bearbeiten |

### Sicherheitslogik

- `requireAuth()` als erster Schritt in jedem Handler
- UUID-Validierung für `id` (alle) und `offerId` (PATCH) vor DB-Zugriff
- User-aware Client für alle Queries — kein adminClient, kein RPC
- `created_by` immer aus `auth.profileId`, `status` immer `"draft"`, `lead_id` immer aus URL
- `version` nicht explizit gesetzt — DB DEFAULT 1
- GET: unzugänglicher Lead → leere Liste (kein Info-Leak)
- POST: RLS INSERT (`can_access_lead`) als Gate — kein separates Lead-Gate
- PATCH: Offer lesen → assertOfferEditableByUser → effektiven Zielzustand berechnen → Konsistenzcheck → UPDATE
- `.eq("id", offerId).eq("lead_id", id)` in allen offerId-Queries → kein Cross-Lead-Zugriff

### Guard-Logik (assertOfferEditableByUser)

| Bedingung | Ergebnis |
|-----------|----------|
| status ≠ draft (alle Rollen) | 409 Conflict |
| employee, eigene Offer (created_by = profileId) | ✓ |
| employee, fremde Offer | 403 Forbidden |
| manager/admin, draft-Offer | ✓ |

### energy_demand_id + energy_type Validierung

POST (wenn energy_demand_id != null):
- SELECT energy_demands WHERE id = energy_demand_id AND lead_id = id
- 0 rows → 422 "energy_demand_id gehört nicht zu diesem Lead"
- energy_demand.energy_type ≠ body.energy_type → 422 "energy_demand_id passt nicht zu energy_type"

PATCH (effektiver Zielzustand, wenn effectiveEnergyDemandId !== null):
- effectiveEnergyType = body.energy_type ?? offer.energy_type
- effectiveEnergyDemandId = "energy_demand_id" in body ? body.energy_demand_id : offer.energy_demand_id
- Prüfung auch wenn weder energy_type noch energy_demand_id geändert werden (Drift-Erkennung)
- energy_demand_id: null im Body → kein Check, Wert wird auf null gesetzt

### Entscheidungen

- Status-Endpoint (draft→sent etc.) → Block 14b
- Versioning (parent_offer_id, version++) → Block 14c
- DELETE → kein Endpoint (RLS admin-only als DB-Absicherung vorhanden)
- estimated_savings ohne min(0) — negative Werte semantisch erlaubt
- Bestehende Drift bei PATCH immer geprüft (Korrektheit vor Komfort)

### Nicht in Block 14 (bewusst ausgelassen)

- PATCH /status (Statuswechsel-Endpoint) → Block 14b
- Offer Versioning → Block 14c
- PDF-Generierung, E-Mail-Versand → später
- DELETE Offer → später

### Ergebnis

- `npx tsc --noEmit` → Exit 0, 0 Fehler

---

## Block 14c: Offer Versioning ✓

Abgeschlossen: 2026-06-17

Plan: Block-14c-Architekturplan Rev. 2

### Neue Dateien (2)

- [x] `supabase/migrations/20260618000003_block14c_create_offer_version_rpc.sql`
- [x] `src/app/api/leads/[id]/offers/[offerId]/version/route.ts` — POST

### Geänderte Dateien (4)

- [x] `src/lib/validation/lead.ts` — CreateOfferVersionSchema, CreateOfferVersionInput
- [x] `src/lib/api/errors.ts` — P0001: OFFER_NOT_FOUND, OFFER_NOT_VERSIONABLE, OFFER_FORBIDDEN
- [x] `src/types/database.ts` — create_offer_version Functions-Eintrag
- [x] `docs/progress.md` — Block 14c Eintrag

### Implementierter Endpoint

| Method | Pfad | Beschreibung |
|--------|------|--------------|
| POST | /api/leads/[id]/offers/[offerId]/version | Neue draft-Version erstellen |

### Versioning-Semantik

- Versionierbare Statuse: `sent`, `rejected`, `expired`
- Nicht versionierbar: `draft` (→ PATCH), `accepted`, `superseded` → 409
- Alte Offer: `status = superseded`
- Neue Offer: `status = draft`, `parent_offer_id = alte Offer`, `version = alte + 1`
- Feldauflösung: body override > alte Offer; `valid_until` und `notes` default null (nicht kopiert)
- parent_offer_id = direkter Vorgänger (Linked-List-Modell)

### Migration / RPC

- `create_offer_version` — SECURITY INVOKER, GRANT TO authenticated (kein service_role)
- `FOR UPDATE` Lock auf alte Offer → verhindert parallele Doppel-Versionierungen
- RPC prüft autoritativ: Status, Rolle/Ownership (`current_user_role()` + `current_profile_id()`)
- `created_by` der neuen Offer = `current_profile_id()` (nicht aus Parameter)
- P0001: OFFER_NOT_FOUND → 404, OFFER_NOT_VERSIONABLE → 409, OFFER_FORBIDDEN → 403

### Security / RLS

| Schicht | Prüfung |
|---------|---------|
| Route (fast-path) | UUID, Zod, status, employee ownership, energy_demand check |
| RLS offers:select | can_access_lead — Offer für fremde Leads nicht sichtbar |
| RLS offers:update | can_access_lead — supersede nur bei Lead-Zugriff |
| RLS offers:insert | can_access_lead — neue Offer nur bei Lead-Zugriff |
| RPC (autoritativ) | OFFER_NOT_FOUND, OFFER_NOT_VERSIONABLE, OFFER_FORBIDDEN |

Kein adminClient. Kein service_role. User-aware createClient() ruft RPC auf.

### Rollenregeln

| Rolle | Eigene Offers (sent/rejected/expired) | Fremde Offers |
|-------|---------------------------------------|---------------|
| employee | ✓ | ✗ 403 |
| manager | ✓ | ✓ |
| admin | ✓ | ✓ |

### Nicht in Block 14c (bewusst ausgelassen)

- offer_status_history
- PDF-Kopie / Neugenerierung
- E-Mail-Versand
- Renegotiation (accepted → neue Version)
- Automatisches Superseden anderer Versions bei Acceptance
- Admin Force Override

### Ergebnis

- `npx tsc --noEmit` → Exit 0, 0 Fehler

---

## Block 15: Communications Log CRUD ✓

Abgeschlossen: 2026-06-17

Plan: Block-15-Architekturplan Rev. 2

### Neue Dateien (2)

- [x] `src/app/api/leads/[id]/communications/route.ts` — GET + POST
- [x] `src/app/api/leads/[id]/communications/[communicationId]/route.ts` — PATCH + DELETE

### Geänderte Dateien (2)

- [x] `src/lib/validation/lead.ts` — CreateCommunicationSchema, CreateCommunicationInput, UpdateCommunicationSchema, UpdateCommunicationInput
- [x] `src/lib/api/guards.ts` — assertCommunicationEditableByUser

### Implementierte Endpoints

| Method | Pfad | Beschreibung |
|--------|------|--------------|
| GET | /api/leads/[id]/communications | Paginiert (Default 20), created_at DESC |
| POST | /api/leads/[id]/communications | Manual entry, created_by serverseitig |
| PATCH | /api/leads/[id]/communications/[communicationId] | status / content_summary / external_id |
| DELETE | /api/leads/[id]/communications/[communicationId] | Admin-only, 204 idempotent |

### system-Sperre

`communication_type` im CreateCommunicationSchema: `z.enum(["email", "call", "sms"])`.
`"system"` ist nicht erlaubt → Zod 422 bei manuellem POST.
System-Einträge sind für spätere automatische Prozesse reserviert.

### Lead-Gate (POST)

Vor offer_id-Check und INSERT: `SELECT id FROM leads WHERE id = id .single()`.
PGRST116 → 404 Lead (kein falsches 422 bei fehlendem Lead-Zugriff).
Trennt Lead-Zugriffsfehler (404) von offer_id-Fehlern (422).

### offer_id Cross-Lead-Check (POST)

Wenn `body.offer_id != null`:
`SELECT id FROM offers WHERE id = body.offer_id AND lead_id = id .single()`
→ PGRST116 / !data → 422 "offer_id gehört nicht zu diesem Lead"
Nur beim POST — offer_id ist nach Creation unveränderlich (nicht im UpdateCommunicationSchema).

### Rollenlogik

| Aktion | employee (eigen) | employee (fremd) | manager | admin |
|--------|-----------------|-----------------|---------|-------|
| GET | ✓ | ✓ | ✓ (alle) | ✓ (alle) |
| POST | ✓ | — | ✓ | ✓ |
| PATCH | ✓ | ✗ 403 | ✓ | ✓ |
| DELETE | ✗ 403 | ✗ 403 | ✗ 403 | ✓ |

Manager darf alle Communications bearbeiten (anders als Notes — Communications sind Team-Records).

### Guard (assertCommunicationEditableByUser)

- admin/manager → immer erlaubt
- employee, eigene Communication (created_by === profileId) → erlaubt
- employee, fremde / null created_by → 403

### Entscheidungen

- PATCH erlaubt nur: status, content_summary, external_id
- Gesperrte Felder (PATCH): offer_id, communication_type, direction, subject, created_by
- DELETE: 204 idempotent (auch bei 0 rows)
- Kein adminClient, kein RPC, keine Migration

### Nicht in Block 15 (bewusst ausgelassen)

- E-Mail-/SMS-Versand
- Webhook-Empfang (external_id Status-Updates)
- Automatische system-Einträge bei Lead-Statuswechseln
- system-type Schutz via service_role
- Soft-Delete
- Kommunikations-Templates
- Frontend/UI

### Ergebnis

- `npx tsc --noEmit` → Exit 0, 0 Fehler

---

## Block 16: Documents Metadata CRUD ✓

Abgeschlossen: 2026-06-17

Plan: Block-16-Architekturplan Rev. 3

### Neue Dateien (2)

- [x] `src/app/api/leads/[id]/documents/route.ts` — GET + POST
- [x] `src/app/api/leads/[id]/documents/[documentId]/route.ts` — PATCH + DELETE

### Geänderte Dateien (2)

- [x] `src/lib/validation/lead.ts` — CreateDocumentSchema, CreateDocumentInput, UpdateDocumentSchema, UpdateDocumentInput, MANUAL_DOCUMENT_TYPES
- [x] `src/lib/api/guards.ts` — assertDocumentEditableByUser (neu); DOCUMENT_IMMUTABLE_FIELDS um document_type erweitert

### Implementierte Endpoints

| Method | Pfad | Beschreibung |
|--------|------|--------------|
| GET | /api/leads/[id]/documents | Paginiert (Default 20), created_at DESC |
| POST | /api/leads/[id]/documents | Metadaten registrieren, storage_path serverseitig |
| PATCH | /api/leads/[id]/documents/[documentId] | file_name + OCR-Felder (Admin) |
| DELETE | /api/leads/[id]/documents/[documentId] | Admin-only, 204 idempotent |

### offer_pdf / contract_pdf Sperre

POST und PATCH: nur `invoice`, `cancellation_confirmation`, `power_of_attorney`, `other` erlaubt.
`offer_pdf` und `contract_pdf` sind für spätere systemgenerierte Prozesse reserviert (PDF-Pipeline, Contract-Pipeline).
Zod gibt 422 wenn ein gesperrter Typ in POST gesendet wird.
Im PATCH ist `document_type` vollständig immutable — 400 via assertDocumentImmutableFields.

### storage_path Generierung (POST)

Pfadschema: `{lead_id}/{document_type}/{documentId}.{ext}`

- `documentId = crypto.randomUUID()` serverseitig generiert
- Extension aus `file_name` (letzter Punkt) extrahiert, lowercase
- Kein Punkt oder leere Extension → 422 "file_name muss eine Dateiendung enthalten"
- Client gibt keinen `storage_path` an — nicht im Schema
- `storage_bucket` nicht im Schema — DB DEFAULT `'documents'`

### document_type Immutable-Regel

`document_type` ist nach Erstellung unveränderlich.
Begründung: `storage_path` kodiert `document_type` im Pfad. Ein PATCH würde Pfad und Typ dauerhaft auseinanderlaufen lassen.
Korrekturen erfolgen via Delete + Re-POST.
`assertDocumentImmutableFields` läuft auf rohem JSON VOR Zod-Parse — verhindert stilles Stripping.

### PATCH-Guard-Reihenfolge

1. `assertDocumentImmutableFields(raw)` → 400 (document_type, storage_path, storage_bucket, lead_id, uploaded_by)
2. Zod → 422
3. Empty-body → 400
4. SELECT document → 404
5. `assertDocumentEditableByUser(role, uploadedBy, profileId)` → 403 (Ownership)
6. `assertDocumentFieldsByRole(role, raw)` → 403 (mime_type/file_size_bytes alle; ocr_* non-admin)

assertDocumentFieldsByRole läuft auf `raw` (nicht `body`), damit mime_type/file_size_bytes 403 liefern,
auch wenn sie durch Zod-Strip aus `body` verschwunden wären.

### Rollenlogik

| Aktion | employee (eigen) | employee (fremd) | manager | admin |
|--------|-----------------|-----------------|---------|-------|
| GET | ✓ | ✓ | ✓ (alle) | ✓ (alle) |
| POST | ✓ (uploaded_by = self) | — | ✓ | ✓ |
| PATCH file_name | ✓ | ✗ 403 | ✓ | ✓ |
| PATCH ocr_* | ✗ 403 | ✗ 403 | ✗ 403 | ✓ |
| PATCH document_type | ✗ 400 | ✗ 400 | ✗ 400 | ✗ 400 |
| PATCH mime_type/file_size_bytes | ✗ 403 | ✗ 403 | ✗ 403 | ✗ 403 |
| DELETE | ✗ 403 | ✗ 403 | ✗ 403 | ✓ |

### Sicherheitsregeln

- lead_id immer aus URL, nie aus Body
- uploaded_by immer aus auth.profileId, nie aus Body
- storage_path serverseitig generiert — kein Cross-Path-Risiko
- document_type immutable — Pfad-Konsistenz dauerhaft garantiert
- kein adminClient, kein RPC, keine Migration

### Technische Schuld (bekannt)

**Storage-Orphan bei DELETE:**
`DELETE` entfernt nur den DB-Metadaten-Eintrag. Die Datei im Supabase Storage Bucket bleibt.
`offers.pdf_document_id → documents(id) ON DELETE SET NULL` wird automatisch gehandhabt (FK).
Storage-Cleanup (Datei aus Bucket löschen vor DB-DELETE) folgt im späteren Upload/Storage-Block.

### Entscheidungen

- kein adminClient, kein RPC, keine Migration
- Lead-Gate im POST (wie Block 15): PGRST116 → 404, kein falsches 422
- DELETE idempotent: 204 auch bei 0 rows
- Extension-Validation: syntaktisch (letzter Punkt); keine MIME-vs-Extension-Konsistenzprüfung

### Nicht in Block 16 (bewusst ausgelassen)

- Supabase Storage Upload / Download
- Signed URLs
- PDF-Generierung (offer_pdf, contract_pdf)
- OCR-Worker-Integration
- PATCH offers.pdf_document_id
- E-Mail-Versand, Automationen
- Frontend/UI

### Ergebnis

- `npx tsc --noEmit` → Exit 0, 0 Fehler

---

## Block 14b: Offer Status Workflow ✓

Abgeschlossen: 2026-06-17

Plan: Block-14b-Architekturplan Rev. 2

### Neue Dateien (1)

- [x] `src/app/api/leads/[id]/offers/[offerId]/status/route.ts` — PATCH

### Geänderte Dateien (2)

- [x] `src/lib/validation/lead.ts` — UpdateOfferStatusSchema, UpdateOfferStatusInput
- [x] `src/lib/api/guards.ts` — assertOfferStatusTransition

### Implementierter Endpoint

| Method | Pfad | Beschreibung |
|--------|------|--------------|
| PATCH | /api/leads/[id]/offers/[offerId]/status | Statuswechsel mit Compare-and-Set |

### State Machine

```
draft → sent
sent  → accepted | rejected | expired
accepted / rejected / expired / superseded → keine weiteren Wechsel
```

`draft` und `superseded` sind im Zod-Schema nicht erlaubt (kein Rollback, kein manuelles superseded).

### Rollenregeln

| Übergang | employee (eigene) | employee (fremd) | manager | admin |
|----------|-------------------|------------------|---------|-------|
| draft → sent | ✓ | ✗ 403 | ✓ | ✓ |
| sent → accepted | ✗ 403 | ✗ 403 | ✓ | ✓ |
| sent → rejected | ✓ | ✗ 403 | ✓ | ✓ |
| sent → expired | ✓ | ✗ 403 | ✓ | ✓ |

### Compare-and-Set (optimistic concurrency)

`.update({ status: body.status }).eq("status", currentStatus)`

PGRST116 beim READ → 404 Offer
PGRST116 beim UPDATE → 409 "Offer-Status wurde zwischenzeitlich geändert"

Parallele Requests auf demselben Offer: erster schreibt durch, zweiter findet keinen Match mehr → 409.

### Nicht in Block 14b (bewusst ausgelassen)

- offer_status_history → kommt mit Versioning (Block 14c)
- PDF-/E-Mail-Versand bei draft→sent → später
- Automatischer communications_log-Eintrag → Block 15
- superseded manuell setzen → Block 14c
- Admin Force Override → später

### Ergebnis

- `npx tsc --noEmit` → Exit 0, 0 Fehler
