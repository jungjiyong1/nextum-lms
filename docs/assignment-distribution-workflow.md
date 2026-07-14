# LMS to grade-app Assignment Workflow

작성 기준일: 2026-07-07

## 목표

LMS는 강사가 학생별/반별 과제를 만들고 배포하는 원천이다. grade-app은 학생이 종이로 푼 뒤 휴대폰으로 답을 입력하고 채점, 오답, AI 튜터 학습을 이어가는 공간이다.

현재 MVP는 다음 흐름을 먼저 완성한다.

1. crop/정답 매칭이 끝난 교재 데이터를 `content`에 적재한다.
2. LMS `/assignments`에서 교재 범위 또는 새 학습지 export를 선택한다.
3. LMS에서 반/학생을 대상으로 과제를 생성한다.
4. grade-app 홈의 과제함에 학생별 과제가 표시된다.
5. 학생이 답을 입력하면 `learning.sessions`, `learning.attempts`에 결과가 쌓인다.
6. LMS 과제 상세에서 대상별 진행률, 정답률, 문제별 풀이 현황을 본다.

## 데이터 기준

| 영역 | 역할 |
| --- | --- |
| `content.books` | 채점 가능한 교재/학습지 묶음 |
| `content.units`, `content.concepts`, `content.problem_types`, `content.problems` | 단원, 개념, 유형, 문제와 정답 |
| `content.assets`, Storage `problem-images` | 문제 crop 이미지 |
| `learning.assignments` | LMS가 만든 과제 |
| `learning.assignment_targets` | 강사가 선택한 반/학생 대상 |
| `learning.assignment_recipients` | 생성 시점의 학생 대상 스냅샷 |
| `learning.assignment_items` | 과제에 포함된 문제 목록 |
| `learning.assignment_files` | 학생에게 같이 보여줄 학습지 파일 |
| `learning.sessions`, `learning.attempts` | grade-app 채점 결과 |
| `ai.conversations`, `ai.messages` | grade-app AI 튜터 대화 |

## 기존 crop 데이터 가져오기

grade-app에 있는 fixtures를 공용 Supabase의 `content`로 가져온다. LMS 저장소
루트에서 실행한다.

```bash
npm run db:import-grade-fixtures
```

기본 입력 위치는 LMS 저장소와 같은 상위 폴더의 `grade-app/fixtures`다. 현재
자동으로 가져오는 자료:

- `fixtures/export.json`
- `fixtures/gaeppul_power_math2_2/export.json`
- `fixtures/gaeppul_power_math3_1/export.json`

다른 경로를 지정할 수도 있다.

```bash
npm run db:import-grade-fixtures -- /path/to/export-folder
npm run db:import-grade-fixtures -- --grade-app-dir /path/to/grade-app
```

객관식 변환 번들은 `answer`, `answer_key`, 학생 공개용 `public_payload`,
소문항 변환 상태와 crop 메타데이터를 함께 유지한다. 중학교 라이트 6권의
운영 반영 상태는 다음 명령으로 전수 검증한다.

```bash
npm run db:verify-gaeppul-light
```

검증 기준은 `scripts/manifests/gaeppul-middle-light-v1.json`에 고정되어 있으며,
총 3,094문항의 이미지, 개념/유형 연결, 객관식 정답, 공개 payload와 소문항
분리 상태를 확인한다.

특정 학원 전용 교재로 넣고 싶으면 `--academy-id`를 붙인다. 붙이지 않으면 모든 학원에서 선택 가능한 공용 교재로 들어간다.

```bash
npm run db:import-grade-fixtures -- --academy-id <academy-uuid>
```

필요 환경변수:

- `NEXT_PUBLIC_SUPABASE_URL` 또는 `SUPABASE_URL`
- `SUPABASE_SECRET_KEY` 또는 `SUPABASE_SERVICE_ROLE_KEY`

## 새 학습지 export 배포

학생별 PDF를 직접 만든 경우에는 먼저 crop/정답 매칭을 거쳐 `export.json` 또는 `zip(export.json + images/)`으로 만든다. LMS `/assignments`의 `새 학습지 export`에서 업로드하면 다음이 자동 처리된다.

- export를 숨김 교재로 저장
- 문제 이미지 Storage 업로드
- 과제 생성
- 대상 학생 스냅샷 생성
- grade-app 과제함 노출

이 경로는 매주 학생별 부족 유형 PDF를 만들고 채점 가능한 데이터로 바꾸는 운영 흐름의 시작점이다.

## 검증

DB 구조 적용 후 먼저 확인한다.

```bash
npm run db:check
```

자료를 가져온 뒤 LMS `/assignments`에서 교재가 보이면 과제를 생성한다. 학생 계정으로 grade-app에 로그인하면 홈에 해당 과제가 떠야 한다.

주의: 새 Supabase 프로젝트에 migration을 적용하려면 DB password 또는 service role key가 필요하다. publishable key만으로는 테이블 생성과 import를 할 수 없다.
