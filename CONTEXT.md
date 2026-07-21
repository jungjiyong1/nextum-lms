# CONTEXT

Nextum LMS is the operator-facing Next.js web app for academy management. It uses the shared Supabase project that LMS owns first and grade-app consumes later.

## Current State

- The audited whole-project entry point is `docs/PROJECT_HANDOFF_GUIDE.md`.
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

### 2026-07-21

- Added invitation-only LMS signup for academy staff: owner/admin registration in the instructor tab now creates a 128-bit, HMAC-hashed, 14-day one-time code tied to the staff record and role. `/signup` claims the code once, creates the Supabase Auth identity plus `core.user_accounts`/`core.academy_members` links, then signs the user in. Partial failures delete the new auth identity and release the invitation reservation; reissuing a code invalidates the previous pending code.
- Added `20260721141617_staff_invitation_signup.sql` to enforce one pending invitation per staff member at the database boundary. Authorization continues to come from `core.academy_members`; editable Auth user metadata is not used for role checks.

### 2026-07-20

- Added `docs/PROJECT_HANDOFF_GUIDE.md` as the audited onboarding and operations entry point across the app, API, Supabase, security, tests, CI, and deployment.
- Recorded the current 46-migration local/remote parity, live database catalog snapshot, verification status, documentation drift, and safe change checklists.
- Added the worksheet v1 schema (`20260720134500_worksheet_v1_schema.sql`): worksheet drafts/variants/items, render jobs, artifacts, recommendation logs, problem-bank academy grants, and asset render metadata. All worksheet tables are service-role only; publishing materializes each variant into the existing per-student `learning.assignments` contract so Grade App needs no changes.
- Added `supabase/tests/worksheet_v1_smoke.sql` and a `db-contract` CI job that applies every migration to a clean database and runs all SQL smoke tests on each PR/push.
- Added the worksheet recommendation engine as pure functions (`worksheet-config.ts`, `worksheet-eligibility.ts`, `worksheet-selection.ts`): pull-based eligibility with correction→verification (2d) and confirmed→review (14d) gates, locked-item re-tagging, permanent exclusion for verification, 30-day exclusion with oldest-first re-admission for practice/review, seeded reproducible selection, and configurable defaults for lms.settings overrides.
- Added per-item difficulty control to the worksheet cart: band plans (`bandPlan`) in the selection engine with per-band availability, preset builder (easier/recommended/harder, capped at the auto band limit), deterministic same-seed recomputation via cart `overrides`, server-side revalidation of teacher plans at draft creation, and cart UI (segmented presets, per-band steppers with candidate counts, distribution bars/chips, verification re-baselining notice). Registered `db:tag-worksheet-skills` for the gaeppul skill-tag importer.
- Added worksheet publish v1 (`20260721001500`): `learning.publish_worksheet_v1` atomically freezes each variant manifest and materializes it into the existing per-student assignment contract (assignment + target + student_direct recipient + seq-ordered items), and `learning.submit_session_v2` was redefined with per-item worksheet evidence overrides — attempts on `evidence_eligible = false` items are always `correction`/`analysis_eligible = false` (`worksheet_practice`), and worksheet assignments validate problems by item snapshot so mixed-book sheets submit cleanly. `worksheet_publish_v1_smoke.sql` proves printed seq = app order and practice-item non-pollution on every CI run. The review screen gained a confirm-gated publish step.
- Added the worksheet PDF renderer: pure 2×2 layout engine with full-width/own-page promotion and scale warnings (`src/lib/lms/render/worksheet-layout.ts`), sharp image normalization, pdf-lib composition with committed Noto Sans KR TTFs (OFL, subset-embedded), teacher answer key, idempotent `worksheet_render_jobs` claiming, uploads to the new private `worksheet-artifacts` bucket (never touched by the match cleanup cron), `/api/lms/worksheets/render` (maxDuration 300), and the cart's render/review step with signed URLs. Fonts are traced into the function bundle via `outputFileTracingIncludes`.
- Wired the worksheet cart end to end: `worksheet-queries.ts`/`worksheet-mutations.ts` (evidence→eligibility assembly, unified assignment history, draft creation with server-side role recomputation), `/api/lms/worksheets/*` and `/api/lms/admin/problem-bank-grants` Route Handlers, the `/worksheets/new` cart screen with swap/remove reason logging, the super-admin grant screen at `/settings/problem-bank`, and a student-detail entry button. Worksheet browser API lives in `worksheet-service.ts` (not `service.ts`) to keep shared chunks small; the login bundle budget was re-based to 144 KiB with the shared-chunk measurement rationale documented in the budget script.

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
