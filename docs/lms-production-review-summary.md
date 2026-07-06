# LMS Production Review Summary

작성일: 2026-07-06

대상:
- LMS: `C:\codes\nextum\AMS`
- grade-app: `C:\codes\nextum\grade-app` 읽기 전용 참고
- 기준: 여러 학원이 같은 제품을 쓰고, LMS/grade-app/AI 채팅/채점/리포트 데이터가 한 DB에서 장기적으로 연결되는 상황

상세 근거 문서:
- `docs/lms-code-review-optimization-report.md`
- `docs/lms-production-review-detailed.md`

## 한 줄 결론

현재 LMS는 단일 학원 내부 도구로는 개선하면서 쓸 수 있지만, 여러 학원이 쓰는 프로덕트로 바로 운영하기에는 권한, 테넌트 분리, 학생 identity, 회계 정합성, 운영 안정성에서 막아야 할 문제가 있다.

가장 먼저 할 일은 기능 추가가 아니라 보안과 데이터 기준을 고정하는 것이다.

## 제품 수준에서 가장 위험한 문제

### 1. 사용자가 admin이 될 수 있는 경로가 있음

현재 회원가입 코드가 `role: 'admin'`을 보낼 수 있고, DB trigger가 그 값을 믿는다. 즉 공개 회원가입이나 signup API가 열려 있으면 사용자가 LMS admin 권한을 얻을 수 있다.

상태:
- 2026-07-06 기준 공개 signup은 초대코드 기반 학생 가입 API만 사용한다.
- invitation accept route는 student 초대만 허용하고 auth user metadata에는 권한 role을 저장하지 않는다.
- clean baseline에는 `raw_user_meta_data` role을 믿는 auth trigger가 없다.
- admin route 권한 판단은 active `core.academy_members` owner/admin membership을 기준으로 한다.

조치:
- 공개 admin signup 제거
- role metadata 신뢰 금지
- admin 권한은 서버가 만든 초대/승인 기록만 사용

### 2. 한 학원 구성원의 쓰기 권한이 너무 넓음

현재 RLS 정책은 "이 학원 소속인가"만 보고 학생, 수업, 회계, 설정 테이블에 넓은 CRUD 권한을 준다. 여러 역할이 있는 제품에서는 학생/강사/staff/admin 권한이 명확히 달라야 한다.

상태:
- 2026-07-06 기준 clean baseline은 주요 운영/회계/설정 direct write를 owner/admin/staff 중심으로 제한한다.
- 일정 rule, 수업 occurrence, 출결, 리포트 direct write도 owner/admin/staff로 좁혔다.
- teacher/instructor의 자기 반/자기 수업 범위 제한은 아직 더 세분화해야 한다.

조치:
- 학생, 강사, staff, admin, owner 권한 분리
- 회계/설정/삭제는 admin 이상 또는 서버 API만 허용

### 3. 문제 정답 데이터가 학생에게 노출될 수 있음

`content.problems`에 정답이 들어 있고, authenticated 사용자에게 read가 열려 있다. grade-app이 학생 앱이면 학생이 정답을 직접 읽을 수 있다.

상태:
- 2026-07-06 기준 clean baseline에는 정답 없는 `content.student_problems` view와 `content.problems` 컬럼 grant 제한을 추가했다.
- 원격 `nextum-data`에는 아직 baseline이 적용되지 않았으므로, 컷오버 전에는 여전히 `db:check`와 실제 권한 검증이 필요하다.

조치:
- 학생용 문제 view에는 정답 제거
- 정답은 staff-only 테이블 또는 서버 채점 RPC에서만 사용

### 4. LMS와 grade-app이 같은 DB 설정을 서로 덮을 수 있음

grade-app cloud script는 exposed schema를 `core, learning`으로 다시 설정한다. LMS는 `lms, content, reporting, ai, data, audit`까지 필요하다. 실행 순서에 따라 한쪽 앱이 갑자기 깨질 수 있다.

조치:
- shared DB 설정은 앱별 script가 변경하지 못하게 함
- 공용 DB bootstrap/migration 계약을 하나로 고정

### 5. 학생 기준 ID가 아직 정리되지 않음

장기적으로는 `core.students.id`가 진짜 학생 ID가 되어야 한다. 그런데 LMS UI와 수강/수납 로직은 여전히 숫자형 `lms.students.id`를 중심으로 돌아간다.

조치:
- 모든 학생 DTO에 `coreStudentId`와 `legacyLmsId`를 같이 실음
- 신규 리포트/AI/채점 데이터는 `coreStudentId` 기준
- legacy numeric id는 호환용으로만 유지

### 6. 삭제 정책이 프로덕트 운영에 맞지 않음

LMS에서 학생을 삭제하거나 reset하면 core 학생 데이터, grade-app 학습 데이터, AI 채팅 데이터와 어긋날 수 있다. 프로덕트에서는 hard delete가 아니라 archive-first가 기본이어야 한다.

조치:
- 학생 삭제는 상태 변경/보관 처리
- 개인정보 완전 삭제는 별도 승인 flow
- 학습/리포트 데이터 보존 정책 명시

상태:
- 2026-07-06 기준 legacy 학생 삭제 버튼은 hard delete 대신 `dropped` 상태 변경으로 동작한다.
- 학생 reset은 `core.students`를 삭제하지 않고 학생/반배정/청구계약/학생 멤버십/미사용 초대를 상태 변경으로 닫는다.
- reset 결과는 audit payload에 operation과 affected row count로 남긴다.
- clean baseline 검증에서 service-role reset RPC 실행과 authenticated 직접 실행 거부를 확인했다.

### 6-1. Admin 민감 작업은 서버 재인증이 필요함

상태:
- 2026-07-06 기준 reset/export/tax-settings는 same-origin 검사와 owner/admin 권한 검사를 수행한다.
- 클라이언트 요청에는 현재 `academyId`를 포함하도록 수정했다.
- 비밀번호 확인은 `/api/lms/admin/reauth`에서 서버가 검증하고, 5분짜리 httpOnly reauth 쿠키를 발급한다.
- reset/export/tax-settings는 해당 reauth 쿠키가 없거나 사용자/학원이 다르면 거부한다.
- reset/export/tax-settings/reauth는 form-level CSRF cookie/header가 맞지 않으면 거부한다.
- reset은 reauth cookie와 별도로 60초짜리 user/academy/action/target scoped confirm token을 요구한다.
- reset/export/tax-settings/reauth 성공은 `audit.admin_actions`에 기록한다.
- reset은 테이블별 operation/affected row count를, export는 filename/date/section scope를 audit payload로 남긴다.
- export는 최대 370일, 상세 섹션별 10,000행으로 제한한다.
- reset은 service-role 전용 `lms.reset_academy_data()` RPC로 실행되어 DB 함수 단위로 롤백된다.

### 7. 회계/급여 로직에 실제 금액 오류 가능성이 있음

급여 UI는 gross/tax/net을 기대하지만 API는 net 값을 제대로 받지 못하고 `amount`만 저장한다. 학생 결제는 `completed`로 저장되는데 일부 세금/손익 보고서는 `paid`만 집계한다.

상태:
- 2026-07-06 기준 새 LMS 결제/청구/급여 상태값은 `src/features/lms/status.ts`의 공통 helper로 통일했다.
- legacy 회계 API는 학생 수납 완료 상태를 `paid`/`completed` 둘 다 인정하고, 한 달에 여러 결제 기록이 있어도 완료 기록만 합산한다.
- legacy 회계/세금/손익 계산은 강사 급여 비용을 `amount` 실수령액이 아니라 `gross_amount` 기준으로 계산하고, 과거 행은 `net_amount` 또는 `amount`에 원천세/지방세를 더해 보정한다.
- 남은 작업은 회계/급여/리포트 집계를 SQL view/RPC로 옮겨 대량 데이터에서 성능과 일관성을 더 높이는 것이다.

조치:
- 결제 status enum 통일
- 급여 DTO와 DB 컬럼 통일
- 회계/세금/CSV export가 같은 기준 사용

## 우선순위 로드맵

### 이번 단계에서 바로 막기

1. signup에서 admin role metadata 제거
2. `assertLmsAdmin()`에서 `profiles.role` 신뢰 제거
3. RLS 권한을 role별로 분리하는 migration 설계
4. content answers 학생 노출 차단
5. grade-app의 exposed schema overwrite 방지
6. payroll/payment status bug 수정 완료
7. 학생 삭제를 archive-first로 변경

### 그 다음 정리

1. shared DB baseline migration 만들기
2. `core.students.id` 중심으로 LMS/grade-app 학생 모델 통합
3. reset, 수업 생성, 기간 휴강을 transaction/RPC로 이동
4. 회계/급여/리포트 집계를 SQL view/RPC로 이동
5. Supabase Security Advisor/Performance Advisor 결과를 배포 gate로 사용

### 운영 전에 반드시 통과해야 할 검증

1. 두 학원을 만들고 A 학원 사용자가 B 학원 데이터를 절대 못 보는지 확인
2. 학생 계정이 LMS admin API에 접근하지 못하는지 확인
3. 학생 계정이 문제 정답을 읽을 수 없는지 확인
4. grade-app script 실행 후에도 LMS schema가 노출되어 있는지 확인
5. LMS에서 학생 등록 -> 학생 회원가입 -> grade-app 로그인 -> 채점 데이터 생성 -> LMS 리포트 조회가 한 학생 ID로 연결되는지 확인
6. reset/삭제/휴강/급여 생성 중간 실패 시 데이터가 부분 저장되지 않는지 확인

## 지금 판단

프로덕트 출시 기준으로는 "보류"가 맞다. 보안 P0와 데이터 정합성 P1을 고친 뒤에야 여러 학원에 배포할 수 있다.

다만 구조 방향은 나쁘지 않다. `core`, `lms`, `learning`, `ai`, `reporting`처럼 도메인을 나누려는 방향은 맞고, 이제 중요한 것은 실제 런타임과 권한 정책을 그 구조에 맞게 끝까지 맞추는 것이다.
