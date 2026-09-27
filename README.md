# Voice AI Patient Registration

A phone-based AI intake coordinator that registers new U.S. patients through natural conversation, saves them to PostgreSQL, and exposes the records through a REST API and a small dashboard.

## Live demo

| | |
|---|---|
| **Phone number** | **+1 (628) 241-4325** |
| **API base URL** | https://api-production-fdac.up.railway.app |
| **Dashboard** | https://api-production-fdac.up.railway.app/dashboard |
| **Health** | https://api-production-fdac.up.railway.app/health |

No credentials are needed. The API is open (rate-limited) and only contains fictional data. Two seed patients exist: **Jane Doe** (phone `512-555-0142`, DOB `04/12/1985`) and **Carlos Rivera** (phone `305-555-0187`).

### Things to try on a call
- **Happy path:** give your details; the agent reads everything back and saves after you confirm. It then offers to book a first appointment.
- **Out-of-order answers:** "Hi, I'm Sam Lee, born June 3rd 1990, and I live in Austin."
- **Corrections:** "Actually, my last name is spelled D-A-V-I-S."
- **Invalid data:** a 7-digit phone number, or a birthday next year. The agent re-asks for just that field.
- **Returning caller:** give `512-555-0142` as your phone number. The agent says it already has a record for Jane Doe and offers to update it instead, after verifying DOB `04/12/1985`.
- **Start over:** "Can we start over?"
- **Spanish:** "Hablo español."
- **Second call:** call again, then check `GET /patients`. Earlier registrations are still there, since they are stored in Postgres.

---

## Architecture

```
 Caller ──PSTN──▶ Vapi (telephony · Deepgram STT · GPT-4.1 · ElevenLabs TTS)
                     │  tool calls / status / end-of-call report  (HTTPS webhook + shared secret)
                     ▼
            ┌──────────────────── Node.js service (Railway) ─────────────────────┐
            │  voice/webhook.js ──▶ voice/handlers.js ─┐                          │
            │                                           ├─▶ patients/service.js ──▶ patients/repository.js ─┐
            │  REST  /patients  ─▶ patients/routes.js ──┘      (validation)                                 │
            │  /dashboard (static HTML reading the REST API)                                                │
            └───────────────────────────────────────────────────────────────────────────── PostgreSQL ◀────┘
```

**Separation of concerns**

| Layer | Location | Responsibility |
|---|---|---|
| Telephony / speech | Vapi (hosted) | Phone number, STT, TTS, turn-taking, barge-in, LLM orchestration |
| Conversation logic | `src/voice/prompt.js`, `src/voice/tools.js` | System prompt and tool schemas (what the LLM knows and can do) |
| Voice adapter | `src/voice/webhook.js`, `src/voice/handlers.js` | Only place that knows Vapi's payload shapes; maps tool calls to services |
| Domain / validation | `src/patients/validation.js`, `src/patients/service.js` | Single source of truth for rules, shared by the REST API **and** the voice agent |
| Data access | `src/*/repository.js`, `src/db/schema.sql` | Parameterised SQL, schema with constraints |
| HTTP API | `src/patients/routes.js`, `src/http/*` | REST resources, envelope, status codes |

The voice agent calls the **same service layer** as `POST /patients` (the spec allows either). This removes an HTTP hop inside the same process, and validation can't drift between the two paths.

### Tech stack and why

| Choice | Why |
|---|---|
| **Vapi** | Handles phone numbers, streaming STT/TTS, interruption handling, and tool calling. That leaves the 3 hours for prompt design, data modelling, and resilience. It includes free U.S. numbers. |
| **GPT-4.1** (via Vapi) | Reliable function calling and instruction following at low voice latency. Configurable via `VAPI_MODEL`. |
| **Deepgram nova-3 `multi`** | Fast streaming STT that handles English/Spanish code-switching, needed for the "Hablo español" case. |
| **ElevenLabs turbo v2.5** | Natural-sounding, multilingual, low time-to-first-audio. |
| **Node 20 + Express 5** | Small surface; Express 5 forwards async errors to the error handler natively. |
| **PostgreSQL** | Real types (`UUID`, `DATE`, `TIMESTAMPTZ`, `JSONB`), CHECK constraints, partial indexes. Railway-managed with a persistent volume. |
| **PGlite** for local dev/tests | Embedded WASM Postgres: same SQL and constraints as production, zero setup, and in-memory for tests. |
| **Railway** | Always-on (no cold starts, which would time out voice webhooks), managed Postgres, one-command deploys. |

---

## Data model

`src/db/schema.sql` is idempotent and runs on every boot.

**patients** covers every field from the spec, plus `deleted_at` for soft deletes:
- `patient_id UUID DEFAULT gen_random_uuid()`, `created_at` / `updated_at TIMESTAMPTZ` (a trigger maintains `updated_at`).
- CHECK constraints mirror the app validators:
  - names: letters, spaces, hyphens, and apostrophes
  - DOB: from 1900-01-01 up to today
  - `sex` enum
  - 10-digit phone numbers with a valid area code
  - 2-letter uppercase state
  - ZIP / ZIP+4 regex
  - email shape
  - alphanumeric member ID
- Partial indexes on `phone_number`, `lower(last_name)`, and `date_of_birth` `WHERE deleted_at IS NULL`.

**calls** (bonus: transcripts) has one row per phone call:
- caller number, outcome (`registered` / `updated` / `incomplete` / `save_failed`)
- Vapi summary, full transcript
- `collected_data JSONB`: the exact payload the agent tried to save
- linked `patient_id`

**appointments** (bonus: scheduling) is a mock single-provider calendar. A unique partial index prevents double-booking a slot.

Normalisation happens on input:
- `"(512) 555-0100"` → `5125550100`
- `"California"` → `CA`
- `"787011234"` → `78701-1234`
- `"f"` → `Female`

Dates are accepted as `MM/DD/YYYY` or ISO and always **returned as `MM/DD/YYYY`**.

---

## REST API

Every response uses the envelope `{ "data": ..., "error": null }`. List responses add `meta: { total, limit, offset }`. Errors look like `{ "data": null, "error": { "code", "message", "details"? } }`.

| Method | Path | Notes |
|---|---|---|
| GET | `/patients` | Filters: `?last_name=` (case-insensitive), `?date_of_birth=` (MM/DD/YYYY or YYYY-MM-DD), `?phone_number=` (any format). Pagination: `?limit=` (≤200), `?offset=`. |
| GET | `/patients/:id` | 400 if not a UUID, 404 if missing or soft-deleted. |
| POST | `/patients` | 201 + `Location` header; 422 with per-field `details`. |
| PUT | `/patients/:id` | Partial update; required fields can't be cleared, optional fields can be cleared with `null`. |
| DELETE | `/patients/:id` | Soft delete (sets `deleted_at`); the record then disappears from reads. |
| GET | `/patients/:id/calls` | Call transcripts linked to the patient. |
| GET | `/patients/:id/appointments` | Booked appointments. |
| GET | `/calls` | 50 most recent calls, including incomplete ones. |
| GET | `/health` | Checks DB connectivity. |
| POST | `/vapi/webhook` | Vapi server messages; requires the `x-vapi-secret` header. |

Status codes:
- **400**: malformed JSON, non-object body, bad UUID, or bad query parameter.
- **422**: well-formed body with invalid field values.
- **401**: bad webhook secret or API key.
- **404**: unknown patient or route.
- **500**: unexpected errors, logged and returned without internals.

```bash
B=https://api-production-fdac.up.railway.app
curl "$B/patients?last_name=doe"
curl -X POST $B/patients -H 'content-type: application/json' -d '{
  "first_name":"Ana","last_name":"Lopez","date_of_birth":"02/14/1988","sex":"Female",
  "phone_number":"(617) 555-0199","address_line_1":"10 Beacon St","city":"Boston",
  "state":"MA","zip_code":"02108"}'
curl -X PUT $B/patients/<id> -H 'content-type: application/json' -d '{"city":"Cambridge"}'
curl -X DELETE $B/patients/<id>
```

---

## Voice agent design

The full system prompt is in **`src/voice/prompt.js`**, with a header comment explaining each design decision. The whole assistant (model, voice, STT, tools, timeouts) is defined in **`src/voice/assistant.js`** and pushed to Vapi with `npm run setup:vapi`, so it is versioned with the code rather than hand-edited in a dashboard.

**Prompt principles**
- **Written for speech:** one or two sentences per turn, no lists or markdown, and explicit rules for *saying* phone numbers (3-3-4 digit groups), dates, and spellings (D-A-V-I-S).
- **A checklist, not a script:** the agent has a preferred order but captures out-of-order and multi-field answers without re-asking, so it feels like a person rather than an IVR menu.
- **Validates as it goes:** rules like "no future DOB" and "10 digits" are in the prompt, so the agent re-prompts immediately for the specific field. The server re-validates on save and returns per-field errors as a backstop.
- **Hard gates:**
  - Read everything back and get an explicit "yes" before `register_patient`.
  - Never claim success without a `saved` tool result.
  - Never reveal stored data of an existing patient beyond their name.
- **Handles corrections, start-over, early hang-up, medical questions (no advice; 911 for emergencies), "are you a robot?" (honest), and language switching.**

**Tools** (`src/voice/tools.js`), implemented in `src/voice/handlers.js`:

| Tool | Purpose |
|---|---|
| `find_patient_by_phone` | Duplicate detection right after the phone number is collected. Returns only names + IDs. |
| `register_patient` | Creates the patient after confirmation. Returns `saved` / `invalid` (with per-field errors) / `error`. |
| `update_patient` | Returning-caller update. Requires `date_of_birth_verification` to match the stored DOB. |
| `get_appointment_slots`, `book_appointment` | Bonus: mock scheduling after registration. |
| `endCall` (built in) | Hangs up gracefully after the goodbye. |

### Edge cases and resilience

| Scenario | Behaviour |
|---|---|
| Invalid DOB / phone / ZIP | The prompt catches it immediately; the server returns field-specific 422 details if it slips through. The agent re-asks for only that field. |
| DB write fails | The handler retries once, then returns `status: "error"`. The agent apologises, retries once, and then tells the caller the office will call back. It never goes silent or claims success. The payload is also stored on the call record and in logs so staff can recover it. |
| Call drops mid-intake | Nothing half-finished is written to `patients`. Vapi's end-of-call report still arrives, so the transcript and summary are stored in `calls` with `outcome = incomplete` for follow-up. |
| Caller wants to start over | The prompt says to discard collected data and restart from the name. |
| Caller corrects a field after read-back | Only that field is updated and re-confirmed; the whole list isn't re-read. |
| Silence | Idle prompts ("Are you still there?"), then the call ends after 45s of silence. |
| Returning caller | Offers an update instead of a duplicate, with DOB verification. A family member sharing the number can decline and register separately. |
| Forged webhooks | The `x-vapi-secret` shared secret is checked with a constant-time comparison. |

---

## Running locally

```bash
nvm use 20            # Node >= 20
npm install
cp .env.example .env  # defaults work as-is
npm run dev           # http://localhost:3000/dashboard  (embedded Postgres in ./data)
npm test              # 26 tests: validation, REST API, voice webhook (in-memory Postgres)
```

Set `DATABASE_URL` to use a real Postgres instead of the embedded one.

To connect a phone number to your local server, expose it with a tunnel such as `ngrok http 3000`, then run:
```bash
VAPI_API_KEY=... PUBLIC_BASE_URL=https://<tunnel-host> npm run setup:vapi
```
The script creates or updates the assistant and provisions (or reuses) a free Vapi U.S. number bound to it. It is safe to re-run.

### Deploying (Railway)
```bash
railway init && railway add -d postgres
railway add -s api -v 'DATABASE_URL=${{Postgres.DATABASE_URL}}' -v VAPI_WEBHOOK_SECRET=<random>
railway up -s api && railway domain
VAPI_API_KEY=... PUBLIC_BASE_URL=https://<railway-domain> npm run setup:vapi
```

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | prod | Postgres connection string. If unset, embedded PGlite is used. |
| `PGLITE_DIR` | no | Data directory for embedded Postgres (default `./data/pglite`). |
| `VAPI_WEBHOOK_SECRET` | yes (prod) | Shared secret that Vapi sends as `x-vapi-secret`. |
| `PORT` | no | Default 3000 (Railway sets it). |
| `SEED_DEMO_DATA` | no | `false` to skip the 2 demo patients. |
| `API_KEY` | no | If set, `/patients` and `/calls` require `x-api-key`. |
| `CLINIC_NAME`, `CLINIC_TIMEZONE` | no | Used in the prompt and for appointment slots. |
| `LOG_LEVEL` | no | pino level (default `info`). |
| `VAPI_API_KEY`, `PUBLIC_BASE_URL` | setup only | Used by `npm run setup:vapi`; never needed by the running server. |
| `VAPI_MODEL(_PROVIDER)`, `VAPI_VOICE_ID/_PROVIDER/_MODEL`, `VAPI_PHONE_AREA_CODE` | no | Override the LLM, voice, or number area code at setup. |

### Observability
Structured JSON logs (pino) go to stdout and are visible with `railway logs`. Logged events:
- every tool call and its result
- the full `register_patient` payload
- a final transcript and summary line per call
- webhook auth failures

Transcripts are also stored in the `calls` table and shown in the dashboard.

---

## Known limitations and trade-offs
- **Open API, by design, for review.** It holds only fictional data and is rate-limited (300/min/IP). In production, set `API_KEY` or put real auth in front of it. Logs contain PHI, which would need redaction or a HIPAA-eligible sink in production.
- **Duplicate detection is by phone only,** as the spec asks. Phone numbers aren't unique (families share them), so it's a prompt to the caller, not a DB constraint.
- **Phone validation** requires 10 digits and an area code not starting with 0 or 1. It does not enforce full NANP exchange rules, so common test numbers like `555-123-4567` are accepted.
- **Names** also allow spaces and periods (for example "Mary Ann", "St. John"), which is slightly broader than "alphabetic + hyphens/apostrophes".
- **Mid-call state lives in the LLM context,** not in our DB. A dropped call keeps its transcript, but the caller has to restart; partial intakes can't be resumed.
- **Appointments are mock data:** one provider, weekday hourly slots in the clinic timezone.
- **Vendor coupling:** Vapi payload handling is isolated in `src/voice/webhook.js`, so another platform (Retell, Twilio + custom pipeline) would mean a new adapter plus the prompt; the domain layer stays unchanged.
- **Railway Config-as-Code** (`railway.json`) is deprecated upstream in favour of `.railway/railway.ts` but works until 2026-12-01.

## Next steps
- Resume partial intakes by caller ID (persist a draft on each tool call).
- Auth (API keys per client, or OAuth) and audit logging for every read/write of PHI.
- Automated conversation tests: scripted caller personas through Vapi's chat/test-suite API, asserting the saved record.
- Real scheduling integration with provider calendars, plus SMS confirmation.
- Migrations tool (e.g. node-pg-migrate) once the schema starts evolving.

## Project layout
```
src/
  server.js            boot: DB connect → migrate → seed → listen; graceful shutdown
  app.js               Express wiring (routes, security middleware, error handling)
  config.js logger.js
  db/                  schema.sql, connection adapter (pg | PGlite), seed data
  http/                error types + response envelope
  patients/            validation, repository (SQL), service, REST routes
  calls/               call log / transcript repository
  appointments/        mock scheduling service
  voice/               prompt.js, tools.js, assistant.js (Vapi config), webhook.js, handlers.js
public/dashboard.html  bonus dashboard (vanilla JS, reads the REST API)
scripts/setup-vapi.js  provisions the Vapi assistant + phone number
test/                  node:test suites (validation, API, voice webhook)
```
