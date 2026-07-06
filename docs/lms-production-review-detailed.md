# LMS Production-Grade Code Review

작성일: 2026-07-06

대상:
- LMS repo: `C:\codes\nextum\AMS`
- grade-app repo: `C:\codes\nextum\grade-app` 읽기 전용 참고
- 기준 commit: `ce0eb38` 이후 작업 전 상태

## Scope

이 리뷰는 기존 `docs/lms-code-review-optimization-report.md` 위에 프로덕션/다학원 운영 기준을 추가한 것이다.

가정:
- 여러 학원이 같은 LMS 제품을 사용한다.
- LMS, grade-app, AI 채팅, 채점, 리포트가 같은 Supabase 프로젝트/DB를 공유한다.
- 학생은 LMS에 등록된 뒤 초대/회원가입을 통해 grade-app에도 로그인한다.
- 장기적으로 학생별 채점 데이터, AI 채팅 데이터, 수강/출결/수납 데이터를 모아 리포트를 만든다.
- 운영자는 데이터 유실, 학원 간 데이터 노출, 정답 유출, 회계 오집계, migration 실패를 허용할 수 없다.

참고한 공식 문서:
- Supabase RLS: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase API 보안: https://supabase.com/docs/guides/api/securing-your-api
- Supabase Database Advisors: https://supabase.com/docs/guides/database/database-advisors
- Supabase Data API grant 변경: https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically

## Production 기준

프로덕트 수준으로 보려면 단순히 화면이 동작하는지보다 아래 조건을 먼저 만족해야 한다.

1. 학원 A의 사용자가 학원 B 데이터를 읽거나 쓰지 못한다.
2. 학생/강사/staff/admin/owner 권한이 DB와 서버 API에서 모두 분리된다.
3. 학생 앱에서 정답, 타 학생 정보, 학원 회계 정보가 노출되지 않는다.
4. 학생 identity는 LMS, grade-app, AI, reporting 전체에서 하나의 canonical id로 연결된다.
5. reset, 삭제, 급여 생성, 수업 생성 같은 다중 테이블 작업은 transaction으로 처리된다.
6. migration은 빈 DB에서 재현 가능하고 앱별 script가 shared DB 설정을 덮지 않는다.
7. 운영 로그, audit log, backup/restore, rate limit, 보안 헤더, CI 검증이 있다.
8. 성능은 학원 수와 학생 수가 늘어도 선형적으로 무너지지 않는다.

## P0 Findings - 출시 전 반드시 차단

### P0-1. Client-controlled metadata로 LMS admin 승격 가능

Evidence:
- `src/screens/LoginPage.tsx:48`에서 signup 시 `{ full_name, role: 'admin' }` metadata를 보낸다.
- `supabase/migrations/0001_lms_schema.sql:106`에서 `new.raw_user_meta_data->>'role'`를 읽는다.
- `supabase/migrations/0001_lms_schema.sql:119-138`에서 해당 role로 `lms.profiles`, `lms.academy_members`를 생성/업데이트한다.
- `supabase/migrations/0001_lms_schema.sql:470-474`의 `profiles_self_update`는 자기 profile update를 허용한다.
- `src/lib/lms/auth.ts:46-62`는 `profiles.role = 'admin'`이면 admin으로 인정한다.

Risk:
- 공개 signup 또는 직접 Supabase signup 호출로 admin 계정 생성 가능.
- 여러 학원 운영 시 악성 사용자 한 명이 reset/export/tax settings 같은 admin route에 접근할 수 있다.

Fix:
- client signup에서 role metadata 제거.
- `raw_user_meta_data`를 권한 판단에 사용하지 않는다.
- `lms.handle_new_auth_user()`는 role provisioning을 하지 않거나, 서버가 생성한 invitation token만 검증한다.
- `assertLmsAdmin()`은 `profiles.role` fallback을 제거하고 active `academy_members` owner/admin만 신뢰한다.
- `lms.profiles`의 role/current_academy_id update는 service role 또는 admin RPC만 가능하게 한다.

Acceptance:
- 일반 사용자가 signup payload에 `role=admin`을 넣어도 `lms.academy_members` admin row가 생기지 않는다.
- authenticated client가 `lms.profiles.role`을 update해도 실패한다.
- admin route는 active owner/admin member만 통과한다.

Implementation status:
- 2026-07-06 기준 공개 signup 화면은 직접 Supabase signup을 호출하지 않고 `/api/lms/invitations/accept`만 호출한다.
- invitation accept route는 service role로 auth user를 만들고, `core.account_invitations.role = 'student'`인 초대만 허용한다.
- auth user 생성 시 user metadata에는 `login_id`만 저장하며 권한 role은 저장하지 않는다.
- clean baseline에는 `raw_user_meta_data` 기반 role provisioning trigger가 없다.
- `assertLmsAdmin()`/`assertLmsRoleForAcademy()`는 active `core.academy_members` membership만 조회한다.

### P0-2. LMS RLS가 membership만 보고 주요 테이블 전체 CRUD를 허용

Evidence:
- `supabase/migrations/0001_lms_schema.sql:63-77`의 `lms.belongs_to_current_academy()`는 role을 보지 않는다.
- `supabase/migrations/0001_lms_schema.sql:481-497`은 주요 LMS 테이블에 `for all to authenticated` 정책을 생성한다.
- `supabase/migrations/0001_lms_schema.sql:561`은 `lms` schema 모든 table에 authenticated CRUD grant를 준다.
- `supabase/migrations/0002_integrated_data_model.sql:1660-1668`도 여러 schema에 broad grant를 준다.

Risk:
- 학생/강사가 academy member가 되는 순간 학생/수업/회계/설정 데이터 write/delete가 열릴 수 있다.
- RLS가 tenant isolation은 일부 제공해도 role authorization은 제공하지 못한다.

Fix:
- table별로 `select`, `insert`, `update`, `delete` policy를 분리한다.
- role helper를 추가한다. 예: `lms.has_academy_role(academy_id, roles text[])`.
- 학생은 본인 데이터 read, 강사는 담당 수업 read/update 일부, staff는 운영 write, admin/owner는 삭제/설정 권한.
- 회계, settings, reset은 client direct write 금지 후 server route/RPC로 제한한다.

Acceptance:
- student role로 `lms.students`, `lms.student_payments`, `lms.settings` update/delete가 실패한다.
- instructor role은 담당 수업 외 학생/회계 데이터에 접근하지 못한다.
- staff/admin role별 허용 범위가 SQL test로 고정된다.

Implementation status:
- 2026-07-06 기준 clean baseline은 core 학생/반/교재/회계/설정 쓰기를 owner/admin/staff 중심으로 제한한다.
- `lms.class_schedule_rules`, `lms.lesson_occurrences`, `lms.attendance_records`, `learning.reports`의 direct RLS write도 owner/admin/staff로 좁혔다.
- teacher/instructor의 일정/출결 조작은 direct Data API가 아니라 서버 route의 `assertLmsRoleForAcademy()`와 service-role mutation 경로로 통제한다.
- 임시 Postgres 17 clean baseline 검증에서 teacher direct schedule insert 거부와 staff direct schedule insert 성공을 확인했다.
- 남은 작업은 teacher/instructor가 "자기 반/자기 수업"에만 접근하도록 RLS와 서버 route를 더 세분화하는 것이다.

### P0-3. 문제 정답 데이터가 학생에게 노출될 수 있음

Evidence:
- `supabase/migrations/0002_integrated_data_model.sql:985-996`의 `content.problems`에 `answer`, `answer_image_path`가 있다.
- `supabase/migrations/0002_integrated_data_model.sql:1169-1171`의 policy는 authenticated read `using (true)`다.
- `supabase/migrations/0002_integrated_data_model.sql:1662`, `1693`에서 content schema가 Data API에 노출된다.

Risk:
- grade-app 학생이 문제 풀이 전에 정답을 조회할 수 있다.
- 채점 데이터와 리포트 데이터의 신뢰성이 사라진다.

Fix:
- `content.problem_answers`를 staff-only로 분리한다.
- 학생용 `content.student_problems` view에는 question/image/meta만 제공한다.
- 채점은 answer를 반환하지 않는 RPC/server route에서 처리한다.
- 기존 `content.problems.answer` 직접 read는 staff/admin만 허용한다.

Implementation status:
- 2026-07-06 clean baseline에 `content.student_problems` view를 추가했다.
- `authenticated` role에는 `content.problems`의 안전 컬럼만 grant하고 `answer`, `answer_key`, `metadata`는 직접 grant하지 않는다.
- 임시 Postgres 17 검증에서 `authenticated` role의 `content.student_problems` 조회는 성공하고 `content.problems.answer` 조회는 거부됨을 확인했다.
- 원격 `nextum-data`는 아직 baseline 미적용 상태라 운영 검증은 컷오버 후 다시 필요하다.

Acceptance:
- student auth로 `content.problems.answer` select가 실패하거나 null이다.
- grade-app 풀이 flow는 answer 없이 동작한다.
- staff/admin 채점/검수 flow는 answer에 접근 가능하다.

### P0-4. Admin destructive route가 reauth/CSRF/origin 검증 없이 cookie auth만 사용

Evidence:
- `src/app/api/lms/admin/reset/route.ts:24-25`
- `src/app/api/lms/admin/export/route.ts:30-35`
- `src/app/api/lms/admin/tax-settings/route.ts:11-12`
- `src/components/security/PasswordConfirmDialog.tsx:60-65`는 클라이언트 재로그인 UI일 뿐 서버 challenge가 아니다.

Risk:
- admin session이 있으면 민감 POST가 바로 실행된다.
- browser cookie 기반 route는 CSRF/origin 방어가 필요하다.
- export는 학생/회계 개인정보 유출 표면이다.

Fix:
- reset/tax settings/export에 server-issued reauth challenge를 요구한다.
- `Origin` 검증과 CSRF token을 추가한다.
- reset은 2단계 confirm token과 audit log를 남긴다.
- export는 no-store header, scope/date/row limit를 둔다.

Implementation status:
- 2026-07-06 기준 reset/export/tax-settings route는 same-origin 검사와 owner/admin membership 검사를 수행한다.
- 클라이언트 API는 현재 사용자의 `current_academy_id`를 body에 포함하도록 수정했다.
- `/api/lms/admin/reauth`가 현재 세션 사용자와 입력 비밀번호를 서버에서 검증한 뒤 5분짜리 httpOnly reauth 쿠키를 발급한다.
- reset/export/tax-settings는 reauth 쿠키의 user/academy scope가 현재 요청과 맞지 않으면 403을 반환한다.
- reset/export/tax-settings/reauth 성공 시 `audit.admin_actions`에 actor, academy, action, target, payload를 기록한다.
- reset audit payload에는 target, 테이블별 operation/affected row count, 총 affected row count가 포함된다.
- export는 최대 370일, 상세 섹션별 10,000행으로 제한하고 filename/date/section scope를 audit payload에 기록한다.
- reset은 service-role 전용 `lms.reset_academy_data()` RPC로 실행되며, clean baseline 검증에서 authenticated 직접 실행이 거부됨을 확인했다.
- 아직 남은 작업: reset 2단계 confirm token.

Acceptance:
- reauth token 없이 reset/tax settings가 401/403.
- 외부 origin POST가 403.
- reset 실행 시 audit log에 actor, academy, target, count, timestamp가 남는다.

### P0-5. Supabase Data API exposed schema/grant 정책이 앱별로 충돌

Evidence:
- LMS: `src/core/supabaseClient.ts:15-23`은 `core,lms,content,learning,ai,data,reporting,audit` schema client를 만든다.
- LMS: `supabase/migrations/0002_integrated_data_model.sql:1693`은 `pgrst.db_schemas`를 전체 schema로 설정한다.
- grade-app: `C:\codes\nextum\grade-app\supabase\config.toml:13`은 `core, learning`만 expose한다.
- grade-app: `C:\codes\nextum\grade-app\scripts\apply-cloud-sql.mjs:89-93`도 `public, graphql_public, core, learning`으로 overwrite한다.

Risk:
- grade-app script가 나중에 실행되면 LMS REST/Data API가 깨진다.
- 여러 앱이 같은 DB global setting을 각자 수정하면 운영 재현성이 없다.

Fix:
- shared DB bootstrap/migration repo 또는 package를 만든다.
- `pgrst.db_schemas`, grants, default privileges는 공용 migration에서만 관리한다.
- 앱별 migration은 자기 domain table/function만 관리한다.

Acceptance:
- grade-app setup 실행 후에도 LMS schema들이 exposed 상태로 유지된다.
- CI에서 shared DB bootstrap -> LMS migration -> grade-app migration 순서 smoke가 통과한다.

## P1 Findings - 데이터 정합성 / 제품 기능 신뢰성

### P1-1. Migration이 빈 DB에서 self-contained하지 않음

Evidence:
- `supabase/migrations/0002_integrated_data_model.sql`은 `core.academies`, `core.profiles`, `learning.books` 등 grade-app 기존 구조를 가정한다.
- shared baseline 없이 AMS migration만 적용하면 순서 의존이 생긴다.

Risk:
- 새 Supabase DB 생성, disaster recovery, staging setup이 실패할 수 있다.

Fix:
- `0000_shared_baseline.sql`을 만들고 core/content/learning 기본 테이블을 한 곳에서 생성한다.
- LMS/grade-app은 baseline 이후 migration만 소유한다.
- 빈 DB migration test를 CI에 추가한다.

### P1-2. 학생 canonical identity가 아직 완전히 통합되지 않음

Evidence:
- `src/core/api/directoryAdapters.ts:103-113`은 numeric legacy id가 없으면 core student mapping을 포기한다.
- `src/core/api/students.ts:32-55`는 신규 학생을 `lms.students`에 생성한다.
- `src/core/api/enrollments.ts:31-38`은 numeric `student_id` 기반이다.
- `supabase/migrations/0001_lms_schema.sql:275-289`의 LMS enrollments도 numeric id 기반이다.

Risk:
- LMS 등록 학생, grade-app 로그인 학생, learning attempts, AI conversations, reporting rows가 서로 다른 학생처럼 남을 수 있다.

Fix:
- `Student` DTO에 `coreStudentId: string`과 `legacyLmsId: number | null`을 추가한다.
- 신규 생성 flow는 `core.people` + `core.students`를 먼저 만들고, 필요 시 `lms.students` legacy mirror를 만든다.
- grade-app attempts/sessions/reports는 `core_student_id`를 필수로 만든다.
- legacy id만 있는 API는 단계적으로 deprecate한다.

Acceptance:
- LMS 학생 생성 후 `core.students.id`가 반드시 생긴다.
- grade-app 로그인 후 같은 `core_student_id`로 attempts가 생성된다.
- LMS 리포트 API가 같은 `core_student_id`로 learning summary를 조회한다.

### P1-3. 학생 삭제/reset이 core/learning/AI 데이터와 충돌

Evidence:
- `src/core/api/students.ts:83-90`은 `lms.students` hard delete.
- `src/lib/lms/admin-operations.ts:104-107`은 students reset에서 LMS student/payment/enrollment를 삭제한다.
- `supabase/migrations/0003_lms_core_sync_and_compat_views.sql:103`의 sync는 insert/update 중심이다.

Risk:
- LMS에서 삭제한 학생이 core/reporting에는 계속 남는다.
- learning/AI 데이터는 고아 데이터가 되거나 리포트에 계속 집계된다.

Fix:
- 학생 삭제 기본값은 archive/status change.
- hard erase는 개인정보 삭제 요청 같은 별도 workflow로 분리한다.
- reset target은 learning/ai/data/audit 영향을 명확히 선택하게 한다.
- reset은 transaction RPC + audit log로 처리한다.

Implementation status:
- 2026-07-06 기준 legacy `window.api.students.delete()`는 `lms.students` hard delete 대신 `status='dropped'` update를 수행한다.
- 학생 상세 UI는 "삭제"가 아니라 "퇴원 처리"로 표시하고, 학습/채점/AI 데이터가 보존됨을 안내한다.
- LMS admin `students` reset은 `core.students`를 삭제하지 않는다. 대신 class assignment는 `dropped`, billing contract는 `archived`, student membership은 inactive, pending invitation은 expired, student row는 `dropped`로 상태 변경한다.
- reset audit payload는 상태 변경/삭제 구분을 위해 `operation`과 `affectedRows`를 남긴다.
- 2026-07-06 clean baseline에는 `lms.reset_academy_data()` RPC를 추가했고, LMS reset route는 이 RPC만 호출한다. Postgres 함수 호출 단위로 실행되므로 중간 실패 시 전체가 롤백된다.
- 아직 남은 작업: 개인정보 hard erase는 별도 승인 workflow로 분리.

### P1-4. account invitation flow가 제품 요구를 완전히 만족하지 않음

Evidence:
- DB에는 `core.account_invitations`가 있지만 LMS 런타임 signup은 아직 직접 admin metadata를 사용한다.
- 사용자가 말한 "LMS에서 학생 등록하면 회원가입 권한을 부여" 요구와 현재 signup flow가 맞지 않는다.

Risk:
- 학생이 원하는 아이디/비밀번호로 가입하는 UX와, 학원에서 승인한 학생만 가입하는 보안 모델이 분리되어 있다.

Fix:
- LMS admin이 학생 row에 invitation을 생성한다.
- 학생은 invitation token으로 signup한다.
- signup 후 `auth.users` -> `core.user_accounts` -> `core.students` 연결을 확정한다.
- invitation은 만료/재발급/취소/audit을 가진다.

Acceptance:
- invitation 없는 학생 signup은 LMS/grade-app 권한을 얻지 못한다.
- invitation token은 한 번만 사용 가능하다.
- signup 후 학생이 grade-app에 로그인하면 같은 `core_student_id`를 얻는다.

Implementation status:
- 2026-07-06 기준 LMS signup은 초대코드 기반 학생 가입으로 동작한다.
- 초대코드는 hash로 조회되고, 만료/사용 완료/학생 active 상태/중복 login id/이미 가입된 person을 검사한다.
- 가입 성공 시 `auth.users`, `core.user_accounts`, `core.academy_members(role='student')`, `core.account_invitations.accepted_at`이 연결된다.
- 남은 작업은 grade-app 로그인 후 같은 `core_student_id`가 end-to-end로 이어지는 통합 검증이다.

### P1-5. payroll DTO와 DB schema가 맞지 않음

Evidence:
- `src/components/accounting/PayrollManager.tsx:126-128`은 `gross_amount`, `withholding_tax`, `local_tax`, `net_amount`를 합산한다.
- `src/components/accounting/PayrollManager.tsx:345-355`, `537-547`은 `createPayroll` 호출 시 `net_amount`를 넘기지 않는다.
- `src/core/api/accounting.ts:507-527`은 `net_amount`를 필수로 보고 `amount: data.net_amount`를 저장한다.
- `src/core/api/accounting.ts:569-577`은 UI가 기대하는 세부 금액을 반환하지 않는다.

Risk:
- 급여 지급액이 `undefined`, `NaN`, 잘못된 net amount로 저장될 수 있다.
- 회계/세금 보고서가 틀어진다.

Fix:
- `instructor_payments`에 gross/tax/local/net/payment_method 컬럼을 명확히 추가하거나, 별도 payroll table을 둔다.
- API input/output DTO를 하나로 정의한다.
- UI 계산, DB 저장, export가 같은 DTO를 사용한다.

Implementation status:
- 2026-07-06 기준 legacy `createPayroll`은 gross/tax/local/net을 정규화해서 저장하고 `amount`에는 net amount를 호환값으로 남긴다.
- `listPayroll`은 gross/tax/local/net을 반환하고, 누락된 과거 행은 `amount` 기반 fallback으로 표시한다.
- legacy 대시보드/세무/손익 계산은 강사 급여 비용을 `gross_amount` 기준으로 계산한다. 과거 행은 `net_amount + withholding_tax + local_tax`, 또는 `amount + tax`로 보정한다.
- 새 LMS 급여 생성은 `lms.instructor_payments`의 `gross_amount`, `withholding_tax`, `local_tax`, `net_amount`, `hours_worked`, `hourly_rate` 컬럼을 직접 사용한다.
- 순수 계산 유틸 `src/modules/accounting/utils/payrollAmounts.ts`와 테스트를 추가했다.

### P1-6. 결제 status 불일치로 보고서가 누락됨

Evidence:
- `src/core/api/accounting.ts:435`의 학생 결제 default는 `completed`.
- `src/core/api/accounting.ts:652`, `755`, `778`은 `status = 'paid'`만 집계한다.

Risk:
- 정상 수납이 세금/VAT/손익 보고서에서 빠진다.

Fix:
- 완료 status를 `paid` 또는 `completed` 하나로 정한다.
- migration 기간에는 `in ('paid','completed')`로 집계한다.
- DB check constraint, UI label, report query를 같은 enum으로 맞춘다.

Implementation status:
- 2026-07-06 기준 새 LMS는 `payments.status = 'completed'`, `invoices.status = 'paid'`, `instructor_payments.status = 'paid'`를 각각 별도 의미로 유지한다.
- 위 상태값은 `src/features/lms/status.ts`의 공통 helper와 상수로 묶어 service, mutation, admin export, dashboard UI가 같은 기준을 사용한다.
- legacy `student_payments`는 이전 데이터 호환을 위해 `paid`와 `completed`를 모두 완료 수납으로 인정한다.
- 학생 월별 납부 상태는 완료 수납만 합산하고 최신 완료일을 표시하도록 수정했다.
- 상태 helper 테스트를 추가했다.

### P1-7. 기간 휴강과 recurring schedule 처리 오류

Evidence:
- `src/components/lessons/TimetableGrid.tsx:855`는 `ruleId || id`를 `lessonId`로 넘긴다.
- `src/core/api/schedules.ts:120-138`, `215-224`는 `lesson_id`로 materialized schedule만 update한다.
- virtual recurring schedule은 DB row가 없을 수 있다.

Risk:
- 휴강 처리가 0건으로 끝나거나 잘못된 lesson을 업데이트한다.
- 학원 운영에서 출결/보강/급여가 틀어진다.

Fix:
- period cancel API는 `lessonId`, `ruleId`, date range를 별도 인자로 받는다.
- 해당 기간의 recurring occurrence를 exception row로 materialize한다.
- transaction으로 cancel rows를 생성/업데이트한다.

Implementation status:
- 2026-07-06 기준 legacy 일정/강사 일정 목록은 materialized schedule key를 `lesson + date`가 아니라 `lesson + date + start_time + end_time`으로 판단한다.
- 같은 수업이 같은 날짜에 다른 시간대로 여러 번 있을 때 한 row가 다른 recurring occurrence를 숨기지 않도록 보정했다.
- 강사 급여 계산은 `cancelled` materialized row도 먼저 읽어 recurring 가상 수업 생성을 막고, 실제 시간 합산에서는 billable status만 포함한다.
- 남은 작업은 period cancel/create schedule을 DB transaction/RPC로 이동하는 것이다.

### P1-8. 보강/대강 workflow가 선택값을 버리고 status enum이 불일치

Evidence:
- `src/components/lessons/MakeupDialog.tsx:99-105`는 classroom만 넘긴다.
- `src/core/api/schedules.ts:226-246`은 `_classroomId`를 무시한다.
- `src/core/api/schedules.ts:111`은 `substituted`, `src/core/api/schedules.ts:197`은 `substitute`를 쓴다.
- `src/core/api/accounting.ts:237`은 `substitute`만 급여 계산에 포함한다.

Risk:
- UI에서 선택한 보강 강의실/강사가 반영되지 않는다.
- 대강 급여가 누락될 수 있다.

Fix:
- schedule status enum을 단일 타입/DB constraint/상수로 통일한다.
- makeup override classroom/instructor를 DB에 저장한다.
- salary 계산은 모든 유효 status를 명시적으로 처리한다.

Implementation status:
- 2026-07-06 기준 `createMakeup`은 선택한 classroom/instructor override를 `lesson_schedules`에 저장한다.
- legacy 일정 급여/대시보드 계산은 `scheduled`, `completed`, `substitute`, `makeup`을 공통 billable status로 사용한다.
- `substituted`/`substitute` 불일치 문자열은 현재 legacy 일정 API에서 발견되지 않았다.
- billable status와 materialized schedule key helper 테스트를 추가했다.

### P1-9. React hook order 위반 가능

Evidence:
- `src/components/people/students/StudentDetailPanel.tsx:34-45`는 `student`가 없으면 hook 전에 return한다.
- `src/components/people/students/StudentDetailPanel.tsx:47-49`는 이후 `useState`를 호출한다.

Risk:
- null 상태에서 학생 선택으로 바뀔 때 hook order 오류가 날 수 있다.

Fix:
- hooks를 early return 위로 이동하거나 empty/detail 컴포넌트를 분리한다.

Implementation status:
- 2026-07-06 기준 `StudentDetailPanel`의 state hook은 `student` null early return보다 위에서 호출된다.
- null 선택 상태에서 학생 선택 상태로 `rerender`해도 hook order가 바뀌지 않는 회귀 테스트를 추가했다.

## P2 Findings - 성능 / 확장성

### P2-1. 강사 급여 계산 N+1

Evidence:
- `src/core/api/accounting.ts:383-385`가 강사마다 `calculateInstructorMonthlySalary()`를 호출한다.
- `src/core/api/instructors.ts:430-568`은 강사별로 instructor, lessons, schedules, substitute schedules, rules를 다시 조회한다.

Risk:
- 강사 100명, 학원 100개 규모에서 DB round trip이 급증한다.

Fix:
- 월별 salary batch RPC/view를 만든다.
- `instructor_id[]`, month를 받아 한 번에 schedules/rules/payments를 group한다.
- 후보 index:
  - `lms.lessons(instructor_id)`
  - `lms.lesson_schedules(substitute_instructor_id, date) where substitute_instructor_id is not null`
  - `lms.lesson_rules(lesson_id, active)`

### P2-2. 회계/리포트 집계가 클라이언트 reduce 중심

Evidence:
- `src/core/api/accounting.ts:168-199`, `773-816` 등에서 row를 가져와 JS에서 합산한다.
- 기존 index는 `student_id/payment_date` 중심이라 academy/date/status 집계에 최적화되어 있지 않다.

Risk:
- 결제/지출 데이터가 누적될수록 payload와 브라우저 계산 비용이 커진다.

Fix:
- dashboard, income statement, tax summary를 SQL aggregate view/RPC로 이동한다.
- 후보 index:
  - `lms.student_payments(academy_id, payment_date, status)`
  - `lms.instructor_payments(academy_id, payment_date, status)`
  - `lms.expenses(academy_id, expense_date)`

### P2-3. 월별 강사 일정 조회가 월 전체 데이터를 가져와 필터링

Evidence:
- `src/core/api/schedules.ts:327-341`은 해당 월 전체 schedules를 조회한다.
- `src/core/api/schedules.ts:345-348`에서 instructor match를 JS로 필터링한다.

Risk:
- 학원 규모가 커지면 강사 한 명 화면에서도 월 전체 일정이 전송된다.

Fix:
- lesson ids by instructor + substitute query를 분리하거나 SQL view/RPC로 처리한다.
- `lesson_schedules(lesson_id,date)`, `lesson_schedules(substitute_instructor_id,date)`를 활용한다.

### P2-4. list/search API에 pagination이 거의 없음

Evidence:
- `src/core/api/students.ts:23-25`, `176-192`는 학생 전체를 가져온다.
- `src/core/api/instructors.ts:24-30`, `630-646`도 전체/검색 중심이다.
- `src/core/api/directoryAdapters.ts:70-80`은 reporting table 전체 `select('*')`다.

Risk:
- 학생/강사/학습 데이터가 누적될수록 초기 화면이 느려진다.

Fix:
- cursor pagination 도입.
- 검색은 prefix/full-text 전략 결정.
- 목록 DTO는 필요한 필드만 select.

### P2-5. directoryAdapters fallback이 운영에서 예측하기 어려움

Evidence:
- `src/core/api/directoryAdapters.ts:207-232`는 reporting view 후보를 순차 조회 후 core fallback.
- `src/core/api/directoryAdapters.ts:235-260`도 같은 방식.
- projection이 존재하지만 비어 있거나 mapping 실패하는 경우 source of truth가 불명확하다.

Risk:
- 학원별로 어떤 source에서 학생/강사를 읽는지 달라질 수 있다.

Fix:
- source priority를 config로 고정한다.
- empty view와 unavailable view를 다르게 처리한다.
- 선택된 source와 row count를 observability에 기록한다.

### P2-6. CSV export가 대용량 메모리 생성 방식임

Evidence:
- `src/lib/lms/admin-operations.ts`는 export 기간과 detail row 수를 제한한다.
- `src/lib/lms/csv.ts`는 CSV delimiter와 formula-like cell을 escape한다.
- `src/app/api/lms/admin/export/route.ts`는 `Cache-Control: no-store`를 내려준다.
- 다만 `csvSection()`과 export builder는 아직 전체 CSV 문자열을 메모리에 만든다.

Risk:
- 큰 export가 서버 메모리를 압박할 수 있다.

Fix:
- paging 또는 streaming export.
- export row limit 초과 시 사용자에게 기간 축소 UI를 명확히 안내한다.

Implementation status:
- 완료: 기간/row limit, `Cache-Control: no-store`, formula-like cell escape를 적용했다.
- 완료: `=`, `+`, `-`, `@`, leading whitespace/control character 뒤 formula marker를 `src/lib/lms/csv.test.ts`로 고정했다.
- 남음: 대용량 export를 streaming 또는 paged response로 바꾸는 작업.

## P3 Findings - 운영 / 배포 / 유지보수

### P3-1. 테스트가 제품 위험을 커버하지 못함

Evidence:
- `package.json`에는 lint/typecheck/test/build script가 있다.
- 현재 test는 date utils, lesson store, timetable, student list 등 UI/utility 중심이다.
- auth/RLS, migration, payroll, payment status, reset, export, grade-app integration test가 없다.

Risk:
- 실제 장애 가능성이 큰 보안/회계/통합 이슈가 CI에서 잡히지 않는다.

Fix:
- Supabase local DB 기반 integration test.
- two-academy RLS test.
- signup/invitation/admin route test.
- payroll/payment/reporting contract test.
- grade-app smoke를 CI job으로 분리.

### P3-2. 보안 헤더와 server-side page guard가 부족

Evidence:
- `next.config.ts:3-5`는 `reactStrictMode`만 설정한다.
- `src/proxy.ts:4-5`, `src/lib/supabase/proxy.ts:33`은 session refresh만 수행하고 route authorization은 하지 않는다.

Risk:
- SSR data fetching을 추가하는 순간 page-level 노출 위험이 커진다.
- CSP/frame/referrer 등 기본 브라우저 방어가 없다.

Fix:
- CSP, `frame-ancestors`, HSTS, Referrer-Policy, Permissions-Policy 추가.
- protected app layout에서 server-side auth/role guard.
- public route와 private route를 명확히 분리.

### P3-3. `window.api: any`가 contract bug를 숨김

Evidence:
- `src/types/window-api.d.ts:3`은 `api: any`.
- `src/core/api/legacyShim.ts:6`은 `window.api = supabaseApi`.
- payroll DTO mismatch가 타입에서 잡히지 않았다.

Risk:
- Electron migration compatibility layer가 장기 유지보수 리스크가 된다.

Fix:
- `window.api` 타입을 `typeof supabaseApi`로 변경.
- 신규 코드는 typed import/API hook 사용.
- legacy shim 제거 계획 수립.

### P3-4. 운영 audit/observability 부족

Evidence:
- admin reset/export/tax settings는 console error만 남긴다.
- `audit.audit_logs` schema는 있지만 LMS admin route에서 적극적으로 쓰지 않는다.
- debug log에 user email 등 개인 정보가 출력될 수 있다.

Risk:
- 누가 언제 학생/회계 데이터를 export/reset했는지 추적하기 어렵다.
- 개인정보 로그 노출 가능성이 있다.

Fix:
- admin action audit log.
- structured logs with request id, actor id, academy id.
- PII redaction.
- error tracking/SLO dashboard.

### P3-5. backup/restore, data retention, privacy policy가 코드에 반영되어 있지 않음

Risk:
- 학원 데이터 유실 또는 학생 개인정보 삭제 요청에 대응하기 어렵다.

Fix:
- daily backup + restore drill.
- 학생 archive/erase policy.
- learning/AI/report data retention policy.
- 개인정보 export/delete request process.

## Target Architecture

### Canonical identity

권장 기준:
- `core.people`: 사람의 개인정보.
- `core.user_accounts`: Supabase Auth user와 person 연결.
- `core.students`: 학생의 canonical id.
- `core.staff_members`: 강사/staff canonical id.
- `core.academy_members`: 학원별 role/권한.
- `core.account_invitations`: 학생/직원 signup 권한.

LMS legacy:
- `lms.students.id`는 legacy numeric id.
- `lms.enrollments.student_id`는 전환기 legacy id.
- 모든 신규 report/learning/AI는 `core.students.id`를 기준으로 한다.

### Data ownership

권장 schema ownership:
- `core`: shared identity/tenant.
- `lms`: 수업, 강의실, 수납, 운영.
- `content`: 교재/문항. 정답은 staff-only.
- `learning`: sessions/attempts/assignments/wrong notes.
- `ai`: conversations/messages/attachments.
- `reporting`: security_invoker views or server-only aggregate views.
- `audit`: immutable audit logs.

### API boundary

권장:
- 일반 read는 RLS가 안전한 경우 Supabase client 허용.
- 민감 write는 Next.js route handler/server action/RPC.
- destructive/multi-table 작업은 DB transaction RPC.
- service-role client는 server-only module에서만 사용.

## Implementation Plan

### Week 0 - Stop-the-line security

1. signup role metadata 제거.
2. admin auth를 `academy_members` owner/admin만 신뢰하게 변경.
3. `lms.profiles` role/current academy client update 차단.
4. content answer 노출 차단.
5. grade-app exposed schema overwrite 제거.
6. admin route CSRF/origin/reauth 추가.

### Week 1-2 - Business correctness

1. payment status enum 통일. 완료: 2026-07-06 LMS 상태 helper/legacy 호환 집계 적용.
2. payroll DTO/schema 통일. 완료: 2026-07-06 gross/net/tax 저장 및 회계 계산 보정 적용.
3. StudentDetailPanel hook order 수정. 완료: 2026-07-06 회귀 테스트 추가.
4. period cancel transaction API. 부분 완료: materialized schedule key/급여 계산 보정, transaction/RPC 이전은 남음.
5. makeup/substitute model 수정. 부분 완료: billable status/helper 통일, DB 제약/RPC 정리는 남음.
6. `lms.settings` `(academy_id,key)` migration. 완료: 2026-07-06 baseline PK/upsert/read filter 확인 및 legacy read path 보정.

### Week 2-4 - Shared DB rearchitecture

1. shared baseline migration.
2. account invitation flow.
3. `coreStudentId`/`legacyLmsId` dual DTO.
4. LMS create/update/delete를 core-first로 변경.
5. grade-app auth lookup을 academy/status-aware로 변경.
6. report views/API 연결.

### Week 4-8 - Scale/operations

1. salary batch RPC.
2. accounting aggregate RPC/views.
3. pagination/cursor search.
4. security/performance advisor gate.
5. e2e + Supabase local integration test.
6. audit logs, monitoring, backup/restore drill.

## Release Gates

출시 전 최소 gate:

1. `npm run lint`, `npm run typecheck`, `npm test -- --run`, `npm run build` 통과.
2. 빈 DB migration smoke 통과.
3. Supabase Security Advisor high/critical 0.
4. Supabase Performance Advisor major missing index 검토 완료.
5. 두 학원 RLS isolation test 통과.
6. 학생 signup invitation flow e2e 통과.
7. LMS 등록 학생이 grade-app에서 같은 `core_student_id`로 로그인/채점되는 smoke 통과.
8. 학생 계정으로 정답 select 불가.
9. reset/export/tax settings route가 non-admin/invalid-origin/no-reauth에서 거절.
10. payroll/payment/tax report fixture가 expected amount와 일치.

## Final Assessment

현재 상태는 "프로덕션 다학원 SaaS 출시 전 보류"다.

이유:
- P0 보안 이슈가 실제 데이터 탈취/권한 상승으로 이어질 수 있다.
- shared DB contract가 앱별 script에 의해 깨질 수 있다.
- 학생 identity가 canonical id 중심으로 완전히 정리되지 않았다.
- 회계/급여/결제 status에 실제 금액 오류 가능성이 있다.

다만 기본 방향은 맞다. `core`, `lms`, `content`, `learning`, `ai`, `reporting`, `audit`로 도메인을 분리하려는 구조는 장기적으로 좋은 방향이다. 다음 단계는 이 구조를 문서가 아니라 런타임, RLS, migration, 테스트까지 일관되게 맞추는 것이다.
