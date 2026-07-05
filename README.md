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
NEXT_PUBLIC_LMS_LOGIN_EMAIL_DOMAIN=nextum.local
```

`SUPABASE_SECRET_KEY` is server-only. Never expose it with a `NEXT_PUBLIC_` prefix.

## Development Admin

The `admin / 1234` account is development-only. It is not created by the production migration.

```bash
npm run seed:dev-admin
```

The seed script uses Supabase Admin API and requires `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY`.

## Scripts

```bash
npm run dev
npm run build
npm run lint
npm run typecheck
npm test -- --run
npm run seed:dev-admin
```

## Routes

- `/` learning performance dashboard
- `/classrooms` class and timetable operations
- `/students` student roster and billing contract setup
- `/instructors` staff/instructor roster
- `/accounting` monthly billing overview
- `/settings` operational configuration notes
- `/login` Supabase Auth login

## Database

The clean baseline is:

```text
supabase/migrations/0001_nextum_lms_baseline.sql
```

This baseline is intended for the new shared database. It replaces the previous incremental LMS/grade-app compatibility migrations.

For an already-populated remote database, do not apply this baseline destructively without an explicit backup/export and cutover plan.

## Verification Used In This Branch

```bash
npm run typecheck
npm test -- --run
npm run lint
npm run build
```

The SQL baseline was also applied to a temporary Postgres 17 Docker container with Supabase auth/API role stubs to verify syntax, constraints, policies, grants, triggers, and views.
