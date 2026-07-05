const board = document.getElementById('board');
const svg = document.getElementById('board-svg');
const selectedLabel = document.getElementById('selected-label');
const selectedColor = document.getElementById('selected-color');
const timetable = document.getElementById('timetable');
const timetableGrid = document.getElementById('timetable-grid');
const timetableBlocks = document.getElementById('timetable-blocks');
const contextMenu = document.getElementById('context-menu');
const resetButton = document.getElementById('reset-btn');
const editToggle = document.getElementById('edit-toggle');
const viewMultiButton = document.getElementById('view-multi');
const viewSingleButton = document.getElementById('view-single');
const timelineMulti = document.getElementById('timeline-multi');
const timelineSingle = document.getElementById('timeline-single');
const classroomSearch = document.getElementById('classroom-search');
const weekendToggle = document.getElementById('weekend-toggle');
const lessonDialog = document.getElementById('lesson-dialog');
const lessonForm = lessonDialog.querySelector('form');
const lessonTitle = document.getElementById('lesson-title');
const lessonInstructor = document.getElementById('lesson-instructor');
const lessonDay = document.getElementById('lesson-day');
const lessonStart = document.getElementById('lesson-start');
const lessonEnd = document.getElementById('lesson-end');
const lessonNote = document.getElementById('lesson-note');
const lessonSave = document.getElementById('lesson-save');
const lessonDelete = document.getElementById('lesson-delete');

const allDays = [
  { index: 0, label: '월' },
  { index: 1, label: '화' },
  { index: 2, label: '수' },
  { index: 3, label: '목' },
  { index: 4, label: '금' },
  { index: 5, label: '토' },
  { index: 6, label: '일' }
];

const startMinutes = 8 * 60;
const endMinutes = 22 * 60;
const slotMinutes = 30;
const slotCount = Math.floor((endMinutes - startMinutes) / slotMinutes);
const minRoomSizePx = 24;
const gridSizePx = 20;
const lessonDragThreshold = 6;

const classrooms = new Map();
const classroomElements = new Map();
const slotCellMap = new Map();
const lessons = new Map();
let selectedId = null;
let drawState = null;
let moveState = null;
let resizeState = null;
let editMode = false;
let selectionState = null;
let editingLessonId = null;
let editingLessonClassroomId = null;
let conflicts = new Set();
let viewMode = 'multi';
let includeWeekend = true;
let lessonDragState = null;
let lessonResizeState = null;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function snapToGrid(value) {
  return Math.round(value / gridSizePx) * gridSizePx;
}

function getDisplayName(classroom) {
  if (classroom.name && classroom.name.trim()) {
    return classroom.name.trim();
  }
  return `강의실 ${classroom.id}`;
}

function rectsOverlap(a, b) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function isOverlapping(candidate, ignoreId) {
  for (const [id, room] of classrooms.entries()) {
    if (id === ignoreId) {
      continue;
    }
    if (rectsOverlap(candidate, room)) {
      return true;
    }
  }
  return false;
}

function timeLabel(slot) {
  const total = startMinutes + slot * slotMinutes;
  const hours = String(Math.floor(total / 60)).padStart(2, '0');
  const minutes = String(total % 60).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function getVisibleDays() {
  return includeWeekend ? allDays : allDays.slice(0, 5);
}

function slotLabelOptions() {
  const options = [];
  for (let slot = 0; slot <= slotCount; slot += 1) {
    options.push({ value: slot, label: timeLabel(slot) });
  }
  return options;
}

function getGridMetrics() {
  const gridRect = timetableBlocks.getBoundingClientRect();
  const headerCell = timetableGrid.querySelector('.cell.header');
  const timeWidth = headerCell ? headerCell.getBoundingClientRect().width : 90;
  const headerHeight = headerCell ? headerCell.getBoundingClientRect().height : 40;
  const firstSlot = timetableGrid.querySelector('.slot-cell');
  const rowHeight = firstSlot ? firstSlot.getBoundingClientRect().height : 28;
  const dayCount = getVisibleDays().length;
  const dayWidth = (gridRect.width - timeWidth) / dayCount;
  return { gridRect, timeWidth, headerHeight, rowHeight, dayCount, dayWidth };
}

function clampSlot(value, duration) {
  const maxStart = Math.max(0, slotCount - duration);
  return clamp(value, 0, maxStart);
}

function computeLessonPlacement(targetX, targetY, duration) {
  const metrics = getGridMetrics();
  const relX = targetX - metrics.gridRect.left;
  const relY = targetY - metrics.gridRect.top;
  const dayIndex = clamp(
    Math.round((relX - metrics.timeWidth) / metrics.dayWidth),
    0,
    metrics.dayCount - 1
  );
  const startSlot = clampSlot(
    Math.round((relY - metrics.headerHeight) / metrics.rowHeight),
    duration
  );
  const endSlot = startSlot + duration;
  return { dayIndex, startSlot, endSlot, metrics };
}

function hasConflictCandidate(lessonId, classroomId, day, startSlot, endSlot) {
  for (const lesson of lessons.values()) {
    if (lesson.id === lessonId) {
      continue;
    }
    if (lesson.classroomId !== classroomId || lesson.day !== day) {
      continue;
    }
    if (lesson.startSlot < endSlot && lesson.endSlot > startSlot) {
      return true;
    }
  }
  return false;
}

function buildTimetableGrid() {
  const visibleDays = getVisibleDays();
  timetableGrid.style.setProperty('--day-count', visibleDays.length);
  timetableGrid.style.setProperty('--slot-count', slotCount);
  timetableGrid.innerHTML = '';
  slotCellMap.clear();
  timetableBlocks.innerHTML = '';

  const corner = document.createElement('div');
  corner.className = 'cell header';
  timetableGrid.appendChild(corner);

  visibleDays.forEach((day) => {
    const cell = document.createElement('div');
    cell.className = 'cell header';
    cell.textContent = day.label;
    timetableGrid.appendChild(cell);
  });

  for (let slot = 0; slot < slotCount; slot += 1) {
    const timeCell = document.createElement('div');
    timeCell.className = 'cell';
    timeCell.textContent = timeLabel(slot);
    timetableGrid.appendChild(timeCell);

    visibleDays.forEach((day) => {
      const slotCell = document.createElement('button');
      slotCell.className = 'slot-cell';
      slotCell.type = 'button';
      const key = `${day.index}-${slot}`;
      slotCell.dataset.day = String(day.index);
      slotCell.dataset.slot = String(slot);
      slotCell.dataset.key = key;
      timetableGrid.appendChild(slotCell);
      slotCellMap.set(key, slotCell);
    });
  }

  timetableBlocks.style.setProperty('--day-count', visibleDays.length);
  timetableBlocks.style.setProperty('--slot-count', slotCount);
  timetableBlocks.style.gridTemplateColumns = `90px repeat(${visibleDays.length}, minmax(80px, 1fr))`;
  timetableBlocks.style.gridTemplateRows = `40px repeat(${slotCount}, 28px)`;
}

function setTimetableEnabled(enabled) {
  timetable.classList.toggle('disabled', !enabled);
}

function updateSelectedState() {
  classroomElements.forEach((group, id) => {
    const selected = id === selectedId;
    group.classList.toggle('selected', selected);
    const rect = group.querySelector('rect');
    if (rect) {
      rect.classList.toggle('selected', selected);
    }
  });
}

function updateEditModeUI() {
  editToggle.classList.toggle('active', editMode);
  editToggle.textContent = editMode ? '편집 중' : '편집 모드';
  board.classList.toggle('editing', editMode);
  resetButton.disabled = !editMode;
}

function clearSelection() {
  slotCellMap.forEach((cell) => {
    cell.classList.remove('selecting');
  });
}

async function selectClassroom(id) {
  selectedId = id;
  updateSelectedState();

  if (!id) {
    selectedLabel.textContent = '선택된 강의실 없음';
    selectedColor.style.background = 'transparent';
    setTimetableEnabled(false);
    renderSingleViewBlocks();
    return;
  }

  const classroom = classrooms.get(id);
  selectedLabel.textContent = getDisplayName(classroom);
  selectedColor.style.background = classroom.color;
  setTimetableEnabled(true);
  renderSingleViewBlocks();
}

function normalizeLesson(row) {
  return {
    id: Number(row.id),
    classroomId: Number(row.classroom_id),
    day: Number(row.day),
    startSlot: Number(row.start_slot),
    endSlot: Number(row.end_slot),
    title: row.title || '',
    instructor: row.instructor || '',
    note: row.note || ''
  };
}

function computeConflicts() {
  const conflictSet = new Set();
  const grouped = new Map();
  lessons.forEach((lesson) => {
    const key = `${lesson.classroomId}-${lesson.day}`;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key).push(lesson);
  });

  grouped.forEach((list) => {
    list.sort((a, b) => a.startSlot - b.startSlot);
    let active = [];
    list.forEach((lesson) => {
      active = active.filter((item) => item.endSlot > lesson.startSlot);
      active.forEach((item) => {
        if (item.startSlot < lesson.endSlot) {
          conflictSet.add(item.id);
          conflictSet.add(lesson.id);
        }
      });
      active.push(lesson);
    });
  });

  return conflictSet;
}

function getLessonsForClassroom(classroomId) {
  return Array.from(lessons.values()).filter((lesson) => lesson.classroomId === classroomId);
}

async function loadLessons() {
  const list = await window.api.listLessons();
  lessons.clear();
  list.forEach((row) => {
    const lesson = normalizeLesson(row);
    lessons.set(lesson.id, lesson);
  });
  conflicts = computeConflicts();
  renderMultiView();
  renderSingleViewBlocks();
}

function createLessonContent(lesson) {
  const title = document.createElement('div');
  title.className = 'lesson-title';
  title.textContent = lesson.title || '수업';

  const meta = document.createElement('div');
  meta.className = 'lesson-meta';
  meta.textContent = lesson.instructor ? `강의자: ${lesson.instructor}` : '';

  return { title, meta };
}

function renderMultiView() {
  if (viewMode !== 'multi') {
    return;
  }

  const visibleDays = getVisibleDays();
  timelineMulti.innerHTML = '';
  const cardGrid = document.createElement('div');
  cardGrid.className = 'room-card-grid';

  const query = classroomSearch.value.trim().toLowerCase();
  const roomList = Array.from(classrooms.values()).filter((room) => {
    return getDisplayName(room).toLowerCase().includes(query);
  });

  roomList.forEach((room) => {
    const card = document.createElement('div');
    card.className = 'room-card';
    card.addEventListener('click', () => {
      selectClassroom(room.id);
      switchView('single');
    });

    const header = document.createElement('div');
    header.className = 'room-card-header';

    const name = document.createElement('div');
    name.className = 'room-name';
    name.textContent = getDisplayName(room);
    if (room.id === selectedId) {
      name.classList.add('active');
    }

    const roomLessons = getLessonsForClassroom(room.id);
    const conflictCount = roomLessons.filter((lesson) => conflicts.has(lesson.id)).length;
    const meta = document.createElement('div');
    meta.className = 'room-meta';
    meta.textContent = `${roomLessons.length}개 수업`;
    if (conflictCount > 0) {
      const badge = document.createElement('span');
      badge.className = 'conflict-badge';
      badge.textContent = `충돌 ${conflictCount}`;
      meta.appendChild(badge);
    }

    header.appendChild(name);
    header.appendChild(meta);
    card.appendChild(header);

    const mini = document.createElement('div');
    mini.className = 'room-mini';

    const miniHeader = document.createElement('div');
    miniHeader.className = 'mini-header';
    miniHeader.style.setProperty('--day-count', visibleDays.length);
    visibleDays.forEach((day) => {
      const dayLabel = document.createElement('div');
      dayLabel.textContent = day.label;
      miniHeader.appendChild(dayLabel);
    });
    mini.appendChild(miniHeader);

    const miniBody = document.createElement('div');
    miniBody.className = 'mini-body';
    miniBody.style.setProperty('--day-count', visibleDays.length);
    miniBody.style.setProperty('--slot-count', slotCount);

    const blocks = document.createElement('div');
    blocks.className = 'mini-blocks';
    blocks.style.gridTemplateColumns = `repeat(${visibleDays.length}, 1fr)`;
    blocks.style.gridTemplateRows = `repeat(${slotCount}, var(--mini-slot-height))`;

    roomLessons.forEach((lesson) => {
      const dayIndex = visibleDays.findIndex((day) => day.index === lesson.day);
      if (dayIndex === -1) {
        return;
      }
      const block = document.createElement('div');
      block.className = 'mini-block';
      if (conflicts.has(lesson.id)) {
        block.classList.add('conflict');
      }
      block.style.gridColumn = `${dayIndex + 1} / ${dayIndex + 2}`;
      block.style.gridRow = `${lesson.startSlot + 1} / ${lesson.endSlot + 1}`;
      const duration = lesson.endSlot - lesson.startSlot;
      block.title = lesson.instructor
        ? `${lesson.instructor} · ${lesson.title}`
        : lesson.title;
      if (duration >= 2) {
        const label = document.createElement('span');
        label.className = 'mini-title';
        label.textContent = lesson.instructor || lesson.title || '수업';
        block.appendChild(label);
      }
      block.addEventListener('pointerdown', (event) => {
        event.stopPropagation();
      });
      block.addEventListener('click', (event) => {
        event.stopPropagation();
        openLessonDialog(lesson);
      });
      blocks.appendChild(block);
    });

    miniBody.appendChild(blocks);
    mini.appendChild(miniBody);
    card.appendChild(mini);
    cardGrid.appendChild(card);
  });

  timelineMulti.appendChild(cardGrid);
}

function renderSingleViewBlocks() {
  timetableBlocks.innerHTML = '';
  if (!selectedId) {
    return;
  }
  if (viewMode !== 'single') {
    return;
  }

  const visibleDays = getVisibleDays();
  const dayIndexMap = new Map(visibleDays.map((day, idx) => [day.index, idx]));
  const roomLessons = getLessonsForClassroom(selectedId);

  roomLessons.forEach((lesson) => {
    if (!dayIndexMap.has(lesson.day)) {
      return;
    }
    const dayColumn = dayIndexMap.get(lesson.day);
    const block = document.createElement('div');
    block.className = 'timetable-block';
    if (conflicts.has(lesson.id)) {
      block.classList.add('conflict');
    }
    const columnStart = 2 + dayColumn;
    const rowStart = 2 + lesson.startSlot;
    const rowEnd = 2 + lesson.endSlot;
    block.style.gridColumn = `${columnStart} / ${columnStart + 1}`;
    block.style.gridRow = `${rowStart} / ${rowEnd}`;

    const content = createLessonContent(lesson);
    block.appendChild(content.title);
    block.appendChild(content.meta);

    const handleTop = document.createElement('div');
    handleTop.className = 'lesson-resize-handle top';
    handleTop.addEventListener('pointerdown', (event) => {
      event.stopPropagation();
      handleLessonResizeStart(event, lesson, 'start', block);
    });

    const handleBottom = document.createElement('div');
    handleBottom.className = 'lesson-resize-handle bottom';
    handleBottom.addEventListener('pointerdown', (event) => {
      event.stopPropagation();
      handleLessonResizeStart(event, lesson, 'end', block);
    });

    block.appendChild(handleTop);
    block.appendChild(handleBottom);

    block.addEventListener('pointerdown', (event) => {
      event.stopPropagation();
      handleLessonDragStart(event, lesson, block);
    });
    block.addEventListener('dblclick', (event) => {
      event.stopPropagation();
      openLessonDialog(lesson);
    });
    timetableBlocks.appendChild(block);
  });
}

function updateViewUI() {
  viewMultiButton.classList.toggle('active', viewMode === 'multi');
  viewSingleButton.classList.toggle('active', viewMode === 'single');
  timelineMulti.classList.toggle('hidden', viewMode !== 'multi');
  timelineSingle.classList.toggle('hidden', viewMode !== 'single');
  clearSelection();
  if (viewMode === 'multi') {
    renderMultiView();
  } else {
    renderSingleViewBlocks();
  }
}

function handleLessonDragStart(event, lesson, block) {
  if (viewMode !== 'single') {
    return;
  }
  if (event.button !== 0) {
    return;
  }

  const blockRect = block.getBoundingClientRect();
  lessonDragState = {
    lessonId: lesson.id,
    classroomId: lesson.classroomId,
    block,
    offsetX: event.clientX - blockRect.left,
    offsetY: event.clientY - blockRect.top,
    duration: lesson.endSlot - lesson.startSlot,
    candidate: null,
    moved: false,
    dragging: false,
    startX: event.clientX,
    startY: event.clientY,
    blockRect
  };

  window.addEventListener('pointermove', handleLessonDragMove);
  window.addEventListener('pointerup', handleLessonDragEnd, { once: true });
}

function handleLessonDragMove(event) {
  if (!lessonDragState) {
    return;
  }

  const { block, offsetX, offsetY, duration, startX, startY, blockRect } = lessonDragState;
  if (!lessonDragState.dragging) {
    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;
    if (Math.hypot(deltaX, deltaY) < lessonDragThreshold) {
      return;
    }

    lessonDragState.dragging = true;
    block.classList.add('dragging');
    block.style.position = 'fixed';
    block.style.left = `${blockRect.left}px`;
    block.style.top = `${blockRect.top}px`;
    block.style.width = `${blockRect.width}px`;
    block.style.height = `${blockRect.height}px`;
    block.style.zIndex = '1000';
    block.style.pointerEvents = 'none';
    document.body.classList.add('no-select');
  }
  const targetX = event.clientX - offsetX;
  const targetY = event.clientY - offsetY;
  block.style.left = `${targetX}px`;
  block.style.top = `${targetY}px`;

  const placement = computeLessonPlacement(targetX, targetY, duration);
  const visibleDays = getVisibleDays();
  const day = visibleDays[placement.dayIndex]?.index ?? visibleDays[0]?.index ?? 0;

  lessonDragState.candidate = {
    day,
    startSlot: placement.startSlot,
    endSlot: placement.endSlot
  };

  block.style.gridColumn = `${2 + placement.dayIndex} / ${3 + placement.dayIndex}`;
  block.style.gridRow = `${2 + placement.startSlot} / ${2 + placement.endSlot}`;

  const conflictNow = hasConflictCandidate(
    lessonDragState.lessonId,
    lessonDragState.classroomId,
    day,
    placement.startSlot,
    placement.endSlot
  );
  block.classList.toggle('conflict', conflictNow);

  lessonDragState.moved = true;
}

async function handleLessonDragEnd() {
  window.removeEventListener('pointermove', handleLessonDragMove);
  if (!lessonDragState) {
    return;
  }

  const { lessonId, block, candidate, moved, dragging } = lessonDragState;
  if (dragging) {
    block.classList.remove('dragging');
    block.style.removeProperty('position');
    block.style.removeProperty('left');
    block.style.removeProperty('top');
    block.style.removeProperty('width');
    block.style.removeProperty('height');
    block.style.removeProperty('z-index');
    block.style.removeProperty('pointer-events');
    block.style.removeProperty('grid-column');
    block.style.removeProperty('grid-row');
    document.body.classList.remove('no-select');
  }

  if (!moved) {
    lessonDragState = null;
    return;
  }

  if (candidate) {
    const lesson = lessons.get(lessonId);
    if (lesson) {
      if (
        lesson.day !== candidate.day ||
        lesson.startSlot !== candidate.startSlot ||
        lesson.endSlot !== candidate.endSlot
      ) {
        await window.api.updateLesson({
          id: lesson.id,
          classroomId: lesson.classroomId,
          day: candidate.day,
          startSlot: candidate.startSlot,
          endSlot: candidate.endSlot,
          title: lesson.title,
          instructor: lesson.instructor,
          note: lesson.note
        });
        await loadLessons();
      } else {
        renderSingleViewBlocks();
      }
    }
  }

  lessonDragState = null;
}

function handleLessonResizeStart(event, lesson, edge, block) {
  if (viewMode !== 'single') {
    return;
  }
  if (event.button !== 0) {
    return;
  }

  lessonResizeState = {
    lessonId: lesson.id,
    classroomId: lesson.classroomId,
    edge,
    block,
    startSlot: lesson.startSlot,
    endSlot: lesson.endSlot,
    day: lesson.day
  };

  block.classList.add('resizing');
  document.body.classList.add('no-select');
  window.addEventListener('pointermove', handleLessonResizeMove);
  window.addEventListener('pointerup', handleLessonResizeEnd, { once: true });
}

function handleLessonResizeMove(event) {
  if (!lessonResizeState) {
    return;
  }

  const { block, edge, day } = lessonResizeState;
  const metrics = getGridMetrics();
  const rawSlot = Math.round(
    (event.clientY - metrics.gridRect.top - metrics.headerHeight) / metrics.rowHeight
  );
  const slot = clamp(rawSlot, 0, slotCount);

  let startSlot = lessonResizeState.startSlot;
  let endSlot = lessonResizeState.endSlot;
  if (edge === 'start') {
    startSlot = clamp(slot, 0, endSlot - 1);
  } else {
    endSlot = clamp(slot, startSlot + 1, slotCount);
  }

  lessonResizeState.previewStart = startSlot;
  lessonResizeState.previewEnd = endSlot;

  const visibleDays = getVisibleDays();
  const dayIndex = visibleDays.findIndex((d) => d.index === day);
  if (dayIndex !== -1) {
    block.style.gridColumn = `${2 + dayIndex} / ${3 + dayIndex}`;
    block.style.gridRow = `${2 + startSlot} / ${2 + endSlot}`;
  }

  const conflictNow = hasConflictCandidate(
    lessonResizeState.lessonId,
    lessonResizeState.classroomId,
    day,
    startSlot,
    endSlot
  );
  block.classList.toggle('conflict', conflictNow);
}

async function handleLessonResizeEnd() {
  window.removeEventListener('pointermove', handleLessonResizeMove);
  if (!lessonResizeState) {
    return;
  }

  const { lessonId, block, day, startSlot, endSlot, previewStart, previewEnd } = lessonResizeState;
  block.classList.remove('resizing');
  block.style.removeProperty('grid-column');
  block.style.removeProperty('grid-row');
  document.body.classList.remove('no-select');

  const nextStart = previewStart ?? startSlot;
  const nextEnd = previewEnd ?? endSlot;

  if (nextStart !== startSlot || nextEnd !== endSlot) {
    const lesson = lessons.get(lessonId);
    if (lesson) {
      await window.api.updateLesson({
        id: lesson.id,
        classroomId: lesson.classroomId,
        day,
        startSlot: nextStart,
        endSlot: nextEnd,
        title: lesson.title,
        instructor: lesson.instructor,
        note: lesson.note
      });
      await loadLessons();
    }
  } else {
    renderSingleViewBlocks();
  }

  lessonResizeState = null;
}

function switchView(mode) {
  viewMode = mode;
  updateViewUI();
}

function populateLessonSelectors(dayValue, startValue, endValue) {
  const visibleDays = getVisibleDays();
  lessonDay.innerHTML = '';
  visibleDays.forEach((day) => {
    const option = document.createElement('option');
    option.value = String(day.index);
    option.textContent = day.label;
    lessonDay.appendChild(option);
  });

  const timeOptions = slotLabelOptions();
  lessonStart.innerHTML = '';
  lessonEnd.innerHTML = '';
  timeOptions.forEach((optionData) => {
    const option = document.createElement('option');
    option.value = String(optionData.value);
    option.textContent = optionData.label;
    lessonStart.appendChild(option);

    const optionEnd = document.createElement('option');
    optionEnd.value = String(optionData.value);
    optionEnd.textContent = optionData.label;
    lessonEnd.appendChild(optionEnd);
  });

  if (dayValue !== undefined) {
    lessonDay.value = String(dayValue);
  }
  if (startValue !== undefined) {
    lessonStart.value = String(startValue);
  }
  if (endValue !== undefined) {
    lessonEnd.value = String(endValue);
  }
}

function openLessonDialog(lesson) {
  if (lesson && lesson.day >= 5 && !includeWeekend) {
    includeWeekend = true;
    weekendToggle.checked = true;
    buildTimetableGrid();
  }
  const visibleDays = getVisibleDays();
  const defaultDay = visibleDays[0]?.index ?? 0;
  if (lesson) {
    editingLessonId = lesson.id;
    editingLessonClassroomId = lesson.classroomId;
    lessonTitle.value = lesson.title;
    lessonInstructor.value = lesson.instructor;
    lessonNote.value = lesson.note || '';
    populateLessonSelectors(lesson.day, lesson.startSlot, lesson.endSlot);
    lessonDelete.style.display = 'inline-flex';
  } else if (selectionState) {
    editingLessonId = null;
    editingLessonClassroomId = selectedId;
    lessonTitle.value = '';
    lessonInstructor.value = '';
    lessonNote.value = '';
    populateLessonSelectors(selectionState.day, selectionState.startSlot, selectionState.endSlot);
    lessonDelete.style.display = 'none';
  } else {
    editingLessonId = null;
    editingLessonClassroomId = selectedId;
    lessonTitle.value = '';
    lessonInstructor.value = '';
    lessonNote.value = '';
    populateLessonSelectors(defaultDay, 0, 1);
    lessonDelete.style.display = 'none';
  }

  lessonDialog.showModal();
}

async function saveLesson() {
  if (!selectedId && !editingLessonId && !editingLessonClassroomId) {
    return;
  }

  const payload = {
    id: editingLessonId,
    classroomId: editingLessonClassroomId || selectedId,
    day: Number(lessonDay.value),
    startSlot: Number(lessonStart.value),
    endSlot: Number(lessonEnd.value),
    title: lessonTitle.value.trim() || '수업',
    instructor: lessonInstructor.value.trim(),
    note: lessonNote.value.trim()
  };

  if (payload.endSlot <= payload.startSlot) {
    window.alert('종료 시간이 시작 시간보다 이후여야 합니다.');
    return;
  }

  if (editingLessonId) {
    await window.api.updateLesson(payload);
  } else {
    await window.api.createLesson(payload);
  }

  lessonDialog.close();
  selectionState = null;
  clearSelection();
  await loadLessons();
}

async function deleteLesson() {
  if (!editingLessonId) {
    lessonDialog.close();
    return;
  }
  const confirmed = window.confirm('해당 수업을 삭제할까요?');
  if (!confirmed) {
    return;
  }
  await window.api.deleteLesson(editingLessonId);
  lessonDialog.close();
  await loadLessons();
}

function layoutGroup(group, classroom, bounds) {
  const rect = group.querySelector('rect');
  const label = group.querySelector('text');
  const handles = group.querySelectorAll('.resize-handle');
  const x = classroom.x * bounds.width;
  const y = classroom.y * bounds.height;
  const width = classroom.width * bounds.width;
  const height = classroom.height * bounds.height;

  rect.setAttribute('x', x);
  rect.setAttribute('y', y);
  rect.setAttribute('width', width);
  rect.setAttribute('height', height);

  label.setAttribute('x', x + width / 2);
  label.setAttribute('y', y + height / 2);

  handles.forEach((handle) => {
    const type = handle.dataset.handle;
    let cx = x;
    let cy = y;
    if (type === 'ne') {
      cx = x + width;
      cy = y;
    } else if (type === 'sw') {
      cx = x;
      cy = y + height;
    } else if (type === 'se') {
      cx = x + width;
      cy = y + height;
    }
    handle.setAttribute('cx', cx);
    handle.setAttribute('cy', cy);
  });
}

function layoutClassrooms() {
  const bounds = svg.getBoundingClientRect();
  classroomElements.forEach((group, id) => {
    const classroom = classrooms.get(id);
    if (classroom) {
      layoutGroup(group, classroom, bounds);
    }
  });
}

function handleClassroomPointerDown(event) {
  if (event.button !== 0) {
    return;
  }

  const group = event.currentTarget;
  const id = Number(group.dataset.id);
  const classroom = classrooms.get(id);
  if (!classroom) {
    return;
  }

  event.stopPropagation();
  hideContextMenu();
  selectClassroom(id);
  switchView('single');

  if (!editMode) {
    return;
  }

  const bounds = svg.getBoundingClientRect();
  const point = getSvgPoint(event);
  const offsetX = point.x - classroom.x * bounds.width;
  const offsetY = point.y - classroom.y * bounds.height;

  moveState = {
    id,
    offsetX,
    offsetY,
    bounds,
    lastValid: { x: classroom.x, y: classroom.y }
  };

  group.classList.add('dragging');
  svg.setPointerCapture(event.pointerId);
}

function computeResizeRect(handle, origin, dx, dy, bounds) {
  let x = origin.x;
  let y = origin.y;
  let width = origin.width;
  let height = origin.height;

  if (handle === 'nw') {
    const maxX = origin.x + origin.width - minRoomSizePx;
    const maxY = origin.y + origin.height - minRoomSizePx;
    x = clamp(origin.x + dx, 0, maxX);
    y = clamp(origin.y + dy, 0, maxY);
    width = origin.x + origin.width - x;
    height = origin.y + origin.height - y;
  } else if (handle === 'ne') {
    const maxY = origin.y + origin.height - minRoomSizePx;
    y = clamp(origin.y + dy, 0, maxY);
    width = clamp(origin.width + dx, minRoomSizePx, bounds.width - origin.x);
    height = origin.y + origin.height - y;
  } else if (handle === 'sw') {
    const maxX = origin.x + origin.width - minRoomSizePx;
    x = clamp(origin.x + dx, 0, maxX);
    width = origin.x + origin.width - x;
    height = clamp(origin.height + dy, minRoomSizePx, bounds.height - origin.y);
  } else if (handle === 'se') {
    width = clamp(origin.width + dx, minRoomSizePx, bounds.width - origin.x);
    height = clamp(origin.height + dy, minRoomSizePx, bounds.height - origin.y);
  }

  return { x, y, width, height };
}

function handleResizePointerDown(event) {
  if (event.button !== 0) {
    return;
  }
  if (!editMode) {
    return;
  }

  event.stopPropagation();
  hideContextMenu();

  const handle = event.currentTarget;
  const group = handle.closest('.classroom-group');
  if (!group) {
    return;
  }
  const id = Number(group.dataset.id);
  const classroom = classrooms.get(id);
  if (!classroom) {
    return;
  }

  selectClassroom(id);

  const bounds = svg.getBoundingClientRect();
  const origin = {
    x: classroom.x * bounds.width,
    y: classroom.y * bounds.height,
    width: classroom.width * bounds.width,
    height: classroom.height * bounds.height
  };

  resizeState = {
    id,
    handle: handle.dataset.handle,
    bounds,
    origin,
    startX: event.clientX,
    startY: event.clientY
  };

  svg.setPointerCapture(event.pointerId);
}

function showContextMenu(id, clientX, clientY) {
  contextMenu.dataset.id = String(id);
  contextMenu.classList.remove('hidden');

  const menuWidth = contextMenu.offsetWidth;
  const menuHeight = contextMenu.offsetHeight;
  const maxX = window.innerWidth - menuWidth - 8;
  const maxY = window.innerHeight - menuHeight - 8;
  const left = clamp(clientX, 8, maxX);
  const top = clamp(clientY, 8, maxY);

  contextMenu.style.left = `${left}px`;
  contextMenu.style.top = `${top}px`;
}

function hideContextMenu() {
  contextMenu.classList.add('hidden');
  contextMenu.dataset.id = '';
}

function handleClassroomContextMenu(event) {
  event.preventDefault();
  if (!editMode) {
    return;
  }
  const group = event.currentTarget;
  const id = Number(group.dataset.id);
  if (!classrooms.has(id)) {
    return;
  }
  selectClassroom(id);
  showContextMenu(id, event.clientX, event.clientY);
}

function createClassroomElement(classroom) {
  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  group.classList.add('classroom-group');
  group.dataset.id = String(classroom.id);

  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.classList.add('classroom-rect');
  rect.dataset.id = String(classroom.id);
  rect.setAttribute('fill', classroom.color);

  const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  label.classList.add('classroom-label');
  label.textContent = getDisplayName(classroom);
  label.setAttribute('text-anchor', 'middle');
  label.setAttribute('dominant-baseline', 'middle');
  label.setAttribute('pointer-events', 'none');

  group.appendChild(rect);
  group.appendChild(label);
  const handleTypes = ['nw', 'ne', 'sw', 'se'];
  handleTypes.forEach((type) => {
    const handle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    handle.classList.add('resize-handle');
    handle.dataset.handle = type;
    handle.setAttribute('r', '6');
    handle.addEventListener('pointerdown', handleResizePointerDown);
    group.appendChild(handle);
  });
  group.addEventListener('pointerdown', handleClassroomPointerDown);
  group.addEventListener('contextmenu', handleClassroomContextMenu);
  svg.appendChild(group);

  const bounds = svg.getBoundingClientRect();
  layoutGroup(group, classroom, bounds);
  classroomElements.set(classroom.id, group);
  return group;
}

function getSvgPoint(event) {
  const bounds = svg.getBoundingClientRect();
  return {
    x: clamp(event.clientX - bounds.left, 0, bounds.width),
    y: clamp(event.clientY - bounds.top, 0, bounds.height),
    bounds
  };
}

function startDrawing(event) {
  if (event.button !== 0) {
    return;
  }
  if (!editMode) {
    return;
  }
  if (event.target.closest('.classroom-group')) {
    return;
  }

  const { x, y, bounds } = getSvgPoint(event);
  const ghost = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  ghost.classList.add('classroom-rect', 'ghost');
  svg.appendChild(ghost);

  drawState = {
    startX: snapToGrid(x),
    startY: snapToGrid(y),
    ghost,
    bounds
  };

  svg.setPointerCapture(event.pointerId);
}

function updateDrawing(event) {
  if (!drawState) {
    return;
  }

  const { x, y } = getSvgPoint(event);
  const snappedX = snapToGrid(x);
  const snappedY = snapToGrid(y);
  const minX = Math.min(drawState.startX, snappedX);
  const minY = Math.min(drawState.startY, snappedY);
  const width = Math.abs(snappedX - drawState.startX);
  const height = Math.abs(snappedY - drawState.startY);

  drawState.ghost.setAttribute('x', minX);
  drawState.ghost.setAttribute('y', minY);
  drawState.ghost.setAttribute('width', width);
  drawState.ghost.setAttribute('height', height);
}

async function endDrawing(event) {
  if (!drawState) {
    return;
  }

  svg.releasePointerCapture(event.pointerId);

  const bounds = drawState.bounds;
  const ghost = drawState.ghost;
  const rectX = Number(ghost.getAttribute('x'));
  const rectY = Number(ghost.getAttribute('y'));
  const rectW = Number(ghost.getAttribute('width'));
  const rectH = Number(ghost.getAttribute('height'));

  ghost.remove();
  drawState = null;

  if (rectW < 12 || rectH < 12) {
    return;
  }

  const payload = {
    x: rectX / bounds.width,
    y: rectY / bounds.height,
    width: rectW / bounds.width,
    height: rectH / bounds.height
  };

  if (isOverlapping(payload, null)) {
    window.alert('다른 강의실과 겹쳐서 생성할 수 없습니다.');
    return;
  }

  const created = await window.api.createClassroom(payload);
  const classroom = {
    id: Number(created.id),
    x: created.x,
    y: created.y,
    width: created.width,
    height: created.height,
    color: created.color,
    name: created.name
  };

  classrooms.set(classroom.id, classroom);
  createClassroomElement(classroom);
  selectClassroom(classroom.id);
  renderMultiView();
}

function handleClassroomPointerMove(event) {
  if (!moveState) {
    return;
  }

  const classroom = classrooms.get(moveState.id);
  const group = classroomElements.get(moveState.id);
  if (!classroom || !group) {
    return;
  }

  const bounds = moveState.bounds;
  const widthPx = classroom.width * bounds.width;
  const heightPx = classroom.height * bounds.height;

  const pointX = clamp(event.clientX - bounds.left, 0, bounds.width);
  const pointY = clamp(event.clientY - bounds.top, 0, bounds.height);

  let nextX = pointX - moveState.offsetX;
  let nextY = pointY - moveState.offsetY;
  nextX = snapToGrid(nextX);
  nextY = snapToGrid(nextY);
  nextX = clamp(nextX, 0, bounds.width - widthPx);
  nextY = clamp(nextY, 0, bounds.height - heightPx);

  const candidate = {
    x: nextX / bounds.width,
    y: nextY / bounds.height,
    width: classroom.width,
    height: classroom.height
  };

  if (isOverlapping(candidate, moveState.id)) {
    return;
  }

  classroom.x = candidate.x;
  classroom.y = candidate.y;
  moveState.lastValid = { x: candidate.x, y: candidate.y };
  layoutGroup(group, classroom, bounds);
}

function handleResizePointerMove(event) {
  if (!resizeState) {
    return;
  }

  const classroom = classrooms.get(resizeState.id);
  const group = classroomElements.get(resizeState.id);
  if (!classroom || !group) {
    return;
  }

  const dx = event.clientX - resizeState.startX;
  const dy = event.clientY - resizeState.startY;
  const bounds = resizeState.bounds;

  const rectPx = computeResizeRect(resizeState.handle, resizeState.origin, dx, dy, bounds);
  let snappedX = snapToGrid(rectPx.x);
  let snappedY = snapToGrid(rectPx.y);
  let snappedW = snapToGrid(rectPx.width);
  let snappedH = snapToGrid(rectPx.height);

  snappedW = Math.max(minRoomSizePx, snappedW);
  snappedH = Math.max(minRoomSizePx, snappedH);
  snappedX = clamp(snappedX, 0, bounds.width - snappedW);
  snappedY = clamp(snappedY, 0, bounds.height - snappedH);
  snappedW = clamp(snappedW, minRoomSizePx, bounds.width - snappedX);
  snappedH = clamp(snappedH, minRoomSizePx, bounds.height - snappedY);
  const candidate = {
    x: snappedX / bounds.width,
    y: snappedY / bounds.height,
    width: snappedW / bounds.width,
    height: snappedH / bounds.height
  };

  if (isOverlapping(candidate, resizeState.id)) {
    return;
  }

  classroom.x = candidate.x;
  classroom.y = candidate.y;
  classroom.width = candidate.width;
  classroom.height = candidate.height;
  layoutGroup(group, classroom, bounds);
}

function handleClassroomPointerUp(event) {
  if (!moveState) {
    return;
  }

  const { id, lastValid } = moveState;
  const group = classroomElements.get(id);
  if (group) {
    group.classList.remove('dragging');
  }

  moveState = null;
  svg.releasePointerCapture(event.pointerId);

  if (lastValid) {
    window.api.updateClassroomPosition(id, lastValid.x, lastValid.y);
  }
}

function handleResizePointerUp(event) {
  if (!resizeState) {
    return;
  }

  const { id } = resizeState;
  const classroom = classrooms.get(id);
  resizeState = null;
  svg.releasePointerCapture(event.pointerId);

  if (classroom) {
    window.api.updateClassroomRect(id, classroom.x, classroom.y, classroom.width, classroom.height);
  }
}

function updateSelectionPreview() {
  clearSelection();
  if (!selectionState) {
    return;
  }

  const start = Math.min(selectionState.startSlot, selectionState.endSlot);
  const end = Math.max(selectionState.startSlot, selectionState.endSlot);
  for (let slot = start; slot < end; slot += 1) {
    const key = `${selectionState.day}-${slot}`;
    const cell = slotCellMap.get(key);
    if (cell) {
      cell.classList.add('selecting');
    }
  }
}

function handleSlotPointerDown(event) {
  if (!selectedId || viewMode !== 'single') {
    return;
  }
  if (event.button !== 0) {
    return;
  }

  const cell = event.target.closest('.slot-cell');
  if (!cell) {
    return;
  }

  event.preventDefault();

  selectionState = {
    day: Number(cell.dataset.day),
    startSlot: Number(cell.dataset.slot),
    endSlot: Number(cell.dataset.slot) + 1
  };

  updateSelectionPreview();

  window.addEventListener('pointermove', handleSelectionMove);
  window.addEventListener('pointerup', handleSelectionUp, { once: true });
}

function handleSelectionMove(event) {
  if (!selectionState) {
    return;
  }

  const element = document.elementFromPoint(event.clientX, event.clientY);
  if (!element) {
    return;
  }

  const cell = element.closest('.slot-cell');
  if (!cell) {
    return;
  }

  const day = Number(cell.dataset.day);
  if (day !== selectionState.day) {
    return;
  }

  const slot = Number(cell.dataset.slot);
  selectionState.endSlot = Math.min(slotCount, slot + 1);
  updateSelectionPreview();
}

function handleSelectionUp() {
  window.removeEventListener('pointermove', handleSelectionMove);
  if (!selectionState) {
    return;
  }

  const start = Math.min(selectionState.startSlot, selectionState.endSlot);
  const end = Math.max(selectionState.startSlot, selectionState.endSlot);
  selectionState.startSlot = start;
  selectionState.endSlot = end;

  openLessonDialog(null);
}

function updateClassroomLabel(id) {
  const classroom = classrooms.get(id);
  const group = classroomElements.get(id);
  if (!classroom || !group) {
    return;
  }
  const label = group.querySelector('text');
  label.textContent = getDisplayName(classroom);
}

async function renameClassroom(id) {
  const classroom = classrooms.get(id);
  if (!classroom) {
    return;
  }
  const currentName = getDisplayName(classroom);
  const nextName = window.prompt('강의실 이름을 입력하세요', currentName);
  if (!nextName) {
    return;
  }
  const trimmed = nextName.trim();
  if (!trimmed) {
    return;
  }
  await window.api.renameClassroom(id, trimmed);
  classroom.name = trimmed;
  updateClassroomLabel(id);
  if (selectedId === id) {
    selectedLabel.textContent = getDisplayName(classroom);
  }
  renderMultiView();
}

async function deleteClassroom(id) {
  const classroom = classrooms.get(id);
  if (!classroom) {
    return;
  }
  const confirmed = window.confirm(`"${getDisplayName(classroom)}" 강의실을 삭제할까요?`);
  if (!confirmed) {
    return;
  }
  await window.api.deleteClassroom(id);
  const group = classroomElements.get(id);
  if (group) {
    group.remove();
  }
  classroomElements.delete(id);
  classrooms.delete(id);
  if (selectedId === id) {
    selectClassroom(null);
  }
  renderMultiView();
}

async function resetClassrooms() {
  const confirmed = window.confirm('모든 강의실을 초기화할까요?');
  if (!confirmed) {
    return;
  }

  hideContextMenu();
  await window.api.resetClassrooms();

  classroomElements.forEach((group) => group.remove());
  classroomElements.clear();
  classrooms.clear();
  selectClassroom(null);
  await loadLessons();
  renderMultiView();
}

async function init() {
  includeWeekend = weekendToggle.checked;
  buildTimetableGrid();
  populateLessonSelectors();

  const list = await window.api.listClassrooms();
  list.forEach((classroom) => {
    const normalized = {
      id: Number(classroom.id),
      x: classroom.x,
      y: classroom.y,
      width: classroom.width,
      height: classroom.height,
      color: classroom.color,
      name: classroom.name
    };
    classrooms.set(normalized.id, normalized);
    createClassroomElement(normalized);
  });

  setTimetableEnabled(false);
  updateEditModeUI();
  window.addEventListener('resize', layoutClassrooms);
  await loadLessons();
  updateViewUI();
}

svg.addEventListener('pointerdown', startDrawing);
svg.addEventListener('pointermove', updateDrawing);
svg.addEventListener('pointerup', endDrawing);
svg.addEventListener('pointermove', handleClassroomPointerMove);
svg.addEventListener('pointerup', handleClassroomPointerUp);
svg.addEventListener('pointermove', handleResizePointerMove);
svg.addEventListener('pointerup', handleResizePointerUp);

timetableGrid.addEventListener('pointerdown', handleSlotPointerDown);

resetButton.addEventListener('click', () => {
  resetClassrooms();
});

editToggle.addEventListener('click', () => {
  editMode = !editMode;
  hideContextMenu();
  updateEditModeUI();
});

viewMultiButton.addEventListener('click', () => {
  switchView('multi');
});

viewSingleButton.addEventListener('click', () => {
  switchView('single');
});

classroomSearch.addEventListener('input', () => {
  renderMultiView();
});

weekendToggle.addEventListener('change', () => {
  includeWeekend = weekendToggle.checked;
  buildTimetableGrid();
  populateLessonSelectors();
  renderMultiView();
  renderSingleViewBlocks();
});

lessonSave.addEventListener('click', () => {
  saveLesson();
});

lessonForm.addEventListener('submit', (event) => {
  event.preventDefault();
  saveLesson();
});

lessonDelete.addEventListener('click', () => {
  deleteLesson();
});

lessonDialog.addEventListener('close', () => {
  editingLessonId = null;
  editingLessonClassroomId = null;
  selectionState = null;
  clearSelection();
});

contextMenu.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) {
    return;
  }
  const id = Number(contextMenu.dataset.id);
  hideContextMenu();
  if (!id) {
    return;
  }

  if (button.dataset.action === 'rename') {
    renameClassroom(id);
  }
  if (button.dataset.action === 'delete') {
    deleteClassroom(id);
  }
});

document.addEventListener('pointerdown', (event) => {
  if (!contextMenu.classList.contains('hidden') && !contextMenu.contains(event.target)) {
    hideContextMenu();
  }
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    hideContextMenu();
  }
});

document.addEventListener('DOMContentLoaded', init);
