# Nextum LMS

Nextum LMS is the operator-facing web app for academy management. The current app is a Next.js LMS that owns the shared Supabase data model used by LMS first and grade-app later.

## Current Direction

- LMS is a web app, not Electron.
- The canonical roster model is class-centered:
  - `core.students` is the student identity record.
  - `core.classes` is the class/group record.
  - `core.class_students` is the roster.
  - `core.class_books` controls grade-app book access.
- LMS-specific operations live in `lms`:
  - class profile, schedule rules, lesson occurrences, attendance, billing contracts, invoices, payments, expenses, payroll.
- Student accounts are invitation-based:
  - LMS registers the student first.
  - LMS issues a one-time invite code.
  - The student signs up at `/signup` with a normal login ID and password.
  - The normal login ID is mapped internally to `login_id@LMS_LOGIN_EMAIL_DOMAIN`.
- Learning and AI data are shared:
  - `learning.attempts` remains append-only.
  - `ai.conversations` and `ai.messages` store grade-app AI tutor conversations.
  - `reporting.v_student_type_weakness` is the primary student weakness view.

## Stack

- Next.js 16 App Router
- React 19, TypeScript
- Supabase Auth, PostgreSQL, RLS
- Tailwind CSS, Radix UI, shadcn/ui-style primitives
- Vitest, React Testing Library

## Environment

`.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_LMS_LOGIN_EMAIL_DOMAIN=nextum.local
```

`SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY` is server-only. Never expose either with a `NEXT_PUBLIC_` prefix.

## Development Admin

The `admin / 1234` account is development-only. It is not created by the production migration.

```bash
$env:LMS_DEV_SEED_ALLOW = "true"
npm run seed:dev-admin
```

The seed script uses Supabase Admin API and requires `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY`. It refuses to run unless `LMS_DEV_SEED_ALLOW=true` is set for the current shell.

## Scripts

```bash
npm run dev
npm run build
npm run lint
npm run typecheck
npm test -- --run
$env:LMS_DEV_SEED_ALLOW = "true"; npm run seed:dev-admin
```

## Routes

- `/` learning performance dashboard
- `/classrooms` class roster, maintenance, book creation, book access, recurring timetable maintenance, lesson status overrides, and attendance operations
- `/students` student roster, class assignment, invitation, status, and billing contract setup
- `/instructors` staff/instructor roster, role, status, and pay-rate maintenance
- `/accounting` monthly billing, payment, expense, and instructor payroll operations
- `/settings` operational settings, CSV export, tax defaults, and guarded reset actions
- `/login` Supabase Auth login
- `/signup` student invite-code signup
- `/api/lms/classes`, `/api/lms/students`, `/api/lms/staff`, `/api/lms/books`, `/api/lms/schedule-rules`, `/api/lms/lesson-occurrences`, `/api/lms/class-books`, `/api/lms/attendance`, `/api/lms/invitations/issue`, `/api/lms/billing/generate`, `/api/lms/payments`, `/api/lms/expenses`, `/api/lms/payroll`, `/api/lms/admin/export`, `/api/lms/admin/reset`, `/api/lms/admin/tax-settings` server-side LMS mutations and admin operations

## Database

The clean baseline is:

```text
supabase/migrations/0001_nextum_lms_baseline.sql
```

This baseline is intended for the new shared database. It replaces the previous incremental LMS/grade-app compatibility migrations.

The intended production target is the existing `nextum-data` Supabase project, but do not apply this baseline destructively without an explicit backup/export and cutover plan. Old LMS schema tables can be removed during cutover, but imported grade-app book/problem data must be preserved.

Local Supabase API schema exposure is recorded in:

```text
supabase/config.toml
```

## Verification Used In This Branch

```bash
npm run typecheck
npm test -- --run
npm run lint
npm run build
```

The SQL baseline was also applied to a temporary Postgres 17 Docker container with Supabase auth/API role stubs to verify syntax, constraints, policies, grants, triggers, and views.
