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
