# Supabase Optimization v2 Contract and Runbook

작성일: 2026-07-10
대상 프로젝트: `nextum-data` (`lecdpaxcguxdkdrevpzw`, PostgreSQL 17)

## 목적과 범위

이 문서는 `20260709194443_supabase_growth_optimization_v2.sql`의 DB 계약, 배포 순서, 검증, 모니터링, 롤백 절차를 정의한다.

이번 변경은 다음 원칙을 지킨다.

- 기존 migration 파일은 수정하지 않는다.
- Grade App이 사용하는 legacy `learning.books/units/concepts/types/problems`와 v1 Realtime 이벤트를 유지한다.
- 신규 helper, read RPC, mutation RPC, Realtime v2 계약을 먼저 추가한 뒤 LMS를 feature flag로 전환한다.
- 답안은 `content.student_problems` 및 기존 column grant 경계 밖으로 노출하지 않는다.
- legacy 객체 제거는 Grade App 전환과 최소 14~30일의 zero-traffic 관찰 이후 별도 migration에서 수행한다.

## 소유권 계약

공유 Supabase 프로젝트의 schema와 migration 소유자는 `nextum-lms` 저장소 하나뿐이다. Grade App은 DB consumer다.

- LMS 저장소만 `core`, `content`, `learning`, `lms`, `ai`, `data`, `reporting`, `audit` DDL과 PostgREST 노출 schema 설정을 변경한다.
- Grade App의 `scripts/apply-cloud-sql.mjs`를 공유 프로젝트에 실행하지 않는다.
- Grade App은 향후 compatibility check와 smoke test만 수행하고, 자체 raw SQL로 `pgrst.db_schemas`를 덮어쓰지 않는다.
- `private` schema는 PostgREST exposed schema 목록에 추가하지 않는다.

2026년 Supabase Data API 기본값 변경에 대비해 신규 공개 RPC는 `anon`/`PUBLIC` 실행권한을 제거하고 `authenticated`, `service_role`만 명시적으로 grant한다. RLS와 object grant는 별개의 보안 계층으로 취급한다.

## migration이 만드는 계약

### RLS helper

`private` schema의 helper는 caller context를 set으로 한 번 계산한다.

- `private.current_actor()`
- `private.current_academy_ids(text[])`
- `private.current_student_ids()`
- `private.current_student_academy_pairs()`
- `private.current_student_class_ids()`
- `private.current_assigned_class_ids()`
- `private.current_instructor_staff_ids()`
- `private.current_staff_class_ids()`
- `private.accessible_student_ids()`
- `private.current_staff_assignment_ids()`
- `private.current_staff_book_ids()`
- `private.accessible_assignment_ids()`
- `private.submittable_assignment_ids()`
- `private.accessible_book_ids()`
- `private.accessible_problem_ids()`

모든 helper는 `SECURITY DEFINER`, `STABLE`, `search_path = ''`이며 내부에서 `auth.uid()`와 canonical account/person 관계를 검사한다. 학생 본인 set은 active student row뿐 아니라 같은 academy의 active `academy_members(role='student')`를 요구하므로 membership 해제 즉시 접근이 끝난다. 학생 본인 정책은 ID 집합만 비교하지 않고 `current_student_academy_pairs()`의 `(student_id, academy_id)`를 비교해 tenant 경계를 보존한다. `private`는 Data API에 노출하지 않는다.

기존 호환 함수의 signature는 유지하지만 구현은 private set helper를 호출하는 `SECURITY INVOKER` wrapper로 교체한다.

- `core.can_access_assigned_class(uuid)`
- `learning.can_access_book(uuid)`
- `learning.can_access_assignment(uuid)`
- `learning.can_access_problem(text)`
- `learning.can_submit_assignment(uuid)`
- `content.can_report_problem(text)`

`PUBLIC`과 `anon`의 실행권한은 제거하고 `authenticated`, `service_role`에만 명시적으로 부여한다. optional legacy `core.current_academy_id()`와 `core.current_user_account_id()`도 같은 원칙을 적용한다.

문제 본문 권한은 정책 변경 뒤 다시 선언한다. `authenticated`는 `content.problems`의 ID/scope/public payload 등 16개 safe column과 `content.student_problems` view만 SELECT할 수 있고 `answer`, `answer_key`, `answer_image_path`, `metadata`는 제외한다. `PUBLIC`/`anon`은 table/view SELECT가 없으며, trusted `service_role`의 전체 문제/정답 접근은 서버 채점용으로 유지한다.

2026-07-10 remote ACL audit도 `authenticated` safe column 16개, `service_role` full columns, `PUBLIC`/`anon` problem/view SELECT 없음으로 확인했다.

### 정책 통합

다음 변경은 기존 허용 범위의 합집합을 유지하면서 동일 role/action의 permissive policy를 하나로 만든다.

- `content_authenticated_read_*`와 canonical `content_*_select` 중복 제거
- content metadata는 accessible book set, 문제 본문은 accessible problem set으로 분리
- item snapshot이 있는 과제는 `assignment_items.problem_id`만 허용하고, item이 없는 legacy scope 과제만 book/unit/problem fallback을 사용
- problem-linked asset은 accessible problem set 안에서도 `problem_image|question_image|prompt_image` kind만 허용하고, problem이 없는 book-level asset은 `book_cover|cover|thumbnail` kind만 허용한다. 새 student-visible asset kind는 answer/solution 포함 여부를 보안 리뷰한 뒤 allowlist migration으로만 추가한다.
- `content.books.academy_id is null`인 전역 canonical book은 active owner/admin/staff에게 공유 catalog로 허용하되, 학생은 assignment에 포함된 problem만 읽도록 분리
- assignment/items/files/targets SELECT를 accessible assignment set으로 변경
- owner/admin/staff는 academy의 inactive/recalled assignment도 관리·복구를 위해 읽고, student/instructor만 active published/available 범위를 적용
- sessions/attempts SELECT를 accessible canonical student set으로 변경
- session/attempt INSERT를 current student + submittable assignment set으로 변경
- `FOR ALL` write policy를 INSERT/UPDATE/DELETE로 분리
- remote에만 존재하는 `reports_own`, `wrong_notes_own`은 canonical policy에 legacy auth-user ownership 조건을 합치되, 같은 academy의 active student membership이 있을 때만 허용
- optional `core.profiles.profiles_self`의 `auth.uid()`를 init-plan 형태로 변경하고, `learning.books.books_assigned`는 active enrollment/class 안에서 canonical student mapping과 deprecated legacy auth-UUID 비교를 합집합으로 유지

정책 검증에서 학생, 교사, 운영직원, 다른 학원 사용자, 비인증 사용자를 각각 별도 role case로 테스트해야 한다.

### 인덱스 reconciliation

`content.content_problems_type_idx`가 remote처럼 legacy `type_id`를 가리키면 다음과 같이 처리한다.

1. 실제 key column, key count, validity를 catalog에서 검사한다.
2. legacy 정의면 `content_problems_legacy_type_idx`로 rename해 Grade App 호환 성능을 보존한다.
3. canonical `problem_type_id where problem_type_id is not null` 인덱스를 생성한다.
4. 예상하지 못한 정의면 migration을 중단한다.

Advisor가 확인한 exact duplicate 6쌍은 두 `pg_index` 정의가 실제로 같을 때만 한쪽을 제거한다.

- `core_academy_members_person_idx`
- `core_academy_members_account_idx`
- `core_people_primary_academy_idx`
- `attempts_session`
- `learning_reports_academy_student_generated_idx`
- `learning_sessions_core_student_idx`

다른 `unused_index`는 이 migration에서 제거하지 않는다. 현재 통계 기간과 데이터량이 작아 14~30일의 대표 workload 관찰 전에는 안전한 삭제 근거가 부족하다.

추가되는 주요 인덱스는 다음과 같다.

- 문제 catalog: `(book_id, page_printed, id)`, `(book_id, unit_id, page_printed, id)`, `(book_id, problem_type_id, page_printed, id)`
- 과제 overview: `(academy_id, created_at desc, id desc)`
- 학생 attempt feed: `(academy_id, core_student_id, created_at desc, id desc)`
- 학생/직원 directory cursor: `(academy_id, created_at desc, id desc)`
- assignment activity: attempts와 sessions의 assignment-leading 인덱스
- workload-critical FK: content book/unit/type, assignment recipient student/class, attempt problem, session academy

현재 데이터가 작기 때문에 migration transaction 안에서 일반 `CREATE INDEX`를 사용한다. 운영 데이터가 커진 뒤 재실행하는 환경에서는 사전 lock/size 측정과 maintenance window가 필요하다. PostgreSQL의 `CREATE INDEX CONCURRENTLY`는 일반 transaction migration 안에서 실행할 수 없으므로 별도 운영 절차가 필요하다.

## Read RPC 계약

### 문제 catalog

```sql
learning.list_problem_catalog_v2(
  p_book_id uuid,
  p_unit_id uuid default null,
  p_problem_type_id uuid default null,
  p_is_example boolean default null,
  p_after_page_printed integer default null,
  p_after_id text default null,
  p_limit integer default 50
)
```

- `(page_printed, id)` keyset pagination
- cursor가 정의되지 않는 `page_printed is null` 문제는 catalog RPC에서 제외하고 별도 데이터 정리/필터 경로로 다룬다.
- page size 1~100 강제
- `content.student_problems`만 조회하므로 `answer`, `answer_key`를 반환하지 않음
- 다음 cursor는 응답 마지막 행의 `page_printed`, `problem_id`; 두 field는 함께 null이거나 함께 non-null이어야 하며 한쪽만 전달하면 `22023`

### 과제 overview

```sql
learning.assignment_overview_v2(
  p_academy_id uuid,
  p_after_created_at timestamptz default null,
  p_after_id uuid default null,
  p_limit integer default 50
)
```

최대 100개 과제에 대해서만 item, recipient, submitted recipient, attempt, last activity를 집계한다. 다음 cursor는 마지막 행의 `created_at`, `assignment_id`이며 두 field는 반드시 함께 전달한다.

### 학생 기간 집계와 feed

```sql
learning.student_progress_summary_v2(
  p_academy_id uuid,
  p_student_id uuid,
  p_from timestamptz default now() - interval '30 days',
  p_to timestamptz default now()
)

learning.list_student_attempts_v2(
  p_academy_id uuid,
  p_student_id uuid,
  p_from timestamptz default now() - interval '30 days',
  p_to timestamptz default now(),
  p_after_created_at timestamptz default null,
  p_after_id bigint default null,
  p_limit integer default 50
)
```

- scan window 최대 366일
- feed page 최대 100행
- canonical `core_student_id`만 사용
- attempt feed cursor의 `created_at`, `attempt_id`는 함께 null이거나 함께 non-null이어야 한다.

### 학생 roster 검색

- `core.students` parent query에 payload column 없는 `people!inner()`와 필요 시 `class_students!inner()`를 embed하고, people OR 검색은 `referencedTable: 'people'`에만 적용한다.
- tenant 경계는 parent `students.academy_id`가 고정한다. `people.primary_academy_id`는 다중 학원 person을 누락시키므로 검색 조건으로 사용하지 않는다.
- status, 담당/선택 반, `(created_at desc, id desc)` cursor를 같은 query에 적용하고 `limit + 1`행만 반환한다. people ID나 class student ID 전체 집합을 먼저 materialize하지 않는다.
- 학생/직원 roster HTTP 요청은 shared cache/in-flight dedupe를 쓰지 않는 `live` 요청이며, 화면의 filter 변경·새 page 요청·unmount AbortSignal이 browser fetch와 server PostgREST query까지 전달된다.

### 직원 roster 검색

```sql
lms.list_staff_roster_v2(
  p_academy_id uuid,
  p_query text default null,
  p_include_sensitive boolean default false,
  p_peer_only boolean default false,
  p_matching_roles text[] default null,
  p_role text default 'all',
  p_status text default 'operations',
  p_after_created_at timestamptz default null,
  p_after_id uuid default null,
  p_visible_staff_ids uuid[] default null,
  p_search_class_ids uuid[] default null,
  p_limit integer default 50
) returns table (staff_id uuid, created_at timestamptz)
```

- `(created_at desc, id desc)` keyset으로 정렬하고 요청 limit 1~100보다 한 행 더 반환해 client가 `hasMore`를 계산한다.
- query 최대 길이는 80자이며 display/full name, 권한이 허용된 phone/email, application이 계산한 matching role labels, default class name을 하나의 OR predicate로 검색한다.
- peer-scoped 호출은 `p_peer_only = true`, `p_visible_staff_ids`, `p_search_class_ids`를 명시하고 sensitive 검색을 끈다. peer-only predicate는 teacher/instructor role만 page/cursor에 포함해 post-filter underfill을 막는다. 상세 row 조립과 `visibleToPeerOnly` masking은 application permission layer가 담당한다.
- direct authenticated owner/admin/staff와 teacher/instructor membership을 검사하고, teacher/instructor는 명시적 peer/class scope 없이는 거부한다. server service role도 route authorization 뒤에만 호출한다.
- 현재 remote staff는 5명이라 `pg_trgm`의 write/storage 비용을 정당화하지 못한다. roster가 커지고 substring search p95가 목표를 넘을 때 `EXPLAIN (ANALYZE, BUFFERS)` 근거로 별도 도입한다.

2026-07-10 remote read-only fixture에서 name, role-label, class-name OR 검색과 ID/created_at cursor shape, limit+1, 다음 page keyset 연속성 assertion이 모두 true였다.

### 반 운영 단일 read

```sql
lms.class_operations_read_v2(
  p_academy_id uuid,
  p_view text default 'overview',
  p_start_date date default current_date,
  p_end_date date default current_date + 14,
  p_class_ids uuid[] default null,
  p_class_limit integer default 100
) returns jsonb
```

`p_class_ids`는 access/filter 입력으로 최대 1000개를 받되 실제 `classes` 반환은 `p_class_limit`과 hard cap 100 중 작은 값으로 제한한다. 따라서 담당 반이 100개를 넘는 instructor도 RPC 실패 대신 첫 100개와 `truncated.classes = true`를 받는다.

공통 응답:

```json
{
  "schemaVersion": 2,
  "academyId": "uuid",
  "view": "overview|schedule|attendance|settings",
  "window": { "from": "date", "to": "date" },
  "limits": {
    "classes": 100,
    "rules": 1000,
    "occurrences": 2000,
    "attendance": 2000,
    "books": 200,
    "staff": 500,
    "classrooms": 200,
    "maxWindowDays": 93
  },
  "truncated": {
    "classes": false,
    "scheduleRules": false,
    "occurrences": false,
    "attendance": false,
    "books": false,
    "staff": false,
    "classrooms": false
  },
  "classes": [],
  "scheduleRules": [],
  "occurrences": [],
  "attendance": [],
  "books": [],
  "staff": [],
  "classrooms": []
}
```

view별 반환 범위:

| view | 반환 데이터 |
| --- | --- |
| `overview` | classes, rules, actual occurrences, books |
| `schedule` | classes, rules, actual occurrences |
| `attendance` | classes, rules, actual occurrences, attendance |
| `settings` | classes, rules, books, staff, classrooms |

RPC는 반복 규칙과 실제 occurrence를 반환하며 virtual occurrence 확장은 기존 LMS date logic에서 수행한다.

직접 authenticated 호출에서 `settings` view는 owner/admin/staff만 허용한다. teacher/instructor는 overview/schedule/attendance만 호출할 수 있고, server-side service role 호출은 애플리케이션 route의 동일 role guard를 반드시 통과해야 한다.

각 bounded collection은 limit보다 한 건 더 검사하고 실제 응답 배열은 limit으로 자른다. `classes`/`scheduleRules`/`occurrences`/`attendance`가 truncated이면 `p_class_ids` 또는 날짜 범위를 좁혀 다시 요청한다. `books`/`staff`/`classrooms`가 truncated이면 전체 selector로 오인하지 말고 별도 검색·pagination API로 전환한다. 이 key는 additive이므로 기존 v2 adapter가 무시해도 현재 응답 파싱은 유지된다.

## Transactional mutation 계약

```sql
learning.create_assignment_v2(
  p_academy_id uuid,
  p_book_id uuid,
  p_title text,
  p_problem_ids text[],
  p_class_ids uuid[] default '{}',
  p_student_ids uuid[] default '{}',
  p_description text default null,
  p_context text default 'homework',
  p_due_at timestamptz default null,
  p_available_from timestamptz default null,
  p_metadata jsonb default '{}',
  p_excluded_student_ids uuid[] default '{}',
  p_created_by uuid default null,
  p_source_type text default 'content_scope'
) returns table (
  assignment_id uuid,
  item_count bigint,
  recipient_count bigint,
  mutation_id uuid
)
```

한 DB transaction에서 다음 작업을 모두 수행한다.

1. academy/book/problem/target/actor 계약 검증
2. assignment 생성; 모든 문제가 한 unit이면 `unit_id`, 문제가 한 개면 `problem_id` compatibility summary도 기록
3. 입력 순서를 보존한 assignment item snapshot 생성
4. class/direct-student target 생성
5. class roster recipient snapshot 생성; class snapshot은 same-academy active student만 포함하고, direct student는 active enrollment 중 `primary_class desc, joined_at desc` 우선순위의 class를 기록
6. `p_excluded_student_ids`를 direct student target, class snapshot recipient, direct-student recipient에서 제외하고 metadata에 기록
7. recipient가 0이면 전체 rollback
8. Realtime v2 logical event 1회 발행

제한은 problems 1000, classes 100, direct students 1000, exclusions 5000이다. `p_created_by`는 service-role 호출 시에도 active owner/admin/staff/teacher/instructor academy member여야 한다. 직접 authenticated RPC 생성 권한은 owner/admin/staff로 제한한다.

## Realtime v2 계약

topic은 v1과 동일한 private topic이다.

```text
academy:<academy-uuid>:lms-cache
```

event name:

```text
lms-cache-invalidated-v2
```

payload:

```json
{
  "version": 2,
  "eventId": "uuid",
  "academyId": "uuid",
  "domains": ["assignments"],
  "entityType": "learning.assignments",
  "entityIds": ["uuid"],
  "coreStudentId": "uuid|null",
  "occurredAt": "timestamptz"
}
```

v2는 `studentId` 대신 canonical `coreStudentId`를 사용한다. 신규 transactional RPC는 logical mutation당 v2 이벤트 한 번을 발행한다. 기존 direct table mutation과 v1 row trigger는 호환 기간 동안 유지되므로 v2 subscriber는 v1 이벤트를 무시하고 `eventId`로 중복 제거한다.

Emitter는 domain 중복/null을 거부하고 `entityIds`를 최대 100개로 제한하며, `coreStudentId`가 있으면 event의 academy 소속인지 검증한다.

## 배포 전 preflight

1. DB backup/PITR 상태와 Storage backup을 확인한다.
2. `pg_stat_statements`, Advisor, table/index 통계를 저장한다.
3. remote migration history와 local 파일을 대조한다.
4. Grade App raw SQL apply 작업이 비활성화됐는지 확인한다.
5. LMS v2 feature flag가 기본 OFF인지 확인한다.

명령은 현재 CLI 도움말로 확인된 옵션만 사용한다.

```powershell
npx supabase migration list --linked
npx supabase db push --linked --dry-run
npm run db:check
```

2026-07-10 MCP read-only audit에서 운영 대상은 active/healthy 상태의 `nextum-data` PostgreSQL 17 프로젝트로 확인했다. 정리 전 history는 local/remote timestamp 일치 9개, 같은 SQL이지만 timestamp가 다른 10개, remote-only 초기 migration 9개, local-only clean baseline과 v2 2개였다.

로컬 history는 다음 원칙으로 정렬했다.

- 같은 SQL인 10개 파일은 remote version timestamp로 rename
- remote-only 초기 9개 version은 clean baseline 뒤에서 legacy cutover SQL을 다시 실행하지 않는 no-op history marker로 추가
- remote에만 있던 `content.problems.type_id`를 local-only clean baseline에 반영
- 기존 remote migration SQL은 수정하지 않고, 당시 pending 상태였던 v2만 local/remote policy drift를 흡수

2026-07-10 운영 배포에서는 노출됐던 PAT를 폐기·재발급하고, 확인된 `nextum-data` project ref에만 CLI를 link했다. 첫 history write 전에 기존 28개 migration version/name/statement count를 `output/supabase-history-backup-pre-v2-20260710.json`에 보존하고 다음 순서를 실행했다.

```powershell
npx supabase link --project-ref <NEXTUM_DATA_PROJECT_REF>
npx supabase migration list --linked
npx supabase migration repair 0001 --status applied --linked
npx supabase migration list --linked
npx supabase db push --linked --dry-run
```

`repair 0001`은 SQL을 실행하지 않고 clean baseline이 이미 운영 schema에 반영돼 있다는 history record만 추가했다. dry-run에는 `20260709194443_supabase_growth_optimization_v2.sql` 하나만 표시됐고 `--include-all`은 사용하지 않았다. 다른 항목이 표시되는 경우 `repair 0001 --status reverted --linked`로 history record를 되돌리고 배포를 중단하는 원칙은 이후 환경 복구에도 동일하게 적용한다.

인덱스 preflight:

```sql
select schemaname, tablename, indexname, indexdef
from pg_indexes
where (schemaname, tablename) in (
  ('content', 'problems'),
  ('core', 'academy_members'),
  ('core', 'people'),
  ('learning', 'attempts'),
  ('learning', 'sessions'),
  ('learning', 'reports')
)
order by 1, 2, 3;
```

## 배포 순서

1. Advisor와 query latency 기준선을 저장한다.
2. migration history를 운영 DB와 일치시킨다. SQL을 다시 실행하거나 과거 파일을 억지로 적용하지 않는다.
3. `db push --linked --dry-run`에서 v2 migration 하나만 보이는지 확인한다.
4. maintenance window에 DB migration을 적용한다.
5. 아래 postflight SQL과 role matrix test를 수행한다.
6. LMS read RPC flag를 내부 운영자부터 점진적으로 켠다.
7. `create_assignment_v2` flag를 켜고 fault/concurrency smoke test를 수행한다.
8. Realtime v2 subscriber를 켜되 v1 subscriber fallback을 유지한다.
9. 최소 7일간 latency, errors, RLS denial, event volume을 관찰한다.
10. Grade App은 이 단계에서 수정하거나 재배포할 필요가 없다.

## Postflight 검증

```sql
-- 함수 권한: anon=false, authenticated/service_role=true가 기대값이다.
select
  n.nspname,
  p.proname,
  pg_get_function_identity_arguments(p.oid),
  has_function_privilege('anon', p.oid, 'execute') as anon_execute,
  has_function_privilege('authenticated', p.oid, 'execute') as authenticated_execute,
  has_function_privilege('service_role', p.oid, 'execute') as service_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where (n.nspname, p.proname) in (
  ('learning', 'list_problem_catalog_v2'),
  ('learning', 'assignment_overview_v2'),
  ('learning', 'student_progress_summary_v2'),
  ('learning', 'list_student_attempts_v2'),
  ('learning', 'create_assignment_v2'),
  ('lms', 'list_staff_roster_v2'),
  ('lms', 'class_operations_read_v2')
);

-- answer secrecy: authenticated=false, service_role=true가 기대값이다.
select
  has_column_privilege('authenticated', 'content.problems', 'answer', 'select') as authenticated_answer,
  has_column_privilege('authenticated', 'content.problems', 'answer_key', 'select') as authenticated_answer_key,
  has_column_privilege('service_role', 'content.problems', 'answer', 'select') as service_answer,
  has_table_privilege('anon', 'content.student_problems', 'select') as anon_student_view,
  has_table_privilege('authenticated', 'content.student_problems', 'select') as authenticated_student_view;

-- 동일 role/action의 permissive policy가 1개를 초과하면 실패다.
select schemaname, tablename, roles, cmd, count(*), array_agg(policyname)
from pg_policies
where permissive = 'PERMISSIVE'
group by schemaname, tablename, roles, cmd
having count(*) > 1;
```

필수 role matrix:

- anon: exposed table/RPC 접근 거부
- student: 자기 recipient/assignment/item/problem/session/attempt만 허용
- teacher/instructor: 배정 반과 해당 학생만 허용
- owner/admin/staff: 자기 academy 운영 데이터 허용
- 다른 academy 사용자: 0행 또는 403
- service_role: server workflow 성공
- 모든 student/public RPC 응답: `answer`, `answer_key` 없음

2026-07-10 remote read-only audit에서 auth-linked active student 3명 모두 같은 academy의 active student membership을 보유했고 누락은 0명이었다. 따라서 v2 student helper는 active student row와 active student membership을 함께 요구한다. 배포 후 invitation claim/revoke smoke test로 이 invariant를 다시 확인한다.

`current_assigned_class_ids()`와 `core.can_access_assigned_class(uuid)`의 durable 반 권한은 active class의 active class-profile default instructor 또는 현재 날짜에 유효한 active schedule rule로만 만든다. 과거/취소 lesson occurrence의 instructor/substitute 기록은 반 전체 roster 권한으로 승격하지 않는다. occurrence/attendance SELECT 정책은 현재 staff가 그 row의 instructor/substitute인 경우만 별도로 허용한다. 특정 occurrence 수정은 occurrence ID별 application assert 경계를 사용하며, substitute가 반 전체 roster UI를 볼 필요가 있다면 별도 제품 계약과 기간 제한을 설계한다. 변경 전 remote에서 profile/active rule 없이 과거 occurrence로만 연결된 active staff-class pair는 0개였다.

트랜잭션 fault test는 assignment insert, items insert, targets insert, recipients insert 직후 각각 실패를 주입해 orphan row가 남지 않는지 확인한다. 동일 요청 retry 정책은 애플리케이션 idempotency key가 추가되기 전까지 자동 재시도하지 않는다.

recipient contract test는 direct student exclusion, non-excluded direct student 포함, `primary_class desc, joined_at desc` class 선택, class snapshot의 same-academy active-student guard를 각각 검증한다. 2026-07-10 remote read-only fixture query에서 모든 조건이 true임을 확인했다.

성능 목표:

- 문제 catalog/count p95 100ms 이하
- class operations overview 1 RPC, route 전체 DB calls 8 이하
- assignment overview의 읽는 행 수가 전체 attempts 수가 아니라 page assignment 수에 비례
- keyset page latency가 page depth와 무관
- logical v2 mutation당 client window/domain background reload 최대 1회

## 로컬 검증 상태와 원격 적용 결과

`pglast` PostgreSQL parser로 v2 migration 275개 statement 전체의 문법 파싱을 통과했다.

배포 전 `class_operations_read_v2`의 read-only SELECT 본문을 remote schema에서 샘플 academy로 실행해 `schemaVersion`, classes/books/staff bounds, 7개 `truncated` key assertion이 모두 true임을 확인했다. DDL과 데이터 write는 수행하지 않았다.

2026-07-10 history reconciliation 뒤, Grade App 기본 포트와 분리된 격리 Supabase에서 추가 shim 없이 추적 migration 30개를 그대로 검증했다.

- 전체 fresh reset 성공, local migration history 30/30 일치
- `20260709194443_supabase_growth_optimization_v2.sql` 실제 적용 성공
- PostgREST schema cache에 49 relations, 31 RPC 로드
- `core`, `content`, `learning`, `lms`, `ai`, `data`, `reporting`, `audit` DB lint 오류 0건
- v2 migration 이력, 12-인자 staff roster RPC, class read RPC, assignment mutation RPC, 핵심 RLS가 모두 생성됨
- durable class helper 정의에 `lesson_occurrences`가 포함되지 않음을 실제 catalog에서 확인
- exact duplicate index group 0개, multiple permissive policy group 0개
- `core.user_accounts`는 self-only policy 1개, `core.staff_members`는 canonical select policy 1개

원격 read-only 기준선도 함께 저장했다.

- DB 약 24.8MB, waiting lock 0, 30초 초과 transaction 0
- Advisor: performance WARN 30개, security WARN 1개
- `content.problems` book/example count query 평균 약 583ms
- active/auth-linked 학생 3명은 모두 active student membership 보유
- membership이 없는 active 학생 2명은 auth account 없이 유효 초대 대기 중
- answer/answer_key authenticated 접근 거부, service role 접근 허용

2026-07-10 production `nextum-data`에도 v2 적용과 postflight를 완료했다.

- local/remote migration history 30/30 일치
- waiting lock 0, 30초 초과 transaction 0
- active student 5, assignment 3, recipient 3으로 배포 전후 업무 row count 동일
- v2 RPC 7개 생성 및 `anon` 실행 거부, `authenticated`/`service_role` 실행 허용
- answer/answer_key의 authenticated 접근 거부와 service role 접근 유지
- 핵심 RLS 활성화, exact duplicate index group 0개, multiple permissive policy group 0개
- `core.user_accounts`는 `user_accounts_self`, `core.staff_members`는 `staff_members_access`만 유지
- class operations payload의 7개 collection과 7개 `truncated` key 검증 통과
- problem catalog 10-row bounded read와 assignment overview aggregate smoke test 통과
- smoke query 평균: problem catalog 1.06ms, assignment overview 4.12ms, class operations 26.53ms
- performance Advisor WARN 30개에서 0개로 감소; 남은 INFO는 unindexed FK 46개, unused index 54개
- PostgreSQL 최근 로그 100건은 모두 `LOG`, 오류/경고 없음
- `npm run db:check` 48개 객체 통과
- 원격 DB를 사용하는 LMS runtime smoke에서 관리자 로그인, 주요 9개 화면, class/student API 계약 통과

Security Advisor의 `auth_leaked_password_protection` WARN 1개는 schema migration 대상이 아니다. Supabase Auth Dashboard에서 별도 활성화하고 로그인/비밀번호 재설정 흐름을 확인한다.

다음 명령은 로컬 재현성 확인용이며 모두 통과했다.

```powershell
npx supabase db reset --local --no-seed
npx supabase db lint --local --schema core,content,learning,lms,ai,data,reporting,audit --level warning --fail-on error
npx supabase migration list --local
npm run db:check
```

## 모니터링

배포 전후 같은 시간 범위로 비교한다.

- `pg_stat_statements`: authenticated content problem list/count total/mean time
- `pg_stat_user_tables`: `core.user_accounts`, `academy_members`, `class_students`, `classes` scan count
- Realtime `messages`: logical mutation당 insert/send 수
- index usage: 새 cursor/FK 인덱스의 `idx_scan`
- Advisor: `auth_rls_initplan`, `multiple_permissive_policies`, `duplicate_index`
- API logs: `42501`, `57014`, RPC validation `22023`

`unused_index` 0은 목표가 아니다. representative workload 14~30일 뒤 쓰기 비용과 read benefit을 비교해 별도 migration으로 판단한다.

## 롤백

애플리케이션 롤백이 우선이다.

1. LMS mutation flag를 내려 기존 direct mutation으로 복귀한다.
2. Realtime v2 subscriber를 끄고 v1 subscriber만 유지한다.
3. read RPC flag를 내려 기존 query path로 복귀한다.
4. DB object는 즉시 drop하지 않는다. 사용 중인 transaction과 캐시가 정리될 시간을 둔다.

DB rollback이 꼭 필요하면 기존 migration 파일을 수정하거나 history를 삭제하지 말고 새 forward-only rollback migration을 만든다.

- 기존 정책 정의를 catalog snapshot에서 복원
- 제거한 exact duplicate index는 필요할 때 canonical 정의로 재생성
- 신규 RPC execute revoke 후 dependency 확인, 그 다음 drop
- v2 emitter drop 전 호출 RPC부터 이전 버전으로 교체

데이터 rollback은 assignment/items/recipients를 개별 삭제해 해결하지 않는다. `create_assignment_v2`는 원자적이므로 성공한 업무 데이터를 보존하고 UI flag만 복귀한다.

## legacy 제거 gate

다음을 모두 만족하기 전에는 legacy content, v1 event, compatibility function을 제거하지 않는다.

- Grade App canonical migration 완료
- LMS → Grade App claim/login → assignment → submit → LMS report end-to-end 성공
- legacy `learning.books/units/concepts/types/problems` query traffic 14~30일 0
- canonical/legacy row count와 hash reconciliation 완료
- Storage object/path 계약 검증 완료
- backup restore rehearsal 완료
- rollback 승인자와 maintenance window 확정

이 gate 이후에만 별도 destructive cleanup migration과 fresh v2 baseline을 만든다.

## 참고

- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase Database Functions](https://supabase.com/docs/guides/database/functions)
- [Tables not automatically exposed to Data API](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically)
