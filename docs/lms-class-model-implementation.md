# LMS Class-Centered Implementation Notes

## Implemented In LMS

- Replaced accumulated Supabase migrations with a clean baseline owned by the LMS repo.
- Added development-only admin seeding through `npm run seed:dev-admin`.
- Added a new `src/features/lms` service/UI layer using the class-centered schema.
- Added class book assignment, class attendance recording, and monthly billing draft calculation from base fee, class rules, and billable attendance minutes.
- Added student invitation-code signup:
  - LMS issues codes from the student list.
  - `/signup` accepts the code and creates the Supabase Auth account with a normal login ID.
  - `core.user_accounts` and `core.academy_members` become the canonical account link.
- Switched existing LMS routes to the new workflows:
  - learning dashboard
  - class/time schedule
  - students and billing contracts
  - staff/instructors
  - accounting invoices
  - settings
- Updated login ID mapping to use `NEXT_PUBLIC_LMS_LOGIN_EMAIL_DOMAIN`.
- Fixed auth restore flow so the app waits for profile/security loading before rendering protected screens.
- Added `supabase/config.toml` so local Supabase exposes the non-public schemas used by the browser client.
- Hardened the baseline with same-academy foreign keys, active-contract uniqueness, attendance enrollment validation, and narrower delete policies for LMS operation tables.

## Deliberately Not Done Yet

- grade-app code has not been changed in this LMS-only phase.
- The active remote `nextum-data` database is the intended final database, but the clean baseline was not applied destructively to that remote database in this phase.
- PDF report generation is not included. The current target is reliable data structures and LMS views for future report generation.
- Student analysis and parent report requirements for the future grade-app/reporting phase are tracked in `docs/grade-app-reporting-requirements.md`.

## Cutover Requirements Before Production Use

1. Backup/export any existing remote data that must be kept.
2. Preserve grade-app book/problem data before removing old schema tables.
3. Apply the clean baseline to a fresh Supabase database, a Supabase branch, or a confirmed disposable database.
4. Run `npm run seed:dev-admin` only for local/development access.
5. Verify admin login, student invite signup, class book assignment, attendance, and billing generation.
6. Modify grade-app to use `core.students`, `core.class_students`, `core.class_books`, `learning.*`, and `ai.*` from the same baseline.
7. Only then switch both apps to the same Supabase project.

## Verification Commands

```bash
npm run typecheck
npm test -- --run
npm run lint
npm run build
```

SQL baseline syntax was checked with an ephemeral Postgres 17 Docker container plus minimal Supabase stubs:

```sql
create role anon;
create role authenticated;
create role service_role;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as 'select null::uuid';
```
