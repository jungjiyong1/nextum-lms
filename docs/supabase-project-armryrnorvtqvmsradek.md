# Supabase Project: armryrnorvtqvmsradek

작성 기준일: 2026-07-07

## Project Info

| 항목 | 값 |
| --- | --- |
| Project URL | `https://armryrnorvtqvmsradek.supabase.co` |
| Project ref | `armryrnorvtqvmsradek` |
| Publishable key | `sb_publishable_c9gAS8S5KEeQO-ZY97uf7Q_vbi13w5A` |
| Direct connection string | `postgresql://postgres:[YOUR-PASSWORD]@db.armryrnorvtqvmsradek.supabase.co:5432/postgres` |

## CLI Setup

```bash
supabase login
supabase init
supabase link --project-ref armryrnorvtqvmsradek
```

## Required Before DB Apply

아래 값은 아직 이 문서에 없다. 원격 DB migration/import/seed에는 둘 중 하나 이상이 필요하다.

- Supabase DB password
- `SUPABASE_SECRET_KEY` 또는 `SUPABASE_SERVICE_ROLE_KEY`

Publishable key만으로는 schema 생성, migration 적용, content import, LMS admin seed를 실행할 수 없다.

## Intended Data Model Source

이 프로젝트에는 `nextum-lms`의 Supabase migrations 전체를 적용한다.

```text
supabase/migrations/
```

적용 후 검증:

```bash
npm run db:check
```

grade-app fixtures를 초기 채점 가능 교재로 넣을 때:

```bash
npm run db:import-grade-fixtures
```

## App Env Mapping

새 프로젝트로 전환할 때 두 앱 모두 같은 URL/key를 사용한다.

```bash
NEXT_PUBLIC_SUPABASE_URL=https://armryrnorvtqvmsradek.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_c9gAS8S5KEeQO-ZY97uf7Q_vbi13w5A
SUPABASE_SECRET_KEY=<new-server-only-key>
SUPABASE_SERVICE_ROLE_KEY=<new-server-only-key>
```

grade-app은 `SUPABASE_URL`도 서버 라우트 fallback으로 사용한다.

```bash
SUPABASE_URL=https://armryrnorvtqvmsradek.supabase.co
```

주의: 기존 프로젝트의 server key를 새 URL과 섞으면 admin/import 작업이 실패한다. URL과 server key는 반드시 같은 Supabase 프로젝트의 값을 사용한다.
