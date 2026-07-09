# Grade App Optimization Impact

작성일: 2026-07-10
상태: 영향 분석 및 후속 구현 계약. 이번 작업에서 `C:\codes\nextum\grade-app`은 수정하지 않았다.

## 결론

Supabase Optimization v2는 Grade App을 즉시 변경하지 않아도 배포할 수 있다. 기존 Grade App compatibility table, legacy content, 공개 함수 signature, v1 Realtime 이벤트를 유지한다.

Grade App 전환은 별도 작업으로 진행한다. 전환이 끝나고 14~30일 동안 legacy query traffic이 0임을 확인하기 전에는 다음 객체를 제거하지 않는다.

- `learning.books`, `learning.units`, `learning.concepts`, `learning.types`, `learning.problems`
- 기존 `learning.can_access_*`, `learning.can_submit_assignment` signature
- `assignment_targets` compatibility read path
- `lms-cache-invalidated` v1 event와 row triggers
- legacy reporting views/policies

## 공유 DB 소유권

`nextum-lms` 저장소가 공유 Supabase schema와 migration의 단일 소유자다. Grade App은 consumer다.

현재 Grade App에는 공유 DB를 손상시킬 수 있는 경로가 남아 있다.

- `C:\codes\nextum\grade-app\scripts\apply-cloud-sql.mjs`는 `pgrst.db_schemas`를 `public,graphql_public,core,learning`으로 덮어쓸 수 있다.
- `C:\codes\nextum\grade-app\docs\setup.md`는 위 script 실행을 안내한다.
- Grade App `supabase/config.toml`은 현재 `core`, `learning` 중심이다.

공유 프로젝트에서는 위 raw apply script를 실행하지 않는다. 향후 Grade App script는 다음 read-only contract check만 수행해야 한다.

- 필요한 schema가 exposed schema 목록에 포함되는지 확인
- 필요한 table/view/RPC 및 grants 존재 확인
- migration 적용이나 role setting 변경은 하지 않음

LMS가 요구하는 exposed schemas는 다음과 같다.

```text
public, graphql_public, core, lms, content, learning, ai, data, reporting, audit
```

`private`는 노출하지 않는다.

## 결합 계약

| 영역 | canonical 객체 | Grade App 의미 |
| --- | --- | --- |
| Auth | `auth.users`, `core.user_accounts` | 로그인 계정과 사람 연결 |
| Identity | `core.people`, `core.students` | `core.students.id`가 업무용 학생 ID |
| Membership | `core.academy_members`, `core.class_students` | tenant와 반 소속/권한 |
| Signup | `core.account_invitations` | 학생 초대 claim |
| Content | `content.books/units/concepts/problem_types/problems` | 교재와 문제 canonical source |
| Safe problem read | `content.student_problems` | 답안이 제거된 학생용 view |
| Storage | bucket `problem-images`, `content.assets.storage_path` | 문제 이미지 |
| Assignment | `learning.assignments`, `assignment_recipients`, `assignment_items`, `assignment_files` | 학생별 과제와 snapshot |
| Compatibility | `learning.assignment_targets`, legacy content | Grade App 전환 완료 전 유지 |
| Submission | `learning.sessions`, `learning.attempts` | 풀이 세션과 append-only 채점 시도 |
| AI | `ai.conversations`, `ai.messages` | canonical `core_student_id`, optional `assignment_id` |
| Realtime | `academy:<uuid>:lms-cache` | LMS cache invalidation; Grade App write가 LMS에 반영 |

`auth.uid()`를 `student_id`로 직접 사용하는 새 코드를 만들지 않는다. 로그인 사용자는 `core.user_accounts -> core.people -> core.students`로 canonical `core.students.id`를 해석한다.

## v2 DB 변경의 즉시 영향

### 유지되는 것

- Grade App server의 service-role table read/write는 기존처럼 동작한다.
- legacy content table과 policy는 제거하지 않는다.
- 기존 `learning.can_access_assignment/book/problem`, `can_submit_assignment` signature를 유지한다.
- v1 Realtime topic/event/trigger를 유지한다.
- `content.problems.answer`, `answer_key`의 제한과 `content.student_problems` 안전 view를 유지한다.

### 바뀌는 것

- content/learning RLS가 row-argument nested function 대신 private set helper를 사용한다.
- 학생 본인 RLS는 `(core_student_id, academy_id)` 쌍을 검사해 멀티 학원 계정에서도 tenant 경계를 유지한다.
- public/anon은 권한 helper를 직접 실행할 수 없다. 로그인 Grade App 사용자는 `authenticated`, server는 `service_role`을 사용해야 한다.
- `content_problems_type_idx`가 canonical `problem_type_id`를 가리키고 legacy `type_id` 인덱스는 별도 이름으로 보존된다.
- `content.books.academy_id is null`인 전역 canonical book은 LMS 운영직원 catalog에 유지되며, 학생 problem RLS는 assignment scope로 제한된다.
- item snapshot 과제는 `assignment_items`에 든 문제만 학생에게 노출하고, item이 없는 legacy scope 과제만 기존 book/unit/problem fallback을 사용한다.
- problem image asset은 문제 접근 범위와 `problem_image|question_image|prompt_image` allowlist를 함께 따르며, problem이 없는 book-level asset은 cover/thumbnail kind만 허용한다. 새 kind는 answer/solution 노출 보안 리뷰 없이는 추가하지 않는다.
- v2 Realtime payload는 `studentId` 대신 `coreStudentId`를 사용한다.
- optional legacy `learning.books.books_assigned` 정책은 canonical `core.students.id` mapping을 우선 사용하되, Grade 전환 전에는 active class/enrollment에 한해 deprecated `class_students.student_id = (select auth.uid())` 경로도 합집합으로 유지한다. legacy traffic zero gate 후 별도 cleanup migration에서 제거한다.

## Grade App 후속 변경 목록

이 목록은 영향 문서이며 이번 LMS 작업에서 sibling repo 파일을 수정하지 않는다.

### 1. 이미지 N+1 제거

현재 경로:

- `src/components/ProblemImage.tsx`: 이미지마다 `/api/problem-image-url` 호출
- `src/lib/data/problem-image-urls.ts`: 한 요청에서 canonical problem 경로들과 legacy problem을 여러 번 조회
- `src/app/solve/page.tsx`: 각 `ProblemImage`가 자동 resolve

운영 통계에서는 canonical/legacy 이미지 경로 검사가 각각 931회 실행됐다.

후속 구현:

1. assignment detail에서 필요한 모든 storage path를 한 번 수집한다.
2. batch endpoint 한 번으로 전달한다.
3. canonical `content.student_problems` 또는 정규화된 `content.assets.storage_path`만 조회한다.
4. Supabase Storage `createSignedUrls(paths, ttl)`를 한 번 호출한다.
5. TTL에서 clock skew를 뺀 시간 동안 server/cache에 저장한다.
6. `ProblemImage`에는 `resolvedSrc`를 전달하고 per-image auto resolve를 끈다.
7. legacy lookup은 feature flag fallback으로 유지한 뒤 traffic 0에서 제거한다.

Acceptance:

- 한 assignment 화면의 signed URL HTTP 요청 1회
- DB image-path visibility query 1회 이하
- canonical과 legacy를 동시에 조회하지 않음
- 만료/없는 이미지 fallback 동작

### 2. assignment list/detail query 축소

현재 `src/lib/data/server.ts`는 assignment 목록마다 problem ID를 열거하고, detail에서 선택 문제를 읽은 뒤 교재 전체를 다시 읽는다.

후속 구현:

- 목록은 `assignment_items`의 count aggregate만 읽는다.
- 학생 assignment 목록은 `assignment_recipients(student_id, active)`에서 시작한다.
- detail은 해당 `assignment_id`의 `assignment_items`와 필요한 `content.student_problems`만 읽는다.
- 전체 book fetch 후 JavaScript filter를 제거한다.
- 오래된 `fetchBooksForUser`, `fetchBookForUser` free-book 경로는 assignment-only 전환 확인 후 제거한다.

### 3. submission 원자성

현재 Grade App은 session insert, 기존 attempt count, attempt batch insert를 별도 요청으로 수행한다. 중간 실패 시 orphan session이 남고 동시 submission의 `attempt_no`가 충돌할 수 있다.

후속 DB 작업에서 별도 transactional submission RPC를 추가한다. 이번 v2 migration의 `learning.create_assignment_v2`는 LMS 과제 생성용이며 학생 제출용이 아니다.

제출 RPC 요구사항:

- caller의 canonical student/recipient/submit window 검증
- session + attempts 단일 transaction
- problem이 assignment snapshot에 포함되는지 검증
- `attempt_no` 동시성 규칙 또는 unique constraint 정의
- answer key는 service-only grading 구간에서만 접근
- 성공 시 `learning` domain Realtime v2 event 1회
- 동일 idempotency key retry는 같은 결과 반환

Acceptance:

- 각 insert 단계 fault injection 후 orphan 0
- 동시 제출에서 attempt ordinal 안정
- 다른 학생/학원 assignment 제출 거부
- due/available window 테스트

### 4. canonical recipients로 전환

현재 Grade App은 `assignment_targets`를 읽고 class/student target을 별도 query로 해석한다.

후속 구현:

- 학생 목록/접근/진행률의 시작점을 `learning.assignment_recipients`로 변경
- `assignment_targets`는 배포 정의와 audit compatibility 용도로만 유지
- 반 roster 변경은 이미 생성된 과제 recipient denominator를 바꾸지 않음
- LMS의 `excludedStudentIds`는 recipient snapshot에 반영된 결과를 신뢰
- direct-student recipient도 exclusion을 적용하고, 포함된 학생은 active primary/latest class를 기록해 instructor scope 확인과 legacy 동작을 유지

### 5. server client 역할 분리

현재 server data path는 service-role 중심이며 authorization을 애플리케이션에서 수동 구현한다.

후속 목표:

- public problem/assignment reads는 가능하면 user-scoped authenticated client + RLS 사용
- answer key grading, signup admin, transactional submit처럼 권한 상승이 필요한 좁은 경로만 service role 사용
- service key를 브라우저 번들/NEXT_PUBLIC 환경변수에 넣지 않음
- 모든 service-role handler는 academy/student/assignment를 명시적으로 검증

### 6. signup/auth 보안

현재 signup UI/API는 6자 password를 허용하고, Security Advisor는 leaked password protection 비활성화를 보고했다.

후속 작업:

- 제품 정책을 정한 뒤 최소 10~12자 password로 UI/API 검증을 동일하게 변경
- Supabase leaked password protection 활성화
- 기존 사용자 로그인에는 영향을 주지 않는지 확인
- Auth user 생성과 DB claim 사이 실패를 복구 가능한 idempotent state machine/RPC로 정리

Auth와 Postgres는 하나의 transaction으로 묶을 수 없으므로 compensating delete만 의존하지 말고 claim 상태와 repair job을 둔다.

## 신규 LMS RPC와 Grade App 관계

이번 migration의 공개 v2 API:

- `learning.list_problem_catalog_v2`: Grade App이 당장 사용할 필요 없음
- `learning.assignment_overview_v2`: LMS 운영 화면용
- `learning.student_progress_summary_v2`: LMS 학생 분석용
- `learning.list_student_attempts_v2`: LMS attempt feed용
- `lms.list_staff_roster_v2`: LMS bounded 직원 검색/pagination용
- `lms.class_operations_read_v2`: LMS 반 운영용
- `learning.create_assignment_v2`: LMS 과제 생성용

Grade App은 이 RPC들이 배포돼도 기존 경로를 유지할 수 있다. 향후 Grade App 제출용 RPC는 별도 migration/API version으로 만든다.

## Realtime 호환

### v1

```text
event: lms-cache-invalidated
topic: academy:<academy-uuid>:lms-cache
payload student field: studentId
```

기존 Grade App write와 LMS legacy subscriber를 위해 유지한다.

### v2

```text
event: lms-cache-invalidated-v2
topic: academy:<academy-uuid>:lms-cache
payload canonical student field: coreStudentId
dedupe key: eventId
```

canonical payload는 다음 key를 사용한다.

```json
{
  "version": 2,
  "eventId": "uuid",
  "academyId": "uuid",
  "domains": ["learning"],
  "entityType": "learning.attempts",
  "entityIds": ["uuid"],
  "coreStudentId": "uuid",
  "occurredAt": "timestamptz"
}
```

Grade App이 v2를 발행/소비하게 될 때의 순서:

1. LMS가 v1 fallback과 v2 subscriber를 함께 배포
2. Grade App transactional submission RPC가 v2 event 발행
3. event count와 `coreStudentId` routing 검증
4. 모든 client가 v2를 이해한 뒤 v1 consumer 제거
5. 14~30일 관찰 후 v1 row trigger 제거

multi-target 변경은 임의의 student/class ID를 payload에 넣지 않는다. 좁힐 수 없으면 ID를 생략하고 academy/domain cache만 invalidate한다.

## 배포 순서

1. 현재 Grade App build와 DB query 통계를 snapshot한다.
2. Grade App raw cloud SQL apply 경로를 운영 절차에서 비활성화한다.
3. LMS Supabase v2 migration을 배포한다.
4. Grade App smoke test를 수행한다. 코드 배포는 필요 없다.
5. LMS v2 read/mutation/event를 feature flag로 점진 전환한다.
6. 별도 Grade App branch에서 image batching, canonical recipients, transactional submit을 구현한다.
7. Grade App을 compatibility fallback ON 상태로 배포한다.
8. canonical path 오류율과 legacy query traffic을 관찰한다.
9. Grade App fallback을 OFF한다.
10. 14~30일 zero traffic 뒤 legacy 제거 migration을 별도로 배포한다.

DB → LMS → Grade App 순서를 지킨다. Grade App code가 필요한 RPC/table보다 먼저 배포되지 않도록 한다.

## Smoke test

DB migration 직후 기존 Grade App으로 다음을 수행한다.

- 기존 학생 login
- 학생 invitation claim 신규 1건
- 학생 assignment 목록 표시
- assignment detail의 모든 public problem/image 표시
- 답안/answer key가 browser response에 없음
- due 전 제출 성공
- session과 attempts가 같은 assignment/core student를 가리킴
- LMS assignment detail/report에서 결과 확인
- AI conversation이 canonical student/assignment와 연결
- 다른 학생과 다른 academy 데이터 접근 거부

Grade App 후속 전환 뒤 같은 시나리오를 canonical-only flag로 반복한다.

## 롤백

### Supabase v2 직후 Grade App 회귀

1. LMS v2 application flags를 내린다.
2. Grade App은 기존 compatibility path를 유지한다.
3. v1 Realtime subscriber를 유지한다.
4. DB migration 파일을 수정하거나 history를 삭제하지 않는다.
5. 정책 복원이 필요하면 catalog snapshot을 기반으로 새 forward-only rollback migration을 만든다.

### Grade App canonical 전환 뒤 회귀

1. Grade App compatibility fallback flag를 다시 켠다.
2. canonical write 데이터는 삭제하지 않는다.
3. legacy 객체가 유지돼 있으므로 기존 read path로 복귀한다.
4. submission RPC 장애면 기존 direct submit은 자동 fallback하지 않는다. 중복 제출 위험이 있으므로 쓰기를 일시 중지하고 mutation/idempotency 상태를 확인한다.

### legacy 제거 뒤 회귀

이 단계는 단순 flag rollback이 아니다. 사전 backup/restore rehearsal가 필수이며, schema/view 재생성과 데이터 복원이 필요하다. 그래서 zero-traffic 관찰 gate 전에는 destructive cleanup을 실행하지 않는다.

## legacy 제거 승인 조건

- Grade App canonical content/recipient/submission 전환 완료
- LMS/Grade App 양쪽 v2 event 안정
- `pg_stat_statements`에서 legacy content 접근 14~30일 0
- legacy/canonical content row/hash reconciliation 완료
- image Storage manifest와 path reconciliation 완료
- answer secrecy role tests 통과
- backup restore rehearsal 통과
- 운영 승인과 maintenance window 확보

하나라도 충족하지 못하면 legacy 객체를 유지한다.
