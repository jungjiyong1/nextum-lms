# nextum-data LMS Cutover Runbook

작성일: 2026-07-06

## 현재 결론

`nextum-data`는 LMS가 기대하는 clean baseline과 아직 맞지 않는다. LMS 앱 코드는 `supabase/migrations/0001_nextum_lms_baseline.sql` 기준으로 정리되어 있지만, 원격 DB에는 구 LMS 테이블과 일부 새 `core/content/learning` 테이블이 섞여 있다.

따라서 인증 후 LMS 화면을 운영용으로 쓰기 전에 반드시 다음 조건을 만족해야 한다.

1. 실제 백업을 먼저 만든다.
2. grade-app 교재/문제/채점 데이터와 Storage 파일을 보존한다.
3. clean baseline을 새 DB, Supabase branch, 또는 명시적으로 폐기 가능한 DB에 적용한다.
4. 보존 데이터를 새 구조로 이관한다.
5. `npm run db:check`가 통과해야 한다.
6. LMS 핵심 플로우를 브라우저에서 검증한 뒤 grade-app 수정에 들어간다.

## 대상 프로젝트

| 항목 | 값 |
| --- | --- |
| Supabase project | `nextum-data` |
| project ref | `lecdpaxcguxdkdrevpzw` |
| 상태 | `ACTIVE_HEALTHY` |
| Postgres | 17 |
| 원칙 | 현재 문서 작성 단계에서는 DB를 변경하지 않는다. |

## 보존 대상 인벤토리

2026-07-06 기준 읽기 전용 SQL로 확인한 행 수다.

| 영역 | 테이블 | 행 수 | 판단 |
| --- | --- | ---: | --- |
| 교재 | `content.books` | 3 | 반드시 보존 |
| 교재 | `content.units` | 50 | 반드시 보존 |
| 교재 | `content.concepts` | 11 | 반드시 보존 |
| 교재 | `content.problem_types` | 251 | 반드시 보존 |
| 교재 | `content.problems` | 1604 | 반드시 보존 |
| 교재 | `content.assets` | 0 | 테이블은 비어 있지만 Storage 별도 확인 필요 |
| 교재 | `content.problem_reports` | 0 | 현재 보존 부담 낮음 |
| 파일 | `storage.objects` | 1594 | 반드시 보존 |
| 인증 | `auth.users` | 4 | 운영 계정/학생 계정 여부 확인 후 보존 또는 재생성 |
| 핵심 | `core.academies` | 2 | 반드시 검토 후 보존 |
| 핵심 | `core.user_accounts` | 4 | Auth 계정 연결 보존 후보 |
| 핵심 | `core.academy_members` | 6 | 학원별 권한 연결 보존 후보 |
| 핵심 | `core.people` | 8 | 반드시 보존 후보 |
| 핵심 | `core.students` | 4 | 반드시 보존 후보 |
| 핵심 | `core.staff_members` | 4 | 반드시 보존 후보 |
| 핵심 | `core.classes` | 1 | 반드시 보존 후보 |
| 핵심 | `core.class_students` | 2 | 반드시 보존 후보 |
| 핵심 | `core.class_books` | 3 | 반드시 보존 후보 |
| 핵심 | `core.user_security_settings` | 2 | PIN/세션 설정 보존 후보 |
| 학습 | `learning.sessions` | 10 | grade-app 채점 흐름 보존 후보 |
| 학습 | `learning.attempts` | 105 | 반드시 보존 후보 |
| 학습 | `learning.wrong_notes` | 0 | 현재 보존 부담 낮음 |
| AI | `ai.conversations` | 0 | 현재 보존 부담 낮음 |
| AI | `ai.messages` | 0 | 현재 보존 부담 낮음 |
| AI | `ai.attachments` | 0 | 현재 비어 있음. REST grant가 없어 백업 스크립트에서는 경고 발생 |
| 이벤트 | `data.events` | 0 | 현재 보존 부담 낮음 |
| 구 LMS | `lms.academies` | 1 | seed/호환 데이터로 보임, 이관 또는 재생성 |
| 구 LMS | `lms.academy_members` | 1 | seed/호환 데이터로 보임, 이관 또는 재생성 |
| 구 LMS | `lms.profiles` | 1 | seed/호환 데이터로 보임, 이관 또는 재생성 |
| 구 LMS | 나머지 운영 테이블 | 0 | 삭제/재생성 위험 낮음 |

## 현재 스키마 차이

`npm run db:check` 결과 38개 기준 객체 중 28개가 실패한다. 대표 차이는 다음과 같다.

| 영역 | 현재 문제 | 필요한 조치 |
| --- | --- | --- |
| `core` | `academies.status`, `people.display_name`, `class_students.status`, `class_books.active` 등 누락 | baseline 컬럼/제약/인덱스로 정렬 |
| `content` | `books.academy_id`, `concepts.unit_id`, `problem_types.unit_id`, `problems.problem_type_id` 누락 | 기존 교재 데이터를 백업한 뒤 새 contract로 이관 |
| `lms` | `class_profiles`, `class_schedule_rules`, `lesson_occurrences`, `attendance_records`, `student_billing_contracts`, `billing_class_rules`, `invoices`, `invoice_lines`, `payments` 없음 | 구 LMS 테이블을 새 운영 테이블로 교체 |
| `lms` | `classrooms.capacity/active`, `expenses.status`, `instructor_payments.service_month` 등 누락 | baseline 컬럼으로 정렬 |
| `learning` | `sessions/attempts/wrong_notes/reports.academy_id` 누락 | grade-app 데이터와 `core.students.id` 연결 보강 |
| `ai` | `conversations.core_student_id` 누락 | 학생 분석/리포트 연결용 컬럼 추가 |
| `data` | `events.class_id` 누락 | 반 단위 분석 이벤트를 위해 추가 |
| `reporting` | `v_student_type_weakness`, `v_class_learning_summary` 없음 | LMS 대시보드/리포트용 view 생성 |

## 권장 전환 방식

가장 안전한 방식은 기존 `nextum-data`를 바로 파괴적으로 고치는 것이 아니라, Supabase branch 또는 새 DB에서 baseline을 먼저 검증하는 것이다.

1. `npm run db:backup-content`로 `content.*` JSON 백업을 만든다.
2. SQL/도구로 `core.*`, `learning.sessions`, `learning.attempts`, `auth.users` 매핑, `storage.objects`를 별도 백업한다.
3. Supabase branch 또는 새 프로젝트에 `0001_nextum_lms_baseline.sql`을 적용한다.
4. `content` 데이터를 새 컬럼명으로 이관한다.
   - `content.problems.type_id`는 `problem_type_id`로 매핑한다.
   - `content.books.academy_id`는 대상 학원 ID로 채운다.
   - `content.concepts.unit_id`, `content.problem_types.unit_id`는 기존 문제/단원 관계를 기준으로 가능한 범위에서 채운다.
5. `core` 학생/강사/반 데이터는 중복을 제거하고 `core.people`, `core.students`, `core.staff_members`, `core.classes`, `core.class_students`, `core.class_books`에 맞춘다.
6. `learning.sessions/attempts`는 `core_student_id`, `academy_id`를 채운 뒤 append-only 성격을 유지한다.
7. Storage 파일은 기존 object path가 grade-app에서 깨지지 않게 보존한다.
8. Data API 노출 schema, role grant, RLS policy를 baseline 기준으로 확인한다.
9. `npm run db:check`를 통과시킨다.
10. LMS에서 `admin / 1234` dev 계정으로 로그인, 학생 등록, 초대코드 발급, 반/교재 연결, 출석, 청구 생성을 검증한다.

## 절대 먼저 하면 안 되는 일

- `content.*`, `learning.*`, `storage.objects`를 백업 없이 drop/truncate하지 않는다.
- 구 `lms.*`가 대부분 비어 있어도 `auth.users`, `core.user_accounts`, `core.academy_members` 연결을 확인하지 않고 계정을 삭제하지 않는다.
- `data.events` 같은 JSON 이벤트 저장소만 믿고 운영 화면의 원본 데이터를 대체하지 않는다.
- `db:check`가 실패한 상태로 인증 후 LMS 화면을 운영용으로 쓰지 않는다.

## 검증 명령

```bash
npm run db:backup-content -- --dry-run
npm run db:backup-content
npm run db:backup-preservation -- --dry-run
npm run db:backup-preservation
npm run db:check
npm run typecheck
npm test -- --run
npm run lint
npm run build
```

`db:backup-preservation` exports the broader cutover payload: `core`, `content`, `learning`, `ai`, `data`, legacy `lms` tables, and a Storage manifest. Use `--include-storage-files` when the actual Storage object contents also need to be copied to `backups/`.

현재 `db:backup-preservation -- --dry-run`에서 확인된 경고:

- `content.import_batches`: 현재 원격 DB에 없는 선택 테이블이다.
- `ai.attachments`: 현재 0행이지만 REST/Data API grant가 없어 선택 백업에서 permission 경고가 난다. baseline 적용 시 `service_role` grant를 포함해야 한다.

`db:check`는 현재 원격 `nextum-data`에서 실패하는 것이 정상이다. 이 명령이 통과하기 전까지는 DB 전환이 끝난 것이 아니다.

## 참고

- Supabase Data API는 schema 노출, role grant, RLS가 분리되어 있다. SQL로 테이블을 만든 뒤 브라우저 클라이언트에서 접근하려면 노출 설정과 grant/RLS를 같이 확인해야 한다.
- Supabase 공식 문서: https://supabase.com/docs/guides/api/securing-your-api
- 관련 Supabase 변경 공지: https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically
