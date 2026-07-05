# Development Guide

## Local Development

```bash
npm install
npm run dev
```

Next 개발 서버가 실행되면 브라우저에서 표시된 localhost 주소로 접속합니다.

## Verification

수정 후 아래 순서로 확인합니다.

```bash
npm run lint
npm run typecheck
npm test -- --run
npm run build
```

프로덕션 실행 확인이 필요하면:

```bash
npm run start
```

## Supabase

- 브라우저 클라이언트는 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`만 사용합니다.
- 서버 전용 작업은 `SUPABASE_SECRET_KEY`를 사용하는 `src/lib/supabase/admin.ts`에만 둡니다.
- 앱 데이터는 Supabase `lms` 스키마를 사용합니다.
- Supabase Data API 설정에서 `lms` 스키마를 노출해야 클라이언트 쿼리가 동작합니다.
- RLS 정책은 인증 사용자와 학원 소속 기준으로 설계합니다.

## Adding Pages

1. `src/app/<route>/page.tsx`를 추가합니다.
2. 화면 로직이 client component라면 `src/app-routes/`에 래퍼를 둡니다.
3. 공통 shell 안에 보여야 하면 `src/App.tsx`의 라우트 판별과 `Sidebar` 내비게이션을 갱신합니다.

## Adding API Functions

도메인별 파일에 추가합니다.

```text
src/core/api/students.ts
src/core/api/instructors.ts
src/core/api/lessons.ts
src/core/api/schedules.ts
src/core/api/accounting.ts
```

기존 화면 호환이 필요하면 `src/core/api/index.ts`의 `supabaseApi` 객체에도 연결합니다.
