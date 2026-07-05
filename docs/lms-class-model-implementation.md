# LMS Class-Centered Implementation Notes

## Implemented In LMS

- Replaced accumulated Supabase migrations with a clean baseline owned by the LMS repo.
- Added development-only admin seeding through `npm run seed:dev-admin`; the script now requires `LMS_DEV_SEED_ALLOW=true`.
- Added a read-only database contract check through `npm run db:check` so the LMS can verify the Supabase Data API baseline before authenticated screens are used.
- Added a read-only grade-app content backup command through `npm run db:backup-content` before `nextum-data` cutover.
- Added a broader read-only preservation backup command through `npm run db:backup-preservation` for `core`, `content`, `learning`, `ai`, `data`, legacy `lms`, and Supabase Storage manifest export.
- Added a new `src/features/lms` service/UI layer using the class-centered schema.
- Added class book assignment, class attendance recording, and monthly billing draft calculation from base fee, class rules, and billable attendance minutes.
- Added LMS book maintenance on top of the grade-app content contract:
  - create academy-owned `content.books` records from the class screen
  - edit title, subject, and grade without changing existing `book_key` references
  - keep hard delete out of the LMS UI so grade-app book/problem data is not accidentally broken
- Added class maintenance after creation:
  - edit class name, grade, status, capacity, color, and default instructor
  - create and maintain academy classrooms, then assign a default classroom to each class
  - validate classroom ownership on class and schedule mutations
  - deactivate schedule rules when a class is stopped or archived
  - remove class book assignments so grade-app book access can be revoked
- Added timetable maintenance after schedule creation:
  - edit and stop recurring schedule rules without deleting history
  - materialize virtual lesson occurrences when a single lesson is cancelled, completed, changed to makeup, or marked as substitute
  - keep attendance recording tied to the same occurrence identity used by billing and later reporting
- Added student roster maintenance after registration:
  - edit student/contact/grade/status
  - update class assignments without hard-deleting history
  - update or close billing contracts based on student status
- Added student invitation-code signup:
  - LMS issues codes from the student list.
  - `/signup` accepts the code and creates the Supabase Auth account with a normal login ID.
  - `core.user_accounts` and `core.academy_members` become the canonical account link.
- Moved high-risk create/generate mutations behind same-origin server API routes:
  - `/api/lms/classes`
  - `/api/lms/students`
  - `/api/lms/staff`
  - `/api/lms/books`
  - `/api/lms/classrooms`
  - `/api/lms/schedule-rules`
  - `/api/lms/lesson-occurrences`
  - `/api/lms/class-books`
  - `/api/lms/attendance`
  - `/api/lms/invitations/issue`
  - `/api/lms/billing/generate`
  - `/api/lms/payments`
  - `/api/lms/expenses`
  - `/api/lms/payroll`
  - These routes authorize the exact academy before using the server-only Supabase secret key.
- Expanded accounting operations beyond invoice generation:
  - record student payments and recompute invoice paid/status
  - record operating expenses
  - record instructor payroll with withholding calculation
- Added staff roster maintenance after registration:
  - edit staff contact information
  - update role, employment status, and hourly rate
  - keep owner role edits out of the operational staff screen
- Admin export/reset/tax-settings APIs now require the caller to provide the exact `academyId`; the server authorizes that academy instead of choosing the first admin membership.
- Wired the settings screen to the admin APIs for tax defaults, CSV export, and guarded reset actions.
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
2. Preserve grade-app book/problem data with `npm run db:backup-content` before removing old schema tables.
3. Apply the clean baseline to a fresh Supabase database, a Supabase branch, or a confirmed disposable database.
4. Run `$env:LMS_DEV_SEED_ALLOW = "true"; npm run seed:dev-admin` only for local/development access.
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

`npm run db:check` is the read-only cutover gate for the target Supabase project. It should pass only after the clean LMS baseline has been applied or repaired on that project.

SQL baseline syntax was checked with an ephemeral Postgres 17 Docker container plus minimal Supabase stubs:

```sql
create role anon;
create role authenticated;
create role service_role;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as 'select null::uuid';
```
