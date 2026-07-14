# CONTEXT

Nextum LMS is the operator-facing Next.js web app for academy management. It uses the shared Supabase project that LMS owns first and grade-app consumes later.

## Current State

- App Router routes live in `src/app`.
- The protected `(app)` server layout validates auth and loads the shell context before rendering `AppShell`.
- App Router `loading.tsx`, `error.tsx`, and `not-found.tsx` own route-level fallback states.
- Current routed LMS screens use `src/features/lms`.
- Electron compatibility, global pointer recovery, PIN/idle lock, and legacy Zustand stores have been removed from the active codebase.
- Shared UI primitives live in `src/components/ui`; new UI work should start there.

## Architecture

```text
Next.js App Router
  -> protected server layout / shell context
  -> AppShell / bounded client feature screens
  -> src/app/api/lms Route Handlers
  -> src/lib/lms server-only domain functions
  -> Supabase PostgreSQL / Auth / RLS
```

## Key Directories

```text
src/app/              App Router routes and API handlers
src/components/ui/    Shared UI primitives and LMS design-system components
src/components/layout/  AppShell and Sidebar
src/components/security/
src/contexts/         Minimal client auth lifecycle context
src/features/lms/     Routed LMS feature screens, API clients, types, tests
src/lib/lms/          Server-only domain queries, mutations, auth, and contracts
src/lib/supabase/     Browser/server/admin Supabase clients
supabase/migrations/  LMS database migrations
docs/                 Architecture and operating docs
scripts/              Verification, seed, backup, and guard scripts
```

## UI Rules

- Read `docs/lms-ui-system.md` before changing LMS UI.
- Use shared primitives from `src/components/ui` instead of local one-off controls.
- Use HSL design tokens from `src/app/globals.css`; do not use hard-coded color-family classes or hex colors in governed UI files.
- Do not add raw `button`, `select`, `table`, or checkbox inputs in governed UI files unless implementing a documented primitive.
- Run `npm run ui:check` with UI changes.

## Runtime Notes

- Supabase browser code must use publishable keys only.
- Browser Supabase use is limited to authentication lifecycle and Realtime invalidation.
- Business reads/writes use Route Handlers and server-only domain modules; secret keys never cross the server boundary.
- Admin reset/export/tax operations are handled under `/api/lms/admin/*` and must call `assertLmsAdmin()`.
- This repository owns shared migrations. Grade App consumes approved `core`, `content`, `learning`, `ai`, and `reporting` contracts and must not apply independent DDL.

## Verification Commands

```bash
npm run verify
```

Database changes additionally require the runbook preflight and `npm run db:check`.

## Decision Log

### 2026-07-07

- Standardized routed LMS UI around `src/components/ui`, token-based Tailwind classes, and `docs/lms-ui-system.md`.
- Removed inactive legacy UI directories and legacy global domain CSS after import verification.
- Added `npm run ui:check` and made `npm run lint` run the UI guard.

### 2026-07-10

- Moved protected identity/bootstrap work into the `(app)` server layout and reduced the browser auth context to session lifecycle.
- Removed Electron/pointer/PIN/store compatibility code after importer verification.
- Added TypeScript unused checks, Next/Promise ESLint rules, coverage thresholds, Knip, and the `npm run verify` CI gate.

### 2026-07-14

- Made the grade fixture importer preserve objective answer keys, student-safe public payloads, and crop/conversion metadata on re-import.
- Added production manifests and full DB verification for the middle-school Concept (2,914), Power (4,160), and Light (3,094) workbook problems.
