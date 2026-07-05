# 개발 환경 가이드

## 🚀 핫 리로드 개발 모드

코드를 수정하면 자동으로 앱이 새로고침됩니다!

### 사용 방법

```bash
npm run dev
```

이 명령어 하나로:
- ✅ TypeScript (Main 프로세스) 자동 컴파일
- ✅ React (Renderer 프로세스) 자동 번들링
- ✅ Tailwind CSS 자동 빌드
- ✅ Electron 앱 자동 재시작

### 동작 방식

1. **Renderer 변경 시** (React, CSS)
   - `esbuild --watch`가 자동으로 번들 재생성
   - `electron-reloader`가 페이지 새로고침
   - **창이 닫히지 않고 즉시 반영**

2. **Main 프로세스 변경 시** (main.ts, src/)
   - `tsc --watch`가 자동으로 컴파일
   - `nodemon`이 변경 감지
   - Electron 앱 자동 재시작

### 팁

- 대부분의 UI 작업은 **창을 닫지 않고** 즉시 확인 가능
- DB 스키마나 IPC 핸들러 변경 시만 앱이 재시작됨
- 터미널에서 `Ctrl+C`로 종료

## 📦 일반 빌드 및 실행

변경사항 없이 앱만 실행하려면:

```bash
npm start
```

전체 빌드:

```bash
npm run build
```

## 🧪 테스트

```bash
npm test              # 테스트 실행 (watch 모드)
npm run test:coverage # 커버리지 리포트
```

## 📋 배포용 빌드

```bash
npm run dist:win      # Windows 실행파일
npm run dist:mac      # macOS 앱
```
