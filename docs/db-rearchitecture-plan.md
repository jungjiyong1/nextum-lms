# NEXTUM LMS / grade-app 통합 DB 재편 계획안

작성 기준일: 2026-07-05

## 결론

`data` 전용 스키마 하나에 모든 앱 데이터를 넣는 구조는 장기적으로 위험하다. 빠르게 쌓기는 쉽지만, 학생 신원, 수업 등록, 교재 권한, 채점 결과, AI 채팅, 리포트가 서로 어떤 관계인지 DB가 보장하지 못한다. 그래서 운영 원본 데이터는 도메인별 정규 테이블에 두고, `data`는 분석과 재처리를 위한 append-only 이벤트 저장소로만 사용한다.

최종 구조는 다음 원칙으로 간다.

- `core`: 사람, 학생, 직원, 계정, 학원, 멤버십의 단일 원본
- `lms`: 강의, 시간표, 수강, 출결, 원비/정산 같은 학원 운영 원본
- `content`: 교재, 단원, 개념, 문제, 이미지/첨부 같은 콘텐츠 원본
- `learning`: 과제, 풀이 세션, 채점 시도, 오답, 학습 상태 원본
- `ai`: 학생 AI 채팅, 메시지, 첨부, 요약/메모리 원본
- `data`: 앱 이벤트와 원시 로그를 누적하는 분석용 저장소
- `reporting`: 앱이 바로 읽는 리포트 view/materialized view
- `audit`: 관리자 조작, 권한 변경, 중요 데이터 변경 이력

현재처럼 LMS와 grade-app이 각각 학생 테이블을 갖는 구조는 중단한다. 학생은 `core.students.id` 하나로 식별하고, grade-app의 채점 데이터와 LMS의 수업/학생 데이터는 모두 이 ID를 바라본다.

## 현재 구조의 핵심 문제

현재 LMS는 `lms.profiles`, `lms.students`, `lms.instructors`, `lms.academy_members`를 가지고 있고, grade-app은 `core.profiles`, `core.classes`, `core.class_students`, `core.class_books`를 가지고 있다. 즉 학생과 반, 계정의 원본이 앱마다 갈라져 있다.

grade-app은 `learning` 스키마 안에 교재/문제 콘텐츠와 풀이/채점 활동을 같이 넣고 있다. 장기적으로 교재 관리, 수업 배정, 채점, 리포트, AI 학습 데이터가 늘어나면 이 구조는 권한과 조인, 리포트 생성이 복잡해진다.

또한 grade-app은 현재 학생 ID를 `auth.uid()`로 보는 흐름이 강하다. 하지만 장기적으로는 로그인 계정과 학생 업무 ID를 분리해야 한다. 학생이 LMS에 먼저 등록되고 나중에 원하는 아이디/비밀번호로 가입하는 흐름을 만들려면 `auth.users.id`를 학생 ID로 쓰면 안 된다.

## 기준 ID 모델

인증 ID와 업무 ID를 분리한다.

| 대상 | 권장 ID | 설명 |
| --- | --- | --- |
| 인증 계정 | `auth.users.id` | Supabase 로그인 전용 |
| 사람 | `core.people.id` | 실제 사람 1명 |
| 학원 소속 학생 | `core.students.id` | 학원별 학생 원본, 모든 학습/수강 데이터의 기준 |
| 학원 소속 직원 | `core.staff_members.id` | 강사, 관리자, 조교 등 |
| 학원 | `core.academies.id` | 모든 운영 데이터의 tenant 기준 |

`core.user_accounts`가 `auth.users.id`와 `core.people.id`를 연결한다. 학생이 로그인하면 앱은 `auth.uid()`로 바로 학습 데이터를 찾지 않고, `core.user_accounts -> core.people -> core.students` 순서로 현재 학생 ID를 찾는다.

권장 helper 함수:

- `core.current_person_id()`
- `core.current_academy_id()`
- `core.current_student_id(academy_id uuid)`
- `core.has_academy_role(academy_id uuid, roles text[])`
- `core.can_access_student(student_id uuid)`

앱 코드는 가능하면 이 helper 또는 RPC/view를 통해 접근하고, UI에서 cross-schema 조인을 직접 흩뿌리지 않는다.

## 학생 등록과 가입 흐름

목표 흐름은 LMS가 학생 원본을 만들고, 학생은 나중에 본인이 원하는 로그인 정보를 선택하는 방식이다.

1. LMS 관리자가 학생을 등록한다.
2. DB에 `core.people`과 `core.students`가 생성된다.
3. LMS가 `core.account_invitations`에 학생 가입 초대권을 만든다.
4. 학생은 초대 링크 또는 초대 코드를 통해 grade-app에서 가입한다.
5. 학생이 원하는 아이디/비밀번호를 입력한다.
6. 서버 함수가 Supabase Auth 계정을 만들고 `core.user_accounts`에 연결한다.
7. grade-app 로그인 후 `core.current_student_id()`로 본인의 `core.students.id`를 찾는다.

Supabase Auth는 기본적으로 email/password 로그인이므로, 학생 아이디는 내부 이메일로 매핑하는 방식이 현실적이다. 예: `academycode.studentid@login.nextum.local`. 화면에는 학생이 고른 아이디만 보여주고, 실제 Auth email은 `core.login_aliases` 또는 `core.user_accounts.auth_email`에 보관한다.

관리자 초기 계정도 같은 구조로 seed한다. 예: `admin / 1234`는 화면 로그인 ID이고, 내부 Auth email은 `admin@nextum.com` 또는 시스템 규칙에 맞춘 email을 사용한다.

## 스키마별 설계

### core

`core`는 사람과 권한의 단일 원본이다.

주요 테이블:

| 테이블 | 역할 |
| --- | --- |
| `core.academies` | 학원/조직 |
| `core.people` | 이름, 생년월일, 연락처 등 사람 공통 정보 |
| `core.students` | 학원별 학생 정보, `academy_id`, `person_id`, 상태, 학교/학년 등 |
| `core.staff_members` | 학원별 직원/강사 정보, `academy_id`, `person_id`, 직무 |
| `core.guardian_links` | 학생과 보호자 관계 |
| `core.user_accounts` | `auth.users.id`와 `people.id` 연결 |
| `core.login_aliases` | 학생/직원 로그인 ID와 내부 Auth email 매핑 |
| `core.account_invitations` | 학생/직원 가입 초대권 |
| `core.academy_members` | 사용자 계정의 학원 권한, admin/staff/instructor/student 등 |
| `core.user_security_settings` | PIN, idle timeout, 보안 설정 |

`lms.profiles`, `lms.students`, `lms.instructors`, grade-app의 `core.profiles`는 이 구조로 흡수한다. 장기적으로 `profiles`라는 이름은 auth profile 정도로만 제한하고, 학생/강사 원본으로 쓰지 않는다.

### lms

`lms`는 학원 운영 원본이다. 학생 신상 원본을 갖지 않고 `core.students.id`만 참조한다.

주요 테이블:

| 테이블 | 역할 |
| --- | --- |
| `lms.classrooms` | 강의실 |
| `lms.courses` | 과정/상품/커리큘럼 운영 단위 |
| `lms.lessons` | 실제 강의/반 |
| `lms.lesson_rules` | 반복 규칙 |
| `lms.lesson_schedules` | 개별 수업 일정 |
| `lms.enrollments` | 학생 수강 등록, `student_id -> core.students.id` |
| `lms.attendance` | 출결 |
| `lms.student_payments` | 학생 납부 |
| `lms.instructor_payments` | 강사 정산 |
| `lms.transactions`, `lms.transaction_lines` | 회계 전표 |
| `lms.settings` | 학원별 LMS 설정 |

grade-app의 `core.classes`, `core.class_students`, `core.class_books`는 `lms.lessons`/`lms.enrollments`와 `learning.assignments`로 대체한다. 교재 접근 권한을 LMS 반 테이블에 직접 저장하지 않고, 학습 도메인의 과제로 관리한다.

### content

`content`는 교재와 문제의 단일 원본이다.

주요 테이블:

| 테이블 | 역할 |
| --- | --- |
| `content.books` | 교재 |
| `content.units` | 단원 |
| `content.concepts` | 개념 |
| `content.problem_types` | 문제 유형 |
| `content.problems` | 문제 본문, 정답, 해설, 난이도 |
| `content.assets` | 이미지, PDF, 음원 등 첨부 |
| `content.problem_reports` | 문제 오류 신고 |
| `content.import_batches` | 교재 가져오기 이력 |

현재 grade-app의 `learning.books`, `learning.units`, `learning.concepts`, `learning.types`, `learning.problems`는 `content`로 옮긴다. `learning`은 학생 활동만 맡는다.

### learning

`learning`은 학생별 학습 활동과 채점 원본이다.

주요 테이블:

| 테이블 | 역할 |
| --- | --- |
| `learning.assignments` | 교재/단원/문제세트 과제 |
| `learning.assignment_targets` | 과제 대상, academy/lesson/student 단위 |
| `learning.sessions` | 학생 풀이 세션 |
| `learning.attempts` | 문제별 채점 시도, append-only 권장 |
| `learning.wrong_notes` | 오답노트 |
| `learning.student_mastery` | 학생별 개념 숙련도 스냅샷 |
| `learning.student_daily_metrics` | 일자별 학습 집계 |

`learning.sessions.student_id`, `learning.attempts.student_id`는 `auth.uid()`가 아니라 `core.students.id`를 참조한다. `attempts`는 수정/삭제를 제한하고, 정정이 필요하면 새 attempt 또는 audit record로 남긴다.

### ai

`ai`는 학생 AI 대화와 파생 지식의 원본이다.

주요 테이블:

| 테이블 | 역할 |
| --- | --- |
| `ai.conversations` | 학생/수업/문제 단위 대화방 |
| `ai.messages` | user/assistant/tool 메시지 |
| `ai.attachments` | 이미지, 문제 캡처, 파일 |
| `ai.student_memories` | 장기 개인화 메모리 |
| `ai.extracted_learning_signals` | AI 대화에서 추출한 약점/관심/오개념 |
| `ai.moderation_events` | 안전/정책 관련 이벤트 |

AI 데이터는 리포트에 바로 쓰지 말고, 검증된 요약 또는 signal만 `reporting`/`learning`으로 반영한다.

### data

`data`는 "원본 운영 테이블"이 아니라 "분석용 이벤트 저장소"다.

주요 테이블:

| 테이블 | 역할 |
| --- | --- |
| `data.events` | 모든 앱의 append-only 이벤트 |
| `data.raw_ingest_batches` | 외부/AI/스크립트 원시 수집 이력 |
| `data.entity_snapshots` | 리포트 재생성을 위한 JSONB 스냅샷 |

권장 `data.events` 컬럼:

- `id`
- `academy_id`
- `student_id`
- `source_app`: `lms`, `grade_app`, `ai`, `admin_script`
- `event_type`
- `entity_schema`
- `entity_table`
- `entity_id`
- `occurred_at`
- `payload jsonb`

즉, `data`에는 때려박되 이것만 믿고 운영하지 않는다. 운영 화면과 권한 판단은 항상 `core`, `lms`, `content`, `learning`, `ai` 원본 테이블을 기준으로 한다.

### reporting

`reporting`은 앱과 리포트 제작기가 읽는 view/materialized view 계층이다.

예시:

- `reporting.student_profile`
- `reporting.student_learning_summary`
- `reporting.student_problem_weakness`
- `reporting.student_concept_mastery`
- `reporting.lesson_progress`
- `reporting.payment_status`
- `reporting.ai_learning_summary`

LMS에서 "학생 데이터 불러와서 리포트 제작"을 하려면 UI가 원본 테이블 10개를 직접 조인하지 말고 이 계층을 읽어야 한다.

### audit

`audit`는 중요한 변경 이력을 보관한다.

예시:

- 학생 개인정보 변경
- 계정 연결/초대 수락
- 권한 변경
- 수업/수강 변경
- 결제/정산 변경
- 채점 데이터 정정
- 관리자 reset 작업

## RLS와 권한 원칙

모든 앱은 같은 Supabase 프로젝트를 쓰되, 권한 판단은 `core` helper 함수로 통일한다.

권장 정책:

- 관리자는 자기 학원 데이터만 관리할 수 있다.
- 강사는 배정된 수업과 학생의 필요한 정보만 볼 수 있다.
- 학생은 자기 `core.students.id`와 연결된 학습 데이터만 볼 수 있다.
- `content`는 배정된 과제 또는 공개 콘텐츠만 읽을 수 있다.
- `learning.attempts`는 학생 insert/select 중심으로 두고 update/delete는 제한한다.
- `finance` 성격의 LMS 테이블은 admin 권한으로 제한한다.
- `reporting` view는 `security_invoker = on` 또는 내부 RLS helper를 기준으로 한다.

## 마이그레이션 전략

현재 데이터가 이미 날아간 상태라면 기존 구조를 억지로 보존하지 않는 편이 낫다. 새 DB는 v2 구조를 기준으로 다시 만든다.

1. v2 DB 설계 확정
2. 기존 `lms` 중복 학생/강사/프로필 원본 폐기
3. `core` canonical 테이블과 RLS helper 생성
4. `content` 교재/문제 테이블 생성
5. `learning` 과제/세션/시도 테이블 생성
6. `lms` 운영 테이블을 `core.students.id`, `core.staff_members.id` 참조로 재생성
7. `ai`, `data`, `reporting`, `audit` 생성
8. admin seed와 학생 초대 flow 구현
9. grade-app과 LMS를 새 API/view 기준으로 전환

기존 remote에 남은 실험 데이터가 있다면 백업 후 reset한다. 지금 단계에서는 compatibility view를 오래 유지하기보다, 앱 변경과 DB v2를 같이 맞추는 것이 장기 비용이 낮다.

## 금지할 구조

- `lms.students`와 `core.profiles`가 동시에 학생 원본이 되는 구조
- `auth.uid()`를 학생 ID로 직접 쓰는 구조
- 교재/문제와 풀이/채점을 모두 `learning`에 넣는 구조
- `data.events` JSONB만 믿고 운영 화면을 만드는 구조
- UI 코드가 여러 스키마의 원본 테이블을 직접 복잡하게 조인하는 구조

## 최종 판단

최적 구조는 "공유 DB 하나 + 도메인별 스키마 분리 + core 기반 권한 + reporting 읽기 계층"이다. 이렇게 해야 LMS에서 등록한 학생이 grade-app에서 로그인하고, grade-app 채점 데이터와 AI 채팅 데이터가 다시 LMS 리포트로 들어오는 흐름을 안정적으로 만들 수 있다.
