# NEXTUM LMS / grade-app 앱 변경 영향 정리

작성 기준일: 2026-07-05

이 문서는 `C:\codes\nextum\grade-app`과 `C:\codes\nextum\AMS`를 각각 탐색한 결과를 기준으로, DB 재편에 맞춰 앱에서 바꿔야 할 지점을 정리한다. 목표는 두 앱이 같은 Supabase 프로젝트와 같은 canonical student ID를 쓰도록 만드는 것이다.

## 전체 변경 방향

두 앱 모두 테이블을 직접 흩어져 호출하는 구조에서 도메인 API/RPC/view를 거치는 구조로 바꾼다.

- 로그인 후 학생 식별: `auth.uid()` 직접 사용 금지, `core.current_student_id()` 또는 account lookup 사용
- 학생 원본: `core.students`
- 강사/관리자 원본: `core.staff_members`, `core.academy_members`
- 수업/수강 원본: `lms.lessons`, `lms.enrollments`
- 교재/문제 원본: `content.*`
- 풀이/채점 원본: `learning.*`
- 학생 리포트 조회: `reporting.*`

## grade-app 변경 계획

### DB/migration 변경

현재 grade-app 마이그레이션은 `core`와 `learning` 중심이다.

- `supabase/migrations/0001_core.sql`
  - 현재: `core.academies`, `core.profiles`, `core.classes`, `core.class_students`, `core.class_books`
  - 변경: `core`는 사람/계정/학생/멤버십만 담당
  - `classes`, `class_students`, `class_books`는 제거하거나 v2에서는 생성하지 않음

- `supabase/migrations/0002_learning.sql`
  - 현재: `learning.books`, `learning.units`, `learning.problems`, `learning.sessions`, `learning.attempts`, `learning.wrong_notes`, `learning.reports`
  - 변경: `books/units/problems`는 `content`로 이동
  - `sessions/attempts/wrong_notes`는 `learning` 유지
  - `reports`는 문제 오류 신고 성격이면 `content.problem_reports`로 이동

- `supabase/migrations/0003_concepts.sql`
  - 현재: `learning.concepts`, `learning.types`
  - 변경: `content.concepts`, `content.problem_types`

- `supabase/config.toml`
  - 현재 노출 스키마가 `core`, `learning` 중심
  - 변경: `core`, `lms`, `content`, `learning`, `ai`, `data`, `reporting` 노출 검토

### 코드 변경

중앙 데이터 계층부터 바꾼다.

| 파일 | 변경 내용 |
| --- | --- |
| `src/lib/data/db.ts` | `learning` 하나로 읽던 교재/문제와 세션/시도를 `content`와 `learning`으로 분리 |
| `src/lib/auth.ts` | `core.profiles.id = auth.uid()` 가정 제거, `core.user_accounts` 기반 현재 사람/학생 조회 |
| `src/lib/supabase/clients.ts` | schema별 client/helper 제공 |
| `src/app/api/problem-image-url/route.ts` | 문제 이미지 권한 확인을 `content.problems`와 `learning.assignments` 기준으로 변경 |
| `src/components/TutorChat.tsx` | AI 대화 저장을 `ai.conversations`, `ai.messages`, `data.events`로 연결 |
| `src/app/api/tutor*/route.ts` | 학생/문제/세션 ID를 v2 ID 모델로 검증 |
| `src/app/login/page.tsx` | 학생 가입/로그인은 LMS 초대권 claim 흐름과 연결 |
| `src/app/books/**`, `src/app/solve/**`, `src/app/result/**` | 교재 접근 권한과 채점 저장 ID를 새 구조로 변경 |

### 스크립트 변경

| 파일 | 변경 내용 |
| --- | --- |
| `scripts/import-book.mjs` | `content.books/units/concepts/problem_types/problems`로 import |
| `scripts/seed-roster.mjs` | 임시 roster seed를 중단하거나 `core`/`lms` v2 seed로 변경 |
| `scripts/verify-db.mjs` | schema별 검증으로 분리 |
| `scripts/verify-student-flow.mjs` | 학생 초대, 로그인 alias, `core.current_student_id()`, attempt insert 검증 |
| `scripts/apply-cloud-sql.mjs` | exposed schema와 migration 순서 v2 반영 |

### grade-app 우선순위

1. schema client 분리
2. content import/read path 이동
3. auth student lookup 변경
4. assignment 기반 교재 접근 권한 구현
5. sessions/attempts의 `student_id`를 `core.students.id`로 변경
6. AI chat 저장 연결
7. reporting view 소비로 결과 화면 정리

## LMS 앱 변경 계획

현재 `C:\codes\nextum\AMS`는 이름을 LMS로 바꾸었지만, DB 구조는 `lms` 스키마 하나에 많은 원본이 들어간 상태다. Supabase client도 기본 schema가 `lms`로 고정되어 있다.

### DB/migration 변경

- `supabase/migrations/0001_lms_schema.sql`
  - 현재: `lms.academies`, `lms.profiles`, `lms.academy_members`, `lms.students`, `lms.instructors`, 운영/회계 테이블을 모두 생성
  - 변경: 사람/계정/권한 원본은 `core`로 이동
  - `lms.students`, `lms.instructors`, `lms.profiles`는 v2 원본 테이블로 유지하지 않음
  - `lms.lessons`, `lms.enrollments`, `lms.lesson_schedules`, 회계/정산 테이블은 `core.students.id`와 `core.staff_members.id` 참조로 재설계

- `supabase/migrations/add_pin_to_profiles.sql`
  - 현재: `lms.profiles`에 PIN/idle timeout 추가
  - 변경: `core.user_security_settings` 또는 `core.user_accounts` 보안 설정으로 이동

### 코드 변경

| 파일 | 변경 내용 |
| --- | --- |
| `renderer/js/core/supabaseClient.ts` | 기본 `lms` client 제거, `db.core`, `db.lms`, `db.content`, `db.learning`, `db.reporting` 식의 schema helper 추가 |
| `renderer/js/contexts/AuthContext.tsx` | `lms.profiles` 조회 제거, `core.user_accounts`, `core.academy_members`, `core.user_security_settings` 사용 |
| `renderer/js/pages/LoginPage.tsx` | 공개 signup으로 admin 생성하는 흐름 제거, seed/admin 또는 초대 수락 흐름으로 변경 |
| `renderer/js/App.tsx` | `profile.current_academy_id` 의존을 core membership/current academy helper로 변경 |
| `renderer/js/core/api/academy.ts` | `core.academies` 기준 조회 |
| `renderer/js/core/api/pin.ts` | PIN 저장 위치를 core 보안 설정으로 변경 |
| `renderer/js/core/api/students.ts` | 학생 CRUD를 `core.people` + `core.students` + 초대권 생성으로 변경 |
| `renderer/js/core/api/instructors.ts` | 강사 CRUD를 `core.people` + `core.staff_members`로 변경 |
| `renderer/js/core/api/lessons.ts` | 강사/학생 join을 core/reporting view 기준으로 변경 |
| `renderer/js/core/api/schedules.ts` | schedule의 instructor FK를 `core.staff_members.id` 기준으로 변경 |
| `renderer/js/core/api/enrollments.ts` | enrollment의 student FK를 `core.students.id` 기준으로 변경 |
| `renderer/js/core/api/accounting.ts` | 학생/강사 이름 join을 직접 테이블 join이 아니라 reporting/RPC로 변경 |
| `renderer/js/components/lessons/LessonStudentDialog.tsx` | 직접 Supabase join 제거, 중앙 API 사용 |
| `renderer/js/core/types.ts` | number ID 기반 타입을 UUID string 기반으로 전환 |
| `renderer/js/core/api/shared/types.ts` | Supabase join 결과 타입을 v2 DTO 기준으로 정리 |
| `renderer/js/core/api/reset.ts` | 전체 삭제형 reset을 도메인별 reset 또는 dev-only script로 이동 |

### LMS 우선순위

1. `supabaseClient.ts` schema helper 도입
2. 학생/강사/프로필 direct table 접근을 중앙 API로 모으기
3. `AuthContext`를 core 계정 모델로 변경
4. 학생 등록 화면에서 `core.people`, `core.students`, `core.account_invitations` 생성
5. 수강/수업/회계 테이블의 FK를 UUID로 전환
6. 학생 리포트 화면은 `reporting.student_*` view를 읽도록 신규 API 추가
7. raw reset 기능은 운영 앱에서 제거하거나 관리자 dev tool로 격리

## 공통 구현 순서

현재 DB 데이터 보존이 목표가 아니라면 clean v2가 가장 빠르다.

1. v2 schema SQL 작성
2. admin seed SQL 작성
3. grade-app env와 LMS env를 같은 Supabase 프로젝트로 고정
4. LMS에 schema helper와 core auth lookup 먼저 적용
5. LMS 학생 등록을 core canonical write로 변경
6. 학생 초대/claim RPC 또는 Edge Function 구현
7. grade-app 로그인 후 `core.current_student_id()` 조회 적용
8. content import를 `content` schema로 이동
9. grade-app 풀이 저장을 `learning.sessions`, `learning.attempts` v2로 이동
10. LMS 리포트 API를 `reporting` view 기준으로 추가
11. AI chat 저장을 `ai`와 `data.events`에 연결
12. 기존 compatibility table/view 제거

## compatibility 전략

앱을 한 번에 못 바꾸면 임시 view를 둔다.

- `lms.students_legacy` 또는 `lms.students` view: `core.students + core.people`을 예전 LMS DTO처럼 제공
- `lms.instructors_legacy` view: `core.staff_members + core.people`
- `core.profiles_legacy` view: grade-app이 임시로 읽을 수 있는 auth profile 모양 제공
- `learning.v_submission_status` wrapper: 새 `reporting.submission_status`로 위임

하지만 새 DB를 만드는 상황이면 compatibility는 짧게만 유지한다. 오래 두면 새 구조와 옛 구조가 동시에 표준처럼 굳어진다.

## 검증 체크리스트

- LMS admin이 로그인할 수 있다.
- LMS에서 학생을 등록하면 `core.people`과 `core.students`가 생긴다.
- 학생 초대권으로 학생이 원하는 ID/비밀번호를 설정할 수 있다.
- 학생 로그인 후 grade-app이 같은 `core.students.id`를 찾는다.
- LMS 수강 등록이 `lms.enrollments.student_id -> core.students.id`로 저장된다.
- grade-app 과제 목록은 `learning.assignments`와 `assignment_targets` 기준으로 나온다.
- 채점 시도는 `learning.attempts.student_id -> core.students.id`로 쌓인다.
- AI 대화는 `ai.messages`에 저장되고 `data.events`에도 이벤트가 남는다.
- LMS 리포트는 원본 테이블 직접 조인이 아니라 `reporting.student_*` view에서 읽는다.
- 학생은 자기 데이터만 보고, 관리자는 자기 학원 데이터만 본다.

## 최종 작업 단위

1차 작업은 DB v2 migration과 seed다. 2차 작업은 LMS core auth/student registration 전환이다. 3차 작업은 grade-app content/learning 분리다. 4차 작업은 reporting/AI/data 연결이다.

가장 큰 리스크는 `auth.uid() = student_id` 가정을 늦게 제거하는 것이다. 이 가정을 먼저 끊어야 LMS와 grade-app이 장기적으로 같은 학생 데이터를 안정적으로 공유할 수 있다.
