# LMS Code Review & Optimization Report

작성일: 2026-07-06

대상:
- LMS repo: `C:\codes\nextum\AMS`
- Branch: `codex/nextjs-migration`
- Baseline commit: `501ae04`
- grade-app: `C:\codes\nextum\grade-app` 읽기 전용 확인

## 리뷰 방식

사용자가 요청한 대로 subagent를 병렬로 사용했다.

- DB/Supabase/Postgres 리뷰
- Next.js 서버/API/보안 리뷰
- LMS 앱/도메인 로직 리뷰
- grade-app 호환성/공유 DB 리뷰

메인 에이전트는 결과를 통합하면서 핵심 라인 번호를 직접 재확인했다. 라이브 Supabase Security Advisor, Performance Advisor, `EXPLAIN ANALYZE`는 실행하지 않았으므로 실제 운영 DB 상태는 별도 검증이 필요하다.

공식 문서 기준:
- Supabase RLS: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase API 보안: https://supabase.com/docs/guides/api/securing-your-api
- Supabase Advisors: https://supabase.com/docs/guides/database/database-advisors
- 2026 Data API grant 변경: https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically

## 결론

현재 최적화보다 먼저 막아야 할 것은 보안/권한 모델이다. 지금 구조에서는 회원가입 경로와 RLS 정책 조합 때문에 일반 사용자가 LMS admin 권한을 얻을 수 있고, academy member면 주요 LMS 테이블에 광범위한 쓰기 권한을 가질 수 있다.

성능 병목은 강사 급여 N+1, 월별 일정 조회의 앱 필터링, 회계 집계의 클라이언트 reduce, 전역 CSV export 메모리 생성 쪽이다. 하지만 이 성능 작업은 권한/데이터 정합성 정리 후에 진행하는 것이 맞다.

장기 구조에서는 `core.students.id`를 canonical student id로 두고, LMS numeric id는 호환용 legacy id로만 유지해야 한다. LMS와 grade-app이 같은 DB를 쓸 계획이면 schema exposure, migration ownership, 학생 삭제/보관 정책을 하나의 공유 계약으로 고정해야 한다.

## P0 - 즉시 차단 이슈

### 1. self-signup으로 LMS admin 승격 가능

근거:
- `src/screens/LoginPage.tsx:48`에서 회원가입 시 `{ role: 'admin' }` metadata를 전송한다.
- `supabase/migrations/0001_lms_schema.sql:106`에서 `raw_user_meta_data->>'role'`를 읽는다.
- `supabase/migrations/0001_lms_schema.sql:119-138`에서 해당 role로 `lms.profiles`, `lms.academy_members`를 만든다.
- `supabase/migrations/0001_lms_schema.sql:470-474`에서 사용자가 자기 `lms.profiles` row를 update할 수 있다.
- `src/lib/lms/auth.ts:47-61`에서 `profiles.role = 'admin'`이면 admin으로 인정한다.

영향:
- 공개 회원가입이 켜져 있거나 signup API가 호출 가능하면 사용자가 admin 권한을 얻을 수 있다.
- admin route의 reset/export/tax settings 같은 기능까지 접근 가능해진다.

권장 수정:
- LMS 공개 회원가입을 끄거나, signup UI/API에서 role metadata를 제거한다.
- `raw_user_meta_data`를 권한 판단에 쓰지 않는다. 사용자 metadata는 사용자가 조작 가능한 영역으로 봐야 한다.
- admin 권한은 서버가 만든 invite/provisioning record 또는 `academy_members`의 서버 관리 row만 신뢰한다.
- `profiles.role`, `profiles.current_academy_id`는 클라이언트 update를 금지한다.
- `assertLmsAdmin()`은 `profiles.role` fallback을 제거하고 active `academy_members` owner/admin만 허용한다.

### 2. academy member에게 LMS 주요 테이블 전체 CRUD가 열림

근거:
- `supabase/migrations/0001_lms_schema.sql:63-77`의 `lms.belongs_to_current_academy()`는 role이 아니라 membership만 본다.
- `supabase/migrations/0001_lms_schema.sql:481-497`에서 학생, 강사, 수업, 회계, settings 등에 `FOR ALL TO authenticated` 정책을 생성한다.
- `supabase/migrations/0001_lms_schema.sql:560-561`, `supabase/migrations/0002_integrated_data_model.sql:1660-1668`에서 broad grants가 있다.

영향:
- 학생/강사/일반 staff 계정도 RLS상 쓰기/삭제가 가능해질 수 있다.
- grade-app 학생 계정이 LMS membership과 연결되면 더 큰 권한 문제가 된다.

권장 수정:
- `select`, `insert`, `update`, `delete` 정책을 분리한다.
- 학생/강사는 본인 관련 read만 허용하고, LMS 운영 write는 owner/admin/staff로 제한한다.
- 회계, settings, reset성 작업은 서버 route/RPC로만 수행하고 audit log를 남긴다.
- exposed schema의 모든 테이블은 RLS 활성화와 explicit grant를 같이 검증한다.

### 3. 문제 정답 데이터가 authenticated 전체에 노출됨

근거:
- `supabase/migrations/0002_integrated_data_model.sql:985-996`의 `content.problems`에 `answer`, `answer_image_path`가 있다.
- `supabase/migrations/0002_integrated_data_model.sql:1169-1171`에서 `content.problems` read policy가 `using (true)`다.
- `supabase/migrations/0002_integrated_data_model.sql:1662`, `1693`에서 content schema가 Data API에 노출되고 authenticated select가 부여된다.

영향:
- grade-app 학생이 풀이 전에 정답을 직접 읽을 수 있다.
- 향후 리포트/AI 채팅 데이터 신뢰도가 깨진다.

권장 수정:
- 정답은 `content.problem_answers` 같은 staff-only 테이블로 분리한다.
- 학생 앱은 정답이 없는 `content.student_problems` view만 읽게 한다.
- 채점은 answer를 반환하지 않는 RPC/server route로 처리한다.

### 4. destructive admin route는 재인증/confirm token을 사용하지만 CSRF 세분화가 더 필요

근거:
- reset/export/tax-settings는 same-origin, owner/admin, reauth cookie를 검증한다.
- reset은 `/api/lms/admin/reset/confirm`에서 60초짜리 user/academy/action/target scoped confirm token을 받은 뒤 실행된다.
- 세금 저장, CSV export, reset UI는 `PasswordConfirmDialog`를 통해 서버 reauth 후 실행된다.

영향:
- cookie-auth POST route라서 origin/CSRF 검증이 필요하다.

권장 수정:
- Origin 검사에 더해 form-level CSRF token까지 추가한다.
- admin route 거절 케이스를 route-level test로 고정한다.

적용 상태:
- 완료: server reauth cookie, reset confirm token, export range/row limit.
- 남음: form-level CSRF token, route-level rejection tests.

## P1 - 데이터 정합성 / 실제 기능 버그

### 5. grade-app이 shared Data API schema exposure를 덮어쓸 수 있음

근거:
- `C:\codes\nextum\grade-app\supabase\config.toml:13`은 `core`, `learning`만 expose한다.
- `C:\codes\nextum\grade-app\scripts\apply-cloud-sql.mjs:89-93`도 `public, graphql_public, core, learning`만 설정한다.
- LMS는 `src/core/supabaseClient.ts:15-23`에서 `core,lms,content,learning,ai,data,reporting,audit`를 쓴다.
- LMS migration은 `supabase/migrations/0002_integrated_data_model.sql:1693`에서 전체 schema exposure를 설정한다.

영향:
- grade-app cloud script가 LMS migration 이후 실행되면 LMS의 `lms`, `content`, `reporting` API가 사라질 수 있다.

권장 수정:
- DB global 설정은 앱별 script가 건드리지 않게 한다.
- shared DB bootstrap repo 또는 공용 migration 패키지를 하나 둔다.
- 두 앱 모두 같은 exposed schema contract를 import/문서화한다.

### 6. LMS migration이 fresh shared DB에서 self-contained하지 않음

근거:
- `supabase/migrations/0002_integrated_data_model.sql`은 schema를 만들지만 grade-app v1의 `core.academies`, `core.profiles`, `learning.books` 등 기존 테이블 존재를 가정한다.
- subagent 확인 기준으로 fresh DB에서 AMS migration만 적용하면 순서 의존성이 생긴다.

영향:
- 새 DB를 만들 때 migration 순서가 문서 밖에 있으면 재현성과 장애 복구가 약해진다.

권장 수정:
- `base shared schema` migration을 별도 첫 단계로 만들고 두 앱이 같은 baseline에서 출발하게 한다.
- 앱별 migration은 shared baseline 이후만 책임지게 한다.
- CI에서 빈 DB에 전체 migration을 적용하는 smoke를 만든다.

### 7. LMS hard delete/reset이 core.students와 learning history를 동기화하지 않음

근거:
- `src/core/api/students.ts:83-87`에서 LMS student를 hard delete한다.
- `src/lib/lms/admin-operations.ts:104-107`에서 student reset도 LMS 테이블 중심으로 삭제한다.
- `supabase/migrations/0003_lms_core_sync_and_compat_views.sql:103`의 sync trigger는 insert/update 중심이다.
- reporting roster는 core 기반 view를 사용한다.

영향:
- LMS에서 학생 삭제 후에도 `core.students`와 learning/AI 데이터가 남아 보고서에 나타날 수 있다.
- 반대로 grade-app 학습 데이터와 LMS 학생 목록이 갈라질 수 있다.

권장 수정:
- 학생 삭제는 기본적으로 archive/status 변경으로 바꾼다.
- 개인정보 삭제가 필요한 경우에만 별도 admin-only erase workflow를 둔다.
- LMS reset은 core/learning/ai/data 영향 범위를 명시한 transactional RPC로 처리한다.

### 8. LMS 런타임이 아직 numeric legacy student id 중심

근거:
- `src/core/api/directoryAdapters.ts:103-113`에서 numeric id가 없으면 core student mapping이 실패한다.
- `src/core/api/students.ts:32-38`은 여전히 `lms.students`를 생성한다.
- `src/core/api/enrollments.ts:29-37`은 numeric `student_id`를 사용한다.
- `supabase/migrations/0001_lms_schema.sql:275-289`의 LMS enrollment도 legacy numeric id 기반이다.

영향:
- LMS에서 등록된 학생, grade-app 로그인 학생, learning attempts/reports의 canonical id가 계속 어긋난다.

권장 수정:
- 프론트 DTO에 `coreStudentId`와 `legacyLmsId`를 같이 싣는다.
- 신규 기능은 `core.students.id`를 기준으로 만든다.
- legacy LMS numeric id는 enrollments/billing 호환 필드로만 유지하고 단계적으로 축소한다.

### 9. payroll UI/API contract가 깨져 있음

근거:
- `src/components/accounting/PayrollManager.tsx:126-128`은 `gross_amount`, `withholding_tax`, `local_tax`, `net_amount`를 합산한다.
- `src/components/accounting/PayrollManager.tsx:345-355`, `537-547`에서 `createPayroll` 호출 시 `net_amount`를 넘기지 않는다.
- `src/core/api/accounting.ts:507-527`의 `createPayroll`은 `net_amount`를 필수로 보고 `amount: data.net_amount`만 저장한다.
- `src/core/api/accounting.ts:569-577`의 `listPayroll`은 UI가 기대하는 gross/tax/net 필드를 반환하지 않는다.

영향:
- 급여 합계가 `NaN` 또는 잘못된 값이 될 수 있다.
- 실제 지급액과 원천징수/지방세 계산이 DB에 보존되지 않는다.

권장 수정:
- payroll DTO/schema를 하나로 확정한다.
- DB에 `gross_amount`, `withholding_tax`, `local_tax`, `net_amount`, `payment_method`를 저장하거나, 기존 `amount`를 net으로 정의하고 나머지는 별도 컬럼/계산 view로 제공한다.
- UI, API, export가 같은 DTO를 쓰게 한다.

### 10. 일반 수강료 결제가 세금/VAT/손익 보고서에서 빠질 수 있음

근거:
- `src/core/api/accounting.ts:435`에서 학생 결제 기본 status는 `completed`다.
- `src/core/api/accounting.ts:652`, `755`, `778`의 세금/VAT/손익 쿼리는 `status = 'paid'`만 본다.

영향:
- 정상 결제된 수강료가 연간 세금/손익 보고서에서 0 또는 과소 집계될 수 있다.

권장 수정:
- 결제 완료 status를 하나로 표준화한다.
- 전환기에는 모든 회계 집계가 `in ('paid', 'completed')`를 사용하게 한다.
- DB check constraint와 UI label도 같은 enum을 쓰게 한다.

### 11. 기간 휴강이 잘못된 id를 넘기고 materialized row만 업데이트함

근거:
- `src/components/lessons/TimetableGrid.tsx:855`에서 `ruleId || id`를 `lessonId` prop으로 넘긴다.
- `src/core/api/schedules.ts:120-138`, `215-224`는 `.eq('lesson_id', lessonId)`로 materialized schedule만 update한다.

영향:
- virtual recurring schedule은 DB row가 없어서 기간 휴강이 0건 처리될 수 있다.
- `ruleId`가 lesson id처럼 전달되면 엉뚱한 row를 대상으로 삼는다.

권장 수정:
- period cancel API는 `lessonId`, `ruleId`, date range를 분리해서 받는다.
- 해당 기간의 exception/cancel row를 materialize한 뒤 transaction으로 처리한다.

### 12. 학생 상세 패널이 React hook order를 위반할 수 있음

근거:
- `src/components/people/students/StudentDetailPanel.tsx:34-45`에서 `student`가 없으면 hook 전에 return한다.
- `src/components/people/students/StudentDetailPanel.tsx:47-49`에서 이후 `useState`를 호출한다.

영향:
- null 상태에서 학생 선택으로 바뀔 때 hook order 오류가 날 수 있다.

권장 수정:
- 모든 hook을 early return보다 위로 올린다.
- 더 깔끔하게는 empty/detail 컴포넌트를 분리한다.

### 13. 보강/대강 workflow가 선택값을 일부 버리고 status enum도 불일치

근거:
- `src/components/lessons/MakeupDialog.tsx:99-105`는 classroom만 넘기고 instructor/notes 선택은 전달하지 않는다.
- `src/core/api/schedules.ts:226-246`에서 `_classroomId`는 무시된다.
- `src/core/api/schedules.ts:111`은 `substituted`, `src/core/api/schedules.ts:197`은 `substitute`를 쓴다.
- `src/core/api/accounting.ts:237`은 salary 집계에서 `substitute`만 포함한다.

영향:
- UI에서 선택한 보강 강의실/강사 정보가 반영되지 않을 수 있다.
- 대강 급여가 누락될 수 있다.

권장 수정:
- schedule status enum을 하나로 통일한다.
- makeup row에 override classroom/instructor를 명시적으로 저장하거나 linked makeup model을 둔다.
- salary 계산이 모든 유효 status를 같은 기준으로 보게 한다.

## P2 - 성능 / 운영 효율

### 14. `lms.settings`가 academy별이 아니라 전역 key로 충돌

근거:
- `supabase/migrations/0001_lms_schema.sql:294-300`에서 `key text primary key`다.
- `src/lib/lms/admin-operations.ts:296-307`은 `academy_id`를 넣지만 `onConflict: 'key'`로 upsert한다.
- `src/core/api/accounting.ts:596-598`은 `tax_%`만 읽고 academy filter가 없다.

영향:
- 여러 학원이 생기면 tax settings가 서로 덮인다.

권장 수정:
- unique key를 `(academy_id, key)`로 바꾼다.
- upsert conflict target도 `academy_id,key`로 바꾼다.
- read path는 academy context로 filter한다.

상태:
- 2026-07-06 기준 clean baseline의 `lms.settings`는 `(academy_id, key)` primary key를 사용한다.
- tax settings 저장 경로는 `onConflict: 'academy_id,key'`를 사용한다.
- legacy 회계 tax settings 읽기 경로도 현재 academy로 filter한다.

### 15. reset과 lesson create/update가 transaction이 아님

근거:
- `src/lib/lms/admin-operations.ts:88-145`에서 reset이 여러 delete를 순차 실행한다.
- `src/core/api/lessons.ts:214-270`에서 lesson 생성 후 rule/schedule 생성이 분리되어 있다.
- `src/core/api/lessons.ts:326-386`도 schedule materialization과 rule update가 분리되어 있다.

영향:
- 중간 실패 시 orphan lesson, 일부 삭제, 일부 materialized schedule 같은 partial state가 남는다.

권장 수정:
- reset, lesson create/edit, period cancel은 DB RPC 또는 server route 내부 transaction으로 옮긴다.
- destructive RPC는 affected counts와 audit log를 남긴다.
- schedule materialization에는 uniqueness constraint와 idempotent upsert를 둔다.

### 16. 강사 급여 계산이 N+1 구조

근거:
- `src/core/api/accounting.ts:383-385`에서 강사마다 `calculateInstructorMonthlySalary()`를 호출한다.
- `src/core/api/instructors.ts:430-568`의 callee는 강사별로 instructor, lessons, schedules, substitute schedules, rules를 조회한다.

영향:
- 강사 수가 늘면 DB 왕복이 선형 이상으로 증가한다.

권장 수정:
- 월별 salary 계산을 batch RPC/view로 만든다.
- 최소한 lesson/schedule/rule을 한 번에 가져와 instructor id로 group한다.
- 후보 인덱스:
  - `lms.lessons(instructor_id)`
  - `lms.lesson_schedules(substitute_instructor_id, date) where substitute_instructor_id is not null`
  - `lms.lesson_rules(lesson_id, active)`

### 17. 회계 집계가 row fetch 후 JS reduce 중심

근거:
- `src/core/api/accounting.ts:168-199`, `773-816` 등에서 기간 row를 가져와 클라이언트에서 합산한다.
- 현재 index는 `student_payments(student_id, payment_date)`, `instructor_payments(instructor_id, payment_date)`, `expenses(expense_date)` 중심이다.

영향:
- 회계 데이터가 많아지면 network payload와 브라우저 계산 비용이 늘어난다.

권장 수정:
- dashboard, income statement, tax summary는 SQL aggregate view/RPC로 옮긴다.
- 후보 인덱스:
  - `lms.student_payments(academy_id, payment_date, status)`
  - `lms.instructor_payments(academy_id, payment_date, status)`
  - `lms.expenses(academy_id, expense_date)`
  - 필요 시 완료 결제 partial index

### 18. `schedules.instructorMonth`가 월 전체 schedule을 가져와 앱에서 필터링

근거:
- `src/core/api/schedules.ts:327-341`에서 해당 월 전체 `lesson_schedules`를 가져온다.
- `src/core/api/schedules.ts:345-348`에서 instructor match를 JS로 필터링한다.

영향:
- 월 일정이 커지면 강사 1명 화면을 위해 전체 월 데이터를 전송한다.

권장 수정:
- `lessons.instructor_id = instructorId`인 lesson ids를 먼저 좁히고 schedule query에 반영한다.
- substitute는 `substitute_instructor_id`로 별도 query 후 merge한다.
- 장기적으로는 `lms.instructor_month_schedules(instructor_id, month)` RPC/view를 둔다.

### 19. CSV export가 아직 전체 문자열을 메모리에 만든다

근거:
- `src/lib/lms/admin-operations.ts`는 export 기간과 detail row 수를 제한한다.
- `src/lib/lms/csv.ts`는 CSV delimiter와 formula-like cell을 escape한다.
- `src/app/api/lms/admin/export/route.ts`는 `Cache-Control: no-store`를 내려준다.
- 다만 `csvSection()`과 export builder는 아직 전체 CSV를 메모리 문자열로 만든다.

영향:
- 큰 기간 export가 서버 메모리를 크게 쓸 수 있다.

권장 수정:
- paging/streaming으로 생성한다.
- row limit 초과 시 UI에서 기간 축소 안내를 더 명확하게 보여준다.

적용 상태:
- 완료: 기간/row limit, `Cache-Control: no-store`, formula-like cell escape.
- 완료: `=`, `+`, `-`, `@`, leading whitespace/control character 뒤 formula marker 방어를 `src/lib/lms/csv.test.ts`로 검증한다.
- 남음: 대용량 export의 streaming/paging 전환.

### 20. `window.api` shim이 legacy contract를 길게 끌고 간다

근거:
- `src/core/api/legacyShim.ts:6`에서 `window.api = supabaseApi`.
- `src/types/window-api.d.ts`는 현재 `api: typeof supabaseApi`로 선언되어 있다.
- `src/core/types.ts`에는 더 이상 전역 선언에 쓰이지 않는 legacy `WindowApi` type이 남아 있다.

영향:
- Electron migration 호환층이 남아 신규 코드 품질을 낮춘다.

권장 수정:
- 신규 컴포넌트는 `window.api` 대신 typed API import를 사용한다.
- 기능별 contract test를 추가한다.
- 사용되지 않는 legacy `WindowApi` type을 정리한다.

적용 상태:
- 완료: 전역 `window.api` 타입은 `typeof supabaseApi`로 고정되어 있다.
- 남음: 기존 컴포넌트의 `window.api` 직접 사용을 typed import/API hook으로 점진 전환한다.

## 권장 작업 순서

### Phase 0 - 코드만으로 즉시 막기

1. signup에서 `role: 'admin'` metadata 제거 및 admin signup UI 차단.
2. `assertLmsAdmin()`이 `profiles.role`을 신뢰하지 않게 수정.
3. `StudentDetailPanel` hook order 수정.
4. payment status 집계 `paid/completed` 통일.
5. payroll DTO와 UI/API contract 수정.
6. destructive admin route에 origin/CSRF/re-auth challenge 추가.
7. `window.api` 타입을 `typeof supabaseApi`로 변경.

### Phase 1 - DB 보안 migration

1. `lms.profiles` role/current academy 클라이언트 update 차단.
2. LMS RLS를 role별 select/write/delete 정책으로 분리.
3. content answers를 staff-only 저장소로 분리하고 학생용 view/RPC 제공.
4. `lms.settings`를 `(academy_id, key)` unique로 변경.
5. broad grants/default grants를 explicit grants로 정리.
6. `SECURITY DEFINER` 함수는 `REVOKE EXECUTE FROM PUBLIC, anon`, 안전한 search path, 명시 grant로 정리.
7. Supabase Security Advisor/Performance Advisor 실행.

### Phase 2 - LMS/grade-app 공유 DB 계약 정리

1. shared schema exposure를 단일 계약으로 고정한다.
2. shared baseline migration을 별도 관리한다.
3. `core.students.id`를 canonical id로 정하고, LMS DTO에 `coreStudentId`/`legacyLmsId`를 같이 싣는다.
4. 학생 삭제는 archive-first로 바꾸고 erase는 별도 admin workflow로 둔다.
5. grade-app 학생 lookup은 academy/status를 포함해 canonical helper를 사용하게 한다.

### Phase 3 - 성능 최적화

1. 월별 급여 batch RPC/view.
2. accounting aggregate RPC/view.
3. schedule instructor month RPC/view.
4. composite/partial indexes 추가 후 `EXPLAIN ANALYZE` 검증.
5. CSV export paging/streaming.
6. reporting views를 LMS 리포트 기능에서 직접 소비하는 API 설계.

## 추천 테스트 추가

- public signup이 admin을 만들 수 없는지.
- admin route가 non-admin, stale reauth, invalid origin에서 거절되는지.
- `lms.profiles.role/current_academy_id`가 클라이언트 update로 변경되지 않는지.
- payroll create/list/export가 같은 DTO를 유지하는지.
- `completed` 결제가 tax/VAT/income statement에 포함되는지.
- period cancel이 recurring virtual schedule에도 exception row를 만드는지.
- makeup/substitute status가 salary 계산에 반영되는지.
- `StudentDetailPanel`이 null -> selected 전환에서 hook 오류 없이 렌더링되는지.
- fresh DB에서 shared baseline + LMS + grade-app migration이 순서대로 적용되는지.
- grade-app script가 `pgrst.db_schemas`를 축소하지 않는지.

## 운영 메모

- `.env.local`은 git ignore 상태로 확인됐다. 다만 로컬에 실제 `SUPABASE_SECRET_KEY`가 있으므로, 이 값이 외부 채널에 노출된 적이 있으면 rotate가 필요하다.
- 현재 `main`, `origin/main`, `codex/nextjs-migration`이 같은 커밋인지 여부는 보고서 작성 전 기준으로는 `501ae04`였다. 이 문서 추가 후에는 새 문서 커밋이 생긴다.
