# Development Guide

## Local Development

```bash
npm install
npm run dev
```

Open the printed localhost URL in the browser.

## Verification

Run these before handing off meaningful code changes:

```bash
npm run verify
```

Use `npm run test:run`, `npm run typecheck`, or `npm run lint` for focused feedback while iterating. Database changes additionally follow `docs/supabase-optimization-v2-runbook.md` and run `npm run db:check`.

Use production mode when runtime behavior needs confirmation:

```bash
npm run start
```

## UI Work

- Read `docs/lms-ui-system.md` first.
- Start routed LMS screens with `PageShell`.
- Use shared primitives from `src/components/ui`.
- Keep neutral surfaces dominant and use `primary`, `success`, `warning`, `danger`, and `info` only for meaning.
- Do not add local `PageShell`, `StatusBadge`, or `SelectBox` helpers.
- Do not use raw `button`, `select`, `table`, or checkbox inputs in governed UI files.
- Add loading, empty, error, disabled, and background-refresh states for operational workflows.

## Supabase

- Browser clients use only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
- Server-only work uses `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY` through server modules only.
- Browser Supabase use is limited to authentication lifecycle and Realtime invalidation.
- Business reads and writes use API Route Handlers backed by server-only domain code under `src/lib/lms`.
- Admin reset, CSV export, and tax settings run through `src/app/api/lms/admin/*` and must call `assertLmsAdmin()`.

## Adding Pages

1. Add protected routes under `src/app/(app)`; only intentionally public pages belong outside that group.
2. Put substantial LMS UI/service logic under `src/features/lms` unless the route is clearly standalone.
3. Update `src/core/auth/roles.ts` and `src/components/layout/Sidebar.tsx` if the page belongs in the app shell.
4. Use shared UI primitives and run `npm run ui:check`.

## Adding API Functions

- Prefer `src/app/api/lms/*` Route Handlers for server-side mutations and admin reads.
- Put reusable database queries/mutations and authorization helpers under `src/lib/lms`.
- Keep Supabase admin calls out of browser components.
- Validate request bodies before mutation.
- Respect academy scoping and role checks for every LMS operation.
