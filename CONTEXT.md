# CONTEXT

Nextum LMS is the operator-facing Next.js web app for academy management. It uses the shared Supabase project that LMS owns first and grade-app consumes later.

## Current State

- App Router routes live in `src/app`.
- Auth, route guards, the sidebar, idle lock, and global loading live in `src/App.tsx`.
- Current routed LMS screens use `src/features/lms`.
- Electron-era routed UI and legacy global domain CSS have been removed from the active codebase.
- Shared UI primitives live in `src/components/ui`; new UI work should start there.

## Architecture

```text
Next.js App Router
  -> AuthProvider / App shell
  -> Route client components
  -> src/features/lms services and UI
  -> src/app/api/lms Route Handlers
  -> Supabase PostgreSQL / Auth / RLS
```

## Key Directories

```text
src/app/              App Router routes and API handlers
src/components/ui/    Shared UI primitives and LMS design-system components
src/components/layout/Sidebar.tsx
src/components/security/
src/contexts/         Auth context
src/features/lms/     Routed LMS feature screens, services, types, tests
src/lib/lms/          Server-side LMS auth/admin helpers
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
- Server-only Supabase secrets are used only through server/admin modules and Route Handlers.
- Admin reset/export/tax operations are handled under `/api/lms/admin/*` and must call `assertLmsAdmin()`.
- Grade-app shared data should stay in shared schemas such as `core`, `content`, `learning`, `ai`, and `reporting`; avoid duplicating shared data inside `lms`.

## Verification Commands

```bash
npm run ui:check
npm run lint
npm run typecheck
npm test -- --run
npm run build
```

## Decision Log

### 2026-07-07

- Standardized routed LMS UI around `src/components/ui`, token-based Tailwind classes, and `docs/lms-ui-system.md`.
- Removed inactive legacy UI directories and legacy global domain CSS after import verification.
- Added `npm run ui:check` and made `npm run lint` run the UI guard.
