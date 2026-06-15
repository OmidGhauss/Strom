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

## Block 4 und folgende

Status: ausstehend
