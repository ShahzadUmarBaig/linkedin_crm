# LinkedIn CRM

Personal AI-powered LinkedIn content engine. A Next.js web app (the brain) and a Chrome extension (the data feeder) that work together to research topics in your niche, generate post ideas, schedule them on a calendar, and track what performs.

## Layout

- `web/` — Next.js 16 App Router + Supabase. The CRM UI + API.
- `extension/` — Chrome MV3 (Vite + TypeScript). Passively captures what you browse on LinkedIn; "Scrape" uploads the buffer to the CRM.
- `shared/` — TypeScript types shared between web and extension (scrape payload shape, generated DB types).
- `supabase/migrations/` — SQL migrations. Apply via `supabase db push` once linked.

## Setup

1. Create a Supabase project (free tier).
2. Run the migration: `supabase db push` (after `supabase link --project-ref <ref>`).
3. Copy `web/.env.local.example` → `web/.env.local` and fill in:
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (from Supabase API settings)
   - `SUPABASE_SERVICE_ROLE_KEY` (server-only)
   - `EXTENSION_INGEST_SECRET` — `openssl rand -hex 32`
   - `APP_ENCRYPTION_KEY` — `openssl rand -hex 32` (32 bytes; used to encrypt user-supplied Claude/Gemini API keys at rest)
4. `npm install`
5. `npm run dev:web` — Next.js at http://localhost:3000
6. `npm run build:ext` — produces `extension/dist/`. Load it in Chrome via `chrome://extensions` → "Load unpacked".
7. Open the extension popup, paste API URL + ingest secret + your Supabase auth user id, save.

## How the pieces connect

```
You browse LinkedIn
   ↓
Content script observes the DOM (no auto-scroll, no auto-navigation)
   ↓
Buffered in chrome.storage.local
   ↓
You click "Scrape now" in the popup
   ↓
POST /api/ingest  (Bearer EXTENSION_INGEST_SECRET, X-User-Id: <uuid>, body: ScrapeBatch)
   ↓
Next.js writes via Supabase service-role client
   ↓
AI pipeline (Claude or Gemini) generates ideas, picks slots, refines drafts
   ↓
You approve drafts → calendar
```
