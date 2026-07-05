# Grade App and Reporting Requirements

This document records the LMS-side requirements that must be preserved when the
grade-app is migrated later. Do not treat this as completed grade-app work.

## Data To Preserve During `nextum-data` Cutover

- Preserve imported book and problem data before old schema cleanup:
  - `content.books`
  - `content.units`
  - `content.concepts`
  - `content.problem_types`
  - `content.problems`
  - `content.assets`
- Preserve any existing answer metadata needed by the grader.
- Do not delete grade-app book/problem data as part of LMS old-schema cleanup.

## Login Contract

- Students are registered in LMS first.
- LMS issues a one-time invitation code.
- Student chooses a normal login ID and password at `/signup`.
- The app maps normal IDs to Supabase Auth email internally:
  - `login_id` -> `login_id@LMS_LOGIN_EMAIL_DOMAIN`
- Canonical identity is:
  - `core.people`
  - `core.students`
  - `core.user_accounts`
  - `core.academy_members`

## Access Contract

- Class-book access is controlled by `core.class_books`.
- If a student is active in `core.class_students`, and the class has an active
  book assignment, the student can use that book in grade-app.
- LMS is the owner of student registration, class membership, and book access.

## Grade App Write Contract

When grade-app is migrated, every grading attempt should write to
`learning.attempts` with these identifiers whenever available:

- `academy_id`
- `core_student_id`
- `session_id`
- `book_id`
- `problem_id`
- `class_id`
- `attempt_no`
- `answer_submitted`
- `correct`
- `unsure`
- `score`
- `created_at`

The app should also emit append-only `data.events` rows for important learning
events so future apps can consume the same data without coupling to grade-app UI.

## Reports Needed Later

Student analysis report:

- Weak problem types
- Unit/concept-level performance
- First-attempt accuracy
- Repeated mistake patterns
- Attendance and usage context
- AI chat signals when available

Parent report:

- Short learning summary
- Progress by unit/type
- Actionable weak points
- Attendance summary
- Recommended next work

## Future LMS UI

The LMS should eventually expose:

- Student detail tab for grade-app attempts
- Class detail tab for book progress
- Report draft generation for internal analysis
- Parent-facing report export, likely PDF

