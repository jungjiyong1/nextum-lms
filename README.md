# Nextum LMS

Nextum LMS는 학원 운영용 웹앱입니다. 기존 Electron 데스크톱 앱을 Next.js App Router 기반 웹앱으로 전환했으며, Supabase Cloud를 백엔드로 사용합니다.

## Stack

- Next.js 16 App Router
- React 19, TypeScript
- Supabase Auth, PostgreSQL, RLS
- Zustand
- Tailwind CSS, Radix UI, shadcn/ui 스타일 컴포넌트
- Vitest, React Testing Library

## Environment

`.env.local`에 아래 값을 설정합니다. grade-app의 Supabase 값을 복사해 쓰되, LMS 전용 스키마는 `lms`로 분리합니다.

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
```

`SUPABASE_SECRET_KEY`는 서버 전용입니다. `NEXT_PUBLIC_` 접두사를 붙이면 브라우저 번들에 노출되므로 사용하지 않습니다.

## Scripts

```bash
npm run dev        # Next 개발 서버
npm run build      # 프로덕션 빌드
npm run start      # 빌드 결과 실행
npm run lint       # ESLint
npm run typecheck  # TypeScript 검사
npm test -- --run  # 테스트 1회 실행
```

## Routes

- `/` 홈
- `/classrooms` 강의실/시간표
- `/instructors` 강사
- `/students` 학생
- `/accounting` 회계
- `/settings` 설정
- `/login` 로그인

## Auth

로그인은 Supabase Auth를 사용합니다. 사용자가 `admin`처럼 이메일이 아닌 아이디를 입력하면 앱에서 `admin@nextum.com` 형식으로 변환해 Supabase에 로그인 요청합니다.

## Structure

```text
src/app/              Next.js App Router routes
src/app-routes/       라우트별 클라이언트 화면 래퍼
src/screens/          페이지급 화면 컴포넌트
src/components/       기능/UI 컴포넌트
src/contexts/         AuthProvider 등 React Context
src/core/api/         Supabase API 호환 레이어
src/lib/supabase/     browser/server/admin Supabase client
src/stores/           Zustand stores
supabase/migrations/  LMS 스키마 마이그레이션
```

## Current Notes

- Electron, preload, IPC, local SQLite 경로는 제거되었습니다.
- 기존 컴포넌트가 사용하던 `window.api`는 브라우저 호환 shim으로 유지됩니다.
- Supabase Data API 설정에서 `lms` 스키마가 노출되어 있어야 브라우저 클라이언트 조회가 동작합니다.
- 장기적으로 grade-app과 공유할 학생/학습/채점 데이터는 DB 설계 문서 기준으로 core/lms/grading 영역을 분리해 확장합니다.
