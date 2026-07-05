const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const Database = require('better-sqlite3');

let db;

function initDb() {
  const dbPath = path.join(app.getPath('userData'), 'lms2.sqlite');
  db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS classrooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      x REAL NOT NULL,
      y REAL NOT NULL,
      width REAL NOT NULL,
      height REAL NOT NULL,
      color TEXT NOT NULL,
      name TEXT
    );
    CREATE TABLE IF NOT EXISTS timetable (
      classroom_id INTEGER NOT NULL,
      day INTEGER NOT NULL,
      slot INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (classroom_id, day, slot),
      FOREIGN KEY (classroom_id) REFERENCES classrooms(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS lessons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      classroom_id INTEGER NOT NULL,
      day INTEGER NOT NULL,
      start_slot INTEGER NOT NULL,
      end_slot INTEGER NOT NULL,
      title TEXT NOT NULL,
      instructor TEXT NOT NULL,
      note TEXT,
      FOREIGN KEY (classroom_id) REFERENCES classrooms(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_lessons_room_day ON lessons(classroom_id, day, start_slot, end_slot);
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const columns = db.prepare('PRAGMA table_info(classrooms)').all();
  const hasName = columns.some((column) => column.name === 'name');
  if (!hasName) {
    db.prepare('ALTER TABLE classrooms ADD COLUMN name TEXT').run();
  }

  db.prepare(
    "UPDATE classrooms SET name = '강의실 ' || id WHERE name IS NULL OR name = ''"
  ).run();

  const lessonCount = db.prepare('SELECT COUNT(*) AS count FROM lessons').get().count;
  const legacyCount = db.prepare('SELECT COUNT(*) AS count FROM timetable').get().count;
  if (lessonCount === 0 && legacyCount > 0) {
    const rows = db.prepare(
      'SELECT classroom_id, day, slot FROM timetable ORDER BY classroom_id, day, slot'
    ).all();

    let current = null;
    rows.forEach((row) => {
      if (
        !current ||
        current.classroom_id !== row.classroom_id ||
        current.day !== row.day ||
        row.slot !== current.end_slot
      ) {
        if (current) {
          db.prepare(
            'INSERT INTO lessons (classroom_id, day, start_slot, end_slot, title, instructor, note) VALUES (?, ?, ?, ?, ?, ?, ?)'
          ).run(
            current.classroom_id,
            current.day,
            current.start_slot,
            current.end_slot,
            '수업',
            '',
            ''
          );
        }
        current = {
          classroom_id: row.classroom_id,
          day: row.day,
          start_slot: row.slot,
          end_slot: row.slot + 1
        };
      } else {
        current.end_slot = row.slot + 1;
      }
    });

    if (current) {
      db.prepare(
        'INSERT INTO lessons (classroom_id, day, start_slot, end_slot, title, instructor, note) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(
        current.classroom_id,
        current.day,
        current.start_slot,
        current.end_slot,
        '수업',
        '',
        ''
      );
    }
  }
}

function getNextColor() {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get('nextHue');
  let hue = row ? Number(row.value) : 0;
  const color = `hsl(${Math.round(hue % 360)} 55% 75%)`;
  hue = (hue + 137.508) % 360;

  if (row) {
    db.prepare('UPDATE meta SET value = ? WHERE key = ?').run(String(hue), 'nextHue');
  } else {
    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('nextHue', String(hue));
  }

  return color;
}

function createWindow() {
  const win = new BrowserWindow({
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
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  initDb();
  createWindow();

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

ipcMain.handle('classrooms:list', () => {
  return db.prepare('SELECT * FROM classrooms ORDER BY id').all();
});

ipcMain.handle('classrooms:create', (_event, rect) => {
  const color = getNextColor();
  const stmt = db.prepare(
    'INSERT INTO classrooms (x, y, width, height, color, name) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const info = stmt.run(rect.x, rect.y, rect.width, rect.height, color, '');
  const id = info.lastInsertRowid;
  const name = `강의실 ${id}`;
  db.prepare('UPDATE classrooms SET name = ? WHERE id = ?').run(name, id);
  return {
    id,
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    color,
    name
  };
});

ipcMain.handle('classrooms:update-position', (_event, payload) => {
  const { id, x, y } = payload;
  db.prepare('UPDATE classrooms SET x = ?, y = ? WHERE id = ?').run(x, y, id);
  return { ok: true };
});

ipcMain.handle('classrooms:update-rect', (_event, payload) => {
  const { id, x, y, width, height } = payload;
  db.prepare('UPDATE classrooms SET x = ?, y = ?, width = ?, height = ? WHERE id = ?')
    .run(x, y, width, height, id);
  return { ok: true };
});

ipcMain.handle('classrooms:rename', (_event, payload) => {
  const { id, name } = payload;
  db.prepare('UPDATE classrooms SET name = ? WHERE id = ?').run(name, id);
  return { ok: true };
});

ipcMain.handle('classrooms:delete', (_event, id) => {
  db.prepare('DELETE FROM classrooms WHERE id = ?').run(id);
  return { ok: true };
});

ipcMain.handle('classrooms:reset', () => {
  db.exec('DELETE FROM timetable; DELETE FROM lessons; DELETE FROM classrooms; DELETE FROM meta;');
  db.prepare("DELETE FROM sqlite_sequence WHERE name = 'classrooms'").run();
  db.prepare("DELETE FROM sqlite_sequence WHERE name = 'lessons'").run();
  return { ok: true };
});

ipcMain.handle('timetable:get', (_event, classroomId) => {
  return db
    .prepare('SELECT day, slot FROM timetable WHERE classroom_id = ?')
    .all(classroomId);
});

ipcMain.handle('timetable:set', (_event, payload) => {
  const { classroomId, day, slot, active } = payload;

  if (active) {
    db.prepare(
      'INSERT OR REPLACE INTO timetable (classroom_id, day, slot, active) VALUES (?, ?, ?, 1)'
    ).run(classroomId, day, slot);
  } else {
    db.prepare(
      'DELETE FROM timetable WHERE classroom_id = ? AND day = ? AND slot = ?'
    ).run(classroomId, day, slot);
  }

  return { ok: true };
});

function findLessonConflicts(classroomId, day, startSlot, endSlot, excludeId) {
  return db.prepare(
    `SELECT id FROM lessons
     WHERE classroom_id = ?
       AND day = ?
       AND id != ?
       AND NOT (end_slot <= ? OR start_slot >= ?)`
  ).all(classroomId, day, excludeId || 0, startSlot, endSlot);
}

ipcMain.handle('lessons:list', (_event, classroomId) => {
  if (classroomId) {
    return db.prepare(
      'SELECT * FROM lessons WHERE classroom_id = ? ORDER BY day, start_slot'
    ).all(classroomId);
  }
  return db.prepare('SELECT * FROM lessons ORDER BY classroom_id, day, start_slot').all();
});

ipcMain.handle('lessons:create', (_event, payload) => {
  const {
    classroomId,
    day,
    startSlot,
    endSlot,
    title,
    instructor,
    note
  } = payload;

  const info = db.prepare(
    'INSERT INTO lessons (classroom_id, day, start_slot, end_slot, title, instructor, note) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(classroomId, day, startSlot, endSlot, title, instructor, note || '');

  const lesson = db.prepare('SELECT * FROM lessons WHERE id = ?').get(info.lastInsertRowid);
  const conflicts = findLessonConflicts(classroomId, day, startSlot, endSlot, lesson.id);
  return { lesson, conflicts };
});

ipcMain.handle('lessons:update', (_event, payload) => {
  const {
    id,
    classroomId,
    day,
    startSlot,
    endSlot,
    title,
    instructor,
    note
  } = payload;

  db.prepare(
    'UPDATE lessons SET classroom_id = ?, day = ?, start_slot = ?, end_slot = ?, title = ?, instructor = ?, note = ? WHERE id = ?'
  ).run(classroomId, day, startSlot, endSlot, title, instructor, note || '', id);

  const lesson = db.prepare('SELECT * FROM lessons WHERE id = ?').get(id);
  const conflicts = findLessonConflicts(classroomId, day, startSlot, endSlot, id);
  return { lesson, conflicts };
});

ipcMain.handle('lessons:delete', (_event, id) => {
  db.prepare('DELETE FROM lessons WHERE id = ?').run(id);
  return { ok: true };
});
