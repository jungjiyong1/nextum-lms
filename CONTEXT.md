# CONTEXT

## Current State

Nextum LMS는 Next.js App Router 기반 웹앱입니다. 이전 Electron 런타임, preload IPC, esbuild renderer 구조는 제거되었습니다.

마지막 주요 변경: 2026-07-05, Electron 앱을 Next.js 웹앱으로 전환.

## Architecture

```text
Next.js App Router
  -> AuthProvider / App shell
  -> Route client wrappers
  -> React components + Zustand stores
  -> src/core/api Supabase API layer
  -> Supabase PostgreSQL / Auth / RLS
```

## Key Directories

```text
src/app/              App Router route files
src/app-routes/       라우트별 client wrapper
src/screens/          페이지급 화면
src/components/       화면/도메인/UI 컴포넌트
src/contexts/         인증 컨텍스트
src/core/api/         도메인별 Supabase API
src/lib/supabase/     browser/server/admin client
src/stores/           Zustand store
src/styles/           기존 도메인 CSS
public/               정적 파일
supabase/migrations/  LMS DB 마이그레이션
```

## Runtime Notes

- `window.api`는 Electron IPC가 아니라 `src/core/api/legacyShim.ts`에서 브라우저 전역으로 연결하는 호환 레이어입니다.
- 신규 코드는 가능한 한 `window.api` 대신 `src/core/api/*` 도메인 함수를 직접 import합니다.
- Supabase browser client는 `lms` 스키마를 기본으로 사용합니다.
- 서버 전용 Supabase secret key는 `src/lib/supabase/admin.ts` 안에서만 사용합니다.

## Verification Commands

```bash
npm run lint
npm run typecheck
npm test -- --run
npm run build
```

## Development Rules

- 새 페이지는 `src/app` route와 `src/app-routes` wrapper를 함께 고려합니다.
- shared UI는 `src/components/ui`를 우선 사용합니다.
- DB 접근은 `src/core/api`에서 도메인별로 분리합니다.
- grade-app과 공유할 데이터는 앱별 테이블에 직접 중복 저장하지 말고 core/lms/grading 분리 설계를 기준으로 확장합니다.
