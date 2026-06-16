# Block 10c – Public Lead Submit API Route

Version: v1 (Planung, noch nicht freigegeben)

---

## Ziel

`POST /api/public/leads` — einziger öffentlicher Endpoint.
Nimmt das Formular-Submit entgegen, validiert, verifiziert Captcha,
prüft Rate Limit und ruft die RPC `submit_public_lead()` via Service Role auf.
Keine direkten Tabellen-Writes. Keine sequentiellen JS-Inserts.

---

## 1. Datei und Route

```
src/app/api/public/leads/route.ts
```

Exportiert: `export async function POST(request: NextRequest)`

`/api/public/*` ist in `proxy.ts` bereits aus der Auth-Prüfung ausgenommen.
Kein `requireAuth()` — dieser Endpoint ist bewusst öffentlich.

---

## 2. Request Body Struktur

Der Client (Browser-Formular) sendet JSON:

```typescript
{
  // Kontakt — Pflicht
  first_name:  string,        // min 1, max 100
  last_name:   string,        // min 1, max 100
  email:       string,        // gültige E-Mail, max 255
  customer_type: 'private' | 'business' | 'property_management' | 'multi_location_company',
  product_type:  'electricity' | 'gas' | 'both',
  privacy_consent:  true,     // literal true — darf nicht false/null sein
  contact_consent:  true,     // literal true — RPC erzwingt IS NOT TRUE Guard
  
  // Kontakt — optional
  phone?:                string,
  data_transfer_consent?: boolean,
  
  // Adresse — optional (ganzes Objekt oder gar nicht senden)
  address?: {
    street?:           string,
    house_number?:     string,
    address_addition?: string,
    postal_code?:      string,
    city?:             string,
    state?:            string,
    country?:          string,    // Default 'DE' wenn fehlt
  },

  // Energiedaten — Objekte je nach product_type
  electricity?: {
    annual_consumption_kwh?: number,
    consumption_known?:      boolean,
  },
  gas?: {
    annual_consumption_kwh?: number,
    consumption_known?:      boolean,
    hot_water_with_gas?:     boolean,
  },

  // UTM-Tracking — optional
  utm_source?:   string,
  utm_medium?:   string,
  utm_campaign?: string,
  utm_term?:     string,
  utm_content?:  string,

  // Captcha — Pflicht (immer vom Frontend mitgesendet)
  turnstile_token: string,

  // Affiliate — optional
  referral_code?: string,
}
```

`source` wird **nicht** vom Client gesendet — die API Route setzt es
hardcoded auf `'website_form'`.

---

## 3. Zod Schemas

Neue Datei: `src/lib/validation/public-lead.ts`

```typescript
import * as z from "zod";

// Strom-Verbrauchsdaten (V1-Subset)
const ElectricityInput = z.object({
  annual_consumption_kwh: z.number().positive().max(9_999_999.99).nullable().optional(),
  consumption_known:      z.boolean().nullable().optional(),
});

// Gas-Verbrauchsdaten (V1-Subset)
const GasInput = z.object({
  annual_consumption_kwh: z.number().positive().max(9_999_999.99).nullable().optional(),
  consumption_known:      z.boolean().nullable().optional(),
  hot_water_with_gas:     z.boolean().nullable().optional(),
});

// Adresse — alle Felder optional, leere Strings werden vom RPC via NULLIF behandelt
const AddressInput = z.object({
  street:           z.string().trim().max(255).optional(),
  house_number:     z.string().trim().max(20).optional(),
  address_addition: z.string().trim().max(100).optional(),
  postal_code:      z.string().trim().max(10).optional(),
  city:             z.string().trim().max(100).optional(),
  state:            z.string().trim().max(100).optional(),
  country:          z.string().trim().length(2).optional(),
});

export const PublicLeadSchema = z.object({
  // Kontakt
  first_name:    z.string().trim().min(1).max(100),
  last_name:     z.string().trim().min(1).max(100),
  email:         z.string().trim().toLowerCase().email().max(255),
  phone:         z.string().trim().max(50).optional(),

  // Klassifizierung
  customer_type: z.enum(["private", "business", "property_management", "multi_location_company"]),
  product_type:  z.enum(["electricity", "gas", "both"]),

  // Adresse
  address: AddressInput.optional(),

  // Energiedaten
  electricity: ElectricityInput.optional(),
  gas:         GasInput.optional(),

  // Einwilligungen
  // z.literal(true): lehnt false, null und undefined ab — 422 vor RPC-Aufruf
  privacy_consent:       z.literal(true),
  contact_consent:       z.literal(true),
  data_transfer_consent: z.boolean().optional(),

  // UTM
  utm_source:   z.string().trim().max(255).optional(),
  utm_medium:   z.string().trim().max(255).optional(),
  utm_campaign: z.string().trim().max(255).optional(),
  utm_term:     z.string().trim().max(255).optional(),
  utm_content:  z.string().trim().max(255).optional(),

  // Captcha
  turnstile_token: z.string().min(1),

  // Affiliate
  referral_code: z
    .string()
    .trim()
    .transform((s) => s.toUpperCase())
    .pipe(z.string().regex(/^[A-Z0-9-]{3,32}$/))
    .optional(),

}).superRefine((data, ctx) => {
  // product_type ↔ Energiedaten Konsistenz (erste Schicht, RPC ist zweite Schicht)
  if (data.product_type === "electricity" || data.product_type === "both") {
    if (!data.electricity) {
      ctx.addIssue({
        code: "custom",
        path: ["electricity"],
        message: "Stromverbrauchsdaten für gewählten Produkttyp erforderlich",
      });
    }
  }
  if (data.product_type === "gas" || data.product_type === "both") {
    if (!data.gas) {
      ctx.addIssue({
        code: "custom",
        path: ["gas"],
        message: "Gasverbrauchsdaten für gewählten Produkttyp erforderlich",
      });
    }
  }
});

export type PublicLeadInput = z.infer<typeof PublicLeadSchema>;
```

### Validierungsregeln (Zusammenfassung)

| Feld | Regel |
|---|---|
| `first_name`, `last_name` | min 1, max 100, trim |
| `email` | gültige E-Mail, max 255, toLowerCase |
| `privacy_consent`, `contact_consent` | `z.literal(true)` — false/null → 422 |
| `referral_code` | trim → toUpperCase → Regex `^[A-Z0-9-]{3,32}$` |
| `turnstile_token` | min 1 (Pflicht, immer gesendet) |
| energy × product_type | superRefine: Objekte müssen zu product_type passen |

---

## 4. product_type → energy_demands Payload

Die Route-Handler-Datei enthält eine interne Hilfsfunktion
(keine eigene Datei — zu klein für eine Abstraktion):

```typescript
function buildEnergyDemands(
  productType: "electricity" | "gas" | "both",
  electricity?: PublicLeadInput["electricity"],
  gas?: PublicLeadInput["gas"],
) {
  const demands: Array<{
    energy_type: "electricity" | "gas";
    annual_consumption_kwh: number | null;
    consumption_known: boolean | null;
    hot_water_with_gas: boolean | null;
  }> = [];

  if (productType === "electricity" || productType === "both") {
    demands.push({
      energy_type: "electricity",
      annual_consumption_kwh: electricity?.annual_consumption_kwh ?? null,
      consumption_known:      electricity?.consumption_known ?? null,
      hot_water_with_gas:     null,
    });
  }

  if (productType === "gas" || productType === "both") {
    demands.push({
      energy_type: "gas",
      annual_consumption_kwh: gas?.annual_consumption_kwh ?? null,
      consumption_known:      gas?.consumption_known ?? null,
      hot_water_with_gas:     gas?.hot_water_with_gas ?? null,
    });
  }

  return demands;
}
```

`hot_water_with_gas` ist für electricity immer `null` — die DB-CHECK
`check_hot_water_gas_only` verbietet einen Wert bei electricity.

---

## 5. Address Payload

Ebenfalls interne Hilfsfunktion in der Route:

```typescript
function buildAddress(address?: PublicLeadInput["address"]) {
  if (!address) return null;
  return {
    street:           address.street           ?? null,
    house_number:     address.house_number     ?? null,
    address_addition: address.address_addition ?? null,
    postal_code:      address.postal_code      ?? null,
    city:             address.city             ?? null,
    state:            address.state            ?? null,
    country:          address.country          ?? "DE",
  };
}
```

Gibt `null` zurück wenn kein address-Objekt vorhanden → RPC überspringt
den addresses-Insert. Leere Strings überleben hier und werden im RPC via
`NULLIF` zu NULL normalisiert.

---

## 6. referral_code Verarbeitung

Zweistufig:

**Zod-Schicht:** `trim → toUpperCase → Regex-Prüfung`
Ungültiges Format → 422 vor jedem DB-Aufruf.

**RPC-Schicht:** `upper(trim(...))` + `IS NOT NULL AND <> ''`
Letztes Sicherheitsnetz. Ungültige/inaktive Codes: silent fail.

Der Wert aus `body.referral_code ?? null` wird direkt als `p_referral_code`
an die RPC übergeben. Kein zusätzlicher Lookup in der Route.

---

## 7. Turnstile Captcha

Neue Datei: `src/lib/captcha/turnstile.ts`

```typescript
// Keine `server-only` Deklaration nötig — wird nur in API Routes importiert.
// Die Route-Datei selbst ist server-only per Next.js App Router Convention.

export async function verifyTurnstile(token: string, ip: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;

  // Kein Secret konfiguriert → Dev/Test-Modus, Verifikation überspringen.
  if (!secret) return true;

  const response = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token, remoteip: ip }),
    }
  );

  if (!response.ok) return false;
  const result = await response.json() as { success: boolean };
  return result.success === true;
}
```

**Verhalten:**
- `TURNSTILE_SECRET_KEY` nicht gesetzt → `true` (Dev/Test-Bypass)
- Turnstile-API nicht erreichbar (HTTP-Fehler) → `false` → 422
- `success: false` → `false` → 422

---

## 8. Rate Limiting

Neue Datei: `src/lib/rate-limit/index.ts`

**Paket:** `@upstash/ratelimit` + `@upstash/redis` (müssen installiert werden)

```typescript
import { Ratelimit } from "@upstash/ratelimit";
import { Redis }     from "@upstash/redis";

let ratelimit: Ratelimit | null = null;

function getRatelimit(): Ratelimit | null {
  // Kein Redis konfiguriert → Dev/Test-Modus, Rate Limiting überspringen.
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return null;
  }
  if (!ratelimit) {
    ratelimit = new Ratelimit({
      redis:   Redis.fromEnv(),
      limiter: Ratelimit.fixedWindow(5, "10 m"),
    });
  }
  return ratelimit;
}

export async function checkRateLimit(
  identifier: string
): Promise<{ success: boolean; retryAfter: number }> {
  const rl = getRatelimit();
  if (!rl) return { success: true, retryAfter: 0 };

  const result = await rl.limit(identifier);
  return {
    success:    result.success,
    retryAfter: result.success ? 0 : Math.ceil((result.reset - Date.now()) / 1000),
  };
}
```

**Konfiguration:**
- Algorithmus: Fixed Window
- Limit: 5 Requests pro 10 Minuten pro IP
- Identifier: IP-Adresse aus `X-Forwarded-For` Header

**IP-Extraktion (in der Route):**
```typescript
function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "anonymous"
  );
}
```

Fallback `"anonymous"` statt `127.0.0.1` — vermeidet, dass alle lokalen
Dev-Requests dasselbe Rate-Limit-Bucket teilen.

---

## 9. Neue Umgebungsvariablen

In `.env.local.example` ergänzen:

```
# Rate Limiting (Upstash Redis) – optional in Dev, Pflicht in Produktion
# Ohne diese Variablen ist Rate Limiting deaktiviert.
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# Cloudflare Turnstile – optional in Dev, Pflicht in Produktion
# Ohne TURNSTILE_SECRET_KEY wird Captcha-Verifikation übersprungen.
TURNSTILE_SECRET_KEY=

# Für das Frontend (kein Geheimnis, darf NEXT_PUBLIC_ sein)
NEXT_PUBLIC_TURNSTILE_SITE_KEY=
```

### Neue Pakete (müssen installiert werden)

```
@upstash/ratelimit
@upstash/redis
```

`zod` ist aktuell als transitive Dependency vorhanden (v4.4.3).
Muss als direkte Dependency in `package.json` aufgenommen werden.

---

## 10. Error Mapping

### Erweiterung von handleSupabaseError() in src/lib/api/errors.ts

Der RPC gibt bei RAISE EXCEPTION folgende Fehlercodes zurück:
- `error.code = 'P0001'` für alle drei Custom Guards
- `error.message` enthält den sprechenden Exception-Namen

Neuer Case im `switch` vor dem `default`:

```typescript
case "P0001":
  if (error.message === "CONSENT_REQUIRED") {
    return ApiErrors.unprocessable("Einwilligung erforderlich");
  }
  if (error.message === "ENERGY_DEMANDS_REQUIRED") {
    return ApiErrors.unprocessable("Energieverbrauch erforderlich");
  }
  if (error.message === "ENERGY_DEMANDS_PRODUCT_TYPE_MISMATCH") {
    return ApiErrors.unprocessable(
      "Energiedaten passen nicht zum gewählten Produkttyp"
    );
  }
  return ApiErrors.unprocessable("Anfrage konnte nicht verarbeitet werden");
```

### Weitere neue Mappings (bisher nicht in handleSupabaseError)

| PG-ERRCODE | Bedeutung | Mapping |
|---|---|---|
| `23502` | NOT NULL-Verletzung | → 422 Unprocessable |

```typescript
case "23502":
  return ApiErrors.unprocessable("Pflichtfeld fehlt");
```

### Vollständige Fehler-Tabelle Route → Client

| Schicht | Fehler | HTTP |
|---|---|---|
| Rate Limit | Limit überschritten | 429 + Retry-After Header |
| JSON Parse | Ungültiger Body | 400 |
| Zod | Validierungsfehler | 422 + details |
| Turnstile | Captcha-Fehler | 422 |
| RPC P0001 CONSENT_REQUIRED | Einwilligung fehlt | 422 |
| RPC P0001 ENERGY_DEMANDS_REQUIRED | Energiedaten fehlen | 422 |
| RPC P0001 ENERGY_DEMANDS_PRODUCT_TYPE_MISMATCH | Typ-Mismatch | 422 |
| PG 23502 | NOT NULL verletzt | 422 |
| PG 23514 | CHECK verletzt (hot_water_with_gas) | 422 |
| PG 22P02 | Ungültiger Enum-Cast | 422 |
| PG 23505 | UNIQUE-Verletzung | 409 |
| Unbekannt | Interner Fehler | 500 |

---

## 11. Service Role Nutzung

```typescript
import { createAdminClient } from "@/lib/supabase/admin";

// In der POST-Funktion:
const adminClient = createAdminClient();

const { data, error } = await adminClient.rpc("submit_public_lead", {
  p_first_name:             body.first_name,
  p_last_name:              body.last_name,
  p_email:                  body.email,
  p_customer_type:          body.customer_type,
  p_product_type:           body.product_type,
  p_privacy_consent:        body.privacy_consent,
  p_contact_consent:        body.contact_consent,
  p_phone:                  body.phone                  ?? null,
  p_data_transfer_consent:  body.data_transfer_consent  ?? null,
  p_source:                 "website_form",
  p_utm_source:             body.utm_source             ?? null,
  p_utm_medium:             body.utm_medium             ?? null,
  p_utm_campaign:           body.utm_campaign           ?? null,
  p_utm_term:               body.utm_term               ?? null,
  p_utm_content:            body.utm_content            ?? null,
  p_address:                buildAddress(body.address),
  p_energy_demands:         buildEnergyDemands(body.product_type, body.electricity, body.gas),
  p_referral_code:          body.referral_code          ?? null,
});

if (error) return handleSupabaseError(error);

return Response.json({ data }, { status: 201 });
```

`createAdminClient()` wirft wenn `SUPABASE_SERVICE_ROLE_KEY` nicht gesetzt ist
(bereits in admin.ts implementiert). Das schlägt beim Start fehl, nicht erst
beim ersten Request — sicheres Fail-Fast-Verhalten.

---

## 12. Ablauf der POST-Funktion (final)

```
1. IP extrahieren (X-Forwarded-For)
2. Rate Limit prüfen → bei Überschreitung: 429 + Retry-After
3. JSON parsen → bei Fehler: 400
4. Zod validieren → bei Fehler: 422 + details
5. Turnstile verifizieren → bei Fehler: 422
6. buildEnergyDemands() + buildAddress() aufrufen
7. createAdminClient().rpc('submit_public_lead', params)
8. Fehler: handleSupabaseError(error) → passender HTTP-Status
9. Erfolg: Response.json({ data }, { status: 201 })
```

**Reihenfolge Rate Limit vor Zod:**
Rate Limiting erfordert einen Redis-Netzwerkaufruf, Zod ist rein in-memory.
Trotzdem Rate Limit zuerst: verhindert, dass Bots Zod-Fehlermeldungen zum
Debuggen ihres Payloads nutzen können.

---

## 13. Sicherheitsrisiken

| Risiko | Schwere | Mitigation |
|---|---|---|
| Rate Limit deaktiviert in Prod | Hoch | Deployment-Check: `UPSTASH_REDIS_REST_URL` muss gesetzt sein |
| Captcha deaktiviert in Prod | Hoch | Deployment-Check: `TURNSTILE_SECRET_KEY` muss gesetzt sein |
| IP-Spoofing via X-Forwarded-For | Mittel | Auf Vercel setzt die Plattform diesen Header vertrauenswürdig; akzeptiertes Risiko |
| NEXT_PUBLIC_TURNSTILE_SITE_KEY | Niedrig | Öffentlich — kein Geheimnis, kein Risiko |
| TURNSTILE_SECRET_KEY als NEXT_PUBLIC_ | Kritisch | Zod und ESLint verbieten NEXT_PUBLIC_ für Secrets nicht automatisch — Naming-Convention dokumentieren |
| Sehr großer Request Body | Niedrig | Next.js Standard-Limit 4 MB greift automatisch |
| Zod-Details im 422-Response | Niedrig | `parsed.error.flatten()` enthält keine Datenbankinfos, nur Feldnamen — akzeptiert |
| `anonymous` IP als Rate-Limit-Identifier | Mittel | Alle Anfragen ohne IP-Header teilen dasselbe Bucket — worst case: false positive für einen User |

---

## 14. Tests (dokumentiert als TODO, Block 10T)

### Zod-Schema Unit Tests

- Gültige Submission electricity → Erfolg
- Gültige Submission gas mit hot_water_with_gas
- Gültige Submission both
- `privacy_consent = false` → Validierungsfehler
- `contact_consent = false` → Validierungsfehler
- `product_type = 'electricity'` ohne `electricity`-Objekt → Validierungsfehler
- `product_type = 'both'` ohne `gas`-Objekt → Validierungsfehler
- `referral_code = ' solar2026 '` → `'SOLAR2026'` (trim + toUpperCase)
- `referral_code = 'INVALID CODE!'` (Sonderzeichen) → Validierungsfehler
- fehlender `turnstile_token` → Validierungsfehler

### API Route Integration Tests (mock RPC)

- 201 bei gültiger Submission ohne Adresse, ohne Referral
- 201 bei gültiger Submission mit Adresse
- 201 bei gültiger Submission mit aktivem referral_code
- 429 bei Rate-Limit-Überschreitung
- 400 bei ungültigem JSON
- 422 bei fehlgeschlagenem Captcha
- 422 bei Zod-Fehler
- 422 bei CONSENT_REQUIRED aus RPC
- 422 bei ENERGY_DEMANDS_PRODUCT_TYPE_MISMATCH aus RPC
- 500 bei unbekanntem Datenbankfehler

---

## 15. Was bewusst nicht in Block 10c gehört

| Thema | Begründung |
|---|---|
| E-Mail-Bestätigung | Kein E-Mail-System in V1 |
| Lead-Zuweisung | assigned_to = NULL, manuelle CRM-Operation |
| Dashboard | Eigener Block |
| Dokumentupload | Eigener Block |
| Affiliate-Dashboard | Eigener Block |
| Commissions/Pyramidensystem | Nicht in V1 |
| Alpha-Export | Eigener Block |
| Frontend-Formular | Eigener Block |
| Vollständige Testsuite | Block 10T |
| CORS-Header | Wenn Frontend und API gleiche Origin → nicht nötig; cross-origin → später |

---

## Zusammenfassung

### Benötigte Dateien

| Datei | Aktion |
|---|---|
| `src/app/api/public/leads/route.ts` | NEU |
| `src/lib/validation/public-lead.ts` | NEU |
| `src/lib/captcha/turnstile.ts` | NEU |
| `src/lib/rate-limit/index.ts` | NEU |
| `src/lib/api/errors.ts` | ERWEITERN (P0001 + 23502 Cases) |
| `.env.local.example` | ERWEITERN (3 neue Vars) |
| `package.json` | ERWEITERN (@upstash/ratelimit, @upstash/redis, zod direkt) |

### Benötigte Env Vars

| Variable | Pflicht in Prod | Geheim |
|---|---|---|
| `UPSTASH_REDIS_REST_URL` | ja | ja |
| `UPSTASH_REDIS_REST_TOKEN` | ja | ja |
| `TURNSTILE_SECRET_KEY` | ja | ja |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | ja | nein |

### Offene Fragen

**F1: contact_consent Semantik**
Die Zod-Schema erzwingt `z.literal(true)` für `contact_consent`.
Das bedeutet: das Frontend-Formular muss eine Checkbox für Kontakteinwilligung
als Pflichtfeld behandeln. Ist das die gewünschte UX/DSGVO-Entscheidung?

**F2: Upstash-Tier**
Upstash Redis ist kostenpflichtig über dem Free Tier (10.000 Requests/Tag).
Bei höherem Traffic muss ein passender Plan gewählt werden.

**F3: Turnstile Widget-Typ**
Cloudflare Turnstile bietet drei Widget-Typen: Managed, Non-Interactive, Invisible.
Welcher soll im Frontend verwendet werden? Beeinflusst die UX, nicht die API.
