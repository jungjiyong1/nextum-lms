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
- Added a student-safe `content.student_problems` view to the baseline so future grade-app screens can read problem payloads without receiving `answer` or `answer_key`.
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
- Moved the class operations read path behind role-aware server API routes:
  - `/api/lms/classes/overview`
  - `/api/lms/classes/detail`
  - These routes return already-scoped class, schedule, roster, book, attendance, staff, and classroom DTOs.
- Moved the LMS home dashboard read path behind `/api/lms/dashboard`:
  - owner/admin/staff keep the full operational dashboard.
  - teacher/instructor dashboard rows are scoped to assigned classes/students.
  - teacher/instructor dashboard finance rows are withheld instead of exposing billing data.
- Moved the student operations read path behind authenticated `GET /api/lms/students`:
  - owner/admin/staff receive the student roster and class assignment options from server-scoped DTOs.
  - student contacts, parent contacts, and billing contract summaries are no longer loaded directly from browser Supabase queries on the student screen.
- Moved staff roster reads behind authenticated `GET /api/lms/staff`:
  - owner/admin/staff can load staff summaries for instructor management and accounting payroll forms.
  - staff creation/update remains limited to owner/admin through the existing POST route.
- Moved accounting screen reads behind authenticated `GET /api/lms/accounting`:
  - owner/admin/staff receive billing, payment, expense, payroll, and staff form DTOs from a single server-scoped read.
  - accounting page no longer fans out direct browser Supabase reads for financial data.
- Moved academy name reads behind authenticated `GET /api/lms/academy`, so the shell no longer reads `core.academies` directly from the browser.
- Reduced `src/features/lms/service.ts` to browser-safe API wrappers and removed obsolete direct Supabase read helpers from that client module.
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
- Preserved the full LMS role set in the client auth profile instead of coercing unknown/student roles to staff.
- Added a shared app-page access policy so the LMS sidebar and route guard only expose operational pages to allowed roles:
  - owner/admin: all LMS operational pages
  - staff: home, class, student, and accounting operations
  - teacher/instructor: home and class operations
  - student/guardian: no LMS operational page until a dedicated student/guardian LMS surface exists
- Added an access-denied screen for non-operational LMS roles and cleaned up the broken Korean copy on the startup/sidebar/no-academy surfaces touched by this guard.
- Tightened teacher/instructor class operations:
  - recurring schedule rule create/update is limited to owner/admin/staff
  - attendance and single-lesson status mutations require teacher/instructor assignment to the target class
  - class overview/detail reads now go through server routes that filter teacher/instructor data to assigned classes before returning it to the browser
  - teacher/instructor reference data is reduced to assigned-class staff/classrooms, and global book lists are withheld from those roles
- Tightened the clean baseline RLS for teacher/instructor roles:
  - class, roster, schedule, classroom, attendance, learning, AI chat, and data-event reads now require an assigned class or an accessible student instead of broad academy-wide teacher/instructor access
  - learning wrong notes and AI conversation/message policies are split by operation so expanded read access does not imply update/delete access
  - sensitive helper functions explicitly revoke default PUBLIC/anon execute access before granting authenticated/service-role execution
- Added `supabase/config.toml` so local Supabase exposes the non-public schemas used by the browser client.
- Hardened the baseline with same-academy foreign keys, active-contract uniqueness, attendance enrollment validation, and narrower delete policies for LMS operation tables.
- Applied the remote `nextum-data` LMS repair/cutover after a preservation backup:
  - kept existing grade-app `content.books`, `content.problems`, and `learning.attempts` data intact
  - replaced the legacy bigint-based `lms` schema with the UUID class-centered LMS operational schema
  - added compatibility columns/views for `core`, `content`, `learning`, `ai`, `data`, `reporting`, and `audit`
  - fixed recursive `core.classes`/`core.class_students`/`core.class_books` policies
  - aligned the `admin / 1234` account with the existing `넥섬학원` academy data
- Backfilled LMS operational defaults for pre-existing data:
  - one `lms.class_profiles` row for the existing active class
  - four active `lms.student_billing_contracts` rows with `base_monthly_fee = 0`
  - included class billing rules for current active class enrollments
- Updated the class operations book list so academy-owned books and shared grade-app books (`academy_id is null`) are both available for assignment.

## Deliberately Not Done Yet

- grade-app code has not been changed in this LMS-only phase.
- PDF report generation is not included. The current target is reliable data structures and LMS views for future report generation.
- Student analysis and parent report requirements for the future grade-app/reporting phase are tracked in `docs/grade-app-reporting-requirements.md`.
- Supabase Auth leaked password protection is still a dashboard-side setting, not a SQL migration. The security advisor now only reports that remaining Auth setting.
- Full grade-app code migration to the shared `core/content/learning/ai` contract is still pending.

## Cutover Requirements Before Production Use

1. Keep the preservation backup from `npm run db:backup-preservation` before any further destructive work.
2. Run `npm run db:check` against `nextum-data` before authenticated LMS use.
3. Verify admin login, student invite signup, class book assignment, attendance, and billing generation after each schema change.
4. Enable Supabase Auth leaked password protection in the dashboard.
5. Modify grade-app to use `core.students`, `core.class_students`, `core.class_books`, `learning.*`, and `ai.*` from the same baseline.
6. After grade-app migration, remove or archive legacy duplicated learning tables only with a fresh backup.

## Verification Commands

```bash
npm run typecheck
npm test -- --run
npm run lint
npm run build
npm run db:check
```

`npm run db:check` is the read-only cutover gate for the target Supabase project. It should pass only after the clean LMS baseline has been applied or repaired on that project.

Remote `nextum-data` verification on 2026-07-06:

- `npm run db:check` passed all 40 database contract checks.
- Supabase security advisor only reported Auth leaked password protection disabled.
- Playwright browser smoke on `http://localhost:3102` verified `admin / 1234` login, `넥섬학원` academy selection, dashboard counts, and `/classrooms`, `/students`, `/instructors`, `/accounting`, `/settings` page loads without DB error text.
- Class overview API smoke verified 1 class, 3 shared books, 4 students, and 4 base-fee contracts after the operational defaults backfill.

SQL baseline syntax was checked with an ephemeral Postgres 17 Docker container plus minimal Supabase stubs:

```sql
create role anon;
create role authenticated;
create role service_role;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as 'select null::uuid';
```
