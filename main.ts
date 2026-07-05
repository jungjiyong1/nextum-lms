/* eslint-disable @typescript-eslint/no-var-requires */
const { app, BrowserWindow } = require('electron');
const path = require('path');

// Supabase로 마이그레이션됨 - SQLite 관련 임포트 제거됨
// 프론트엔드에서 직접 Supabase API를 호출하므로 IPC 핸들러는 더 이상 필요하지 않음

// Hot reload in development
try {
  if (!app.isPackaged) {
    require('electron-reloader')(module, {
      debug: true,
      watchRenderer: true
    });
  }
} catch (_) { }

// 프로젝트 루트 경로 (dist 폴더 기준으로 상위)
const PROJECT_ROOT = path.join(__dirname, '..');

function createWindow(): void {
  const win = new BrowserWindow({
    title: 'NEXTUM LMS',
    icon: path.join(PROJECT_ROOT, 'build', 'icon.png'),
    width: 1200,
    height: 860,
    minWidth: 960,
    minHeight: 700,
    backgroundColor: '#151824',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.removeMenu();
  win.loadFile(path.join(PROJECT_ROOT, 'renderer', 'index.html'));

  // Open DevTools in development mode
  if (!app.isPackaged) {
    win.webContents.openDevTools();
  }
}

function initializeApp(): void {
  // Supabase로 마이그레이션됨
  // 모든 데이터 작업은 프론트엔드에서 직접 Supabase API를 통해 수행됨
  // SQLite 데이터베이스 초기화 및 IPC 핸들러는 더 이상 필요하지 않음

  console.log('NEXTUM LMS Started (Supabase mode)');

  // 윈도우 생성
  createWindow();
}

app.whenReady().then(() => {
  initializeApp();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
